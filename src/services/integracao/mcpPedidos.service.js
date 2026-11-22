'use strict';

// Serviço de prévia e confirmação do MCP de pedidos.
// Nunca grava no legado durante prepararPedido. A confirmação só pode ser consumida uma vez.
const crypto = require('crypto');
const pool = require('../../../db/connection');
const clientesService = require('../legado/clientes/clientes.service');
const vendedoresService = require('../legado/vendedores/vendedores.service');
const produtoService = require('../produto/produto.service');
const pedidosService = require('../legado/pedidos-insercao-v2/pedidos-insercao-v2.service');

let schemaPromise;
const TTL_MINUTOS = 15;
const ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function falhar(mensagem) {
  const erro = new Error(mensagem);
  erro.isValidation = true;
  throw erro;
}
function texto(valor) { return String(valor ?? '').trim(); }
function normalizar(valor) {
  return texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
function inteiro(valor, campo, minimo = 1, maximo = 999999999) {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < minimo || n > maximo) falhar(`Campo inválido: ${campo}.`);
  return n;
}
function moeda(valor, campo) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > 10000000 || Math.abs(Math.round(n * 100) - n * 100) > 0.0000001) {
    falhar(`Campo inválido: ${campo}; informe reais com até duas casas decimais.`);
  }
  return Math.round(n * 100) / 100;
}
function dataPedido(valor) {
  const hoje = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const partes = Object.fromEntries(hoje.map(p => [p.type, p.value]));
  const v = valor === undefined ? `${partes.year}-${partes.month}-${partes.day}` : texto(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) {
    falhar('Data inválida. Use AAAA-MM-DD.');
  }
  return v;
}
async function estrutura() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_pedidos_rascunhos (
        id UUID PRIMARY KEY,
        codigo_hash CHAR(64) NOT NULL,
        payload JSONB NOT NULL,
        resumo JSONB NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'aguardando_confirmacao',
        pedido_resultado JSONB,
        erro TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expira_em TIMESTAMPTZ NOT NULL,
        confirmado_em TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_pedidos_rascunhos_status
        ON mcp_pedidos_rascunhos(status, expira_em);
    `).catch(err => { schemaPromise = null; throw err; });
  }
  return schemaPromise;
}
function sha(valor) { return crypto.createHash('sha256').update(valor).digest('hex'); }

async function buscarClientes({ nome }) {
  if (texto(nome).length < 2 || texto(nome).length > 100) falhar('Informe pelo menos duas letras do cliente.');
  // O bridge pode ignorar filtros; a filtragem local restringe a saída do MCP.
  const rows = await clientesService.listarClientes({ nome: texto(nome) });
  const encontrados = (Array.isArray(rows) ? rows : []).filter(c =>
    normalizar(c.nome || c.razao_social || c.fantasia).includes(normalizar(nome))
  );
  return {
    total_encontrado: encontrados.length,
    clientes: encontrados.slice(0, 15).map(c => ({
      favorecido: c.favorecido,
      nome: texto(c.nome || c.razao_social || c.fantasia),
      cidade: texto(c.cidade) || null,
      uf: texto(c.uf) || null
    }))
  };
}

async function buscarVendedores({ nome = '' } = {}) {
  if (typeof nome !== 'string' || nome.length > 100) falhar('Nome de vendedor inválido.');
  const rows = await vendedoresService.listarVendedores({});
  const encontrados = (Array.isArray(rows) ? rows : []).filter(v =>
    !nome.trim() || normalizar(v.nome || v.razao_social || v.fantasia).includes(normalizar(nome))
  );
  return { total_encontrado: encontrados.length,
    vendedores: encontrados.slice(0, 30).map(v => ({
      favorecido: Number(v.favorecido ?? v.codigo ?? v.id),
      nome: texto(v.nome || v.razao_social || v.fantasia)
    })).filter(v => Number.isSafeInteger(v.favorecido) && v.favorecido > 0) };
}

async function buscarProdutos({ nome, modalidade = 'orcamento' }) {
  if (texto(nome).length < 2 || texto(nome).length > 100) falhar('Informe pelo menos duas letras do produto.');
  if (!['orcamento', 'kit-feirinha'].includes(modalidade)) falhar('Modalidade inválida.');
  const produtos = await produtoService.listar({ busca: texto(nome), apenasAtivos: true, perfil: modalidade });
  return {
    total_encontrado: produtos.length,
    produtos: produtos.slice(0, 20).map(p => ({
      produto_id: p.id,
      nome: p.nome,
      preco_referencia: Number(p.preco),
      item_legado: p.item_legado || null,
      pode_inserir: Boolean(p.item_legado)
    }))
  };
}

async function prepararPedido(args) {
  const favorecido = inteiro(args.favorecido, 'favorecido');
  const vendedor = inteiro(args.vendedor, 'vendedor');
  const volumes = inteiro(args.volumes ?? 0, 'volumes', 0, 100000);
  const modalidade = args.modalidade ?? 'orcamento';
  if (!['orcamento', 'kit-feirinha'].includes(modalidade)) falhar('Modalidade inválida.');
  const data = dataPedido(args.data);
  const obs = texto(args.observacao);
  if (obs.length > 1000) falhar('Observação muito longa (limite de 1000 caracteres).');
  const carrada = args.carrada_codigo == null ? null : inteiro(args.carrada_codigo, 'carrada_codigo');
  if (!Array.isArray(args.itens) || !args.itens.length || args.itens.length > 25) {
    falhar('O pedido deve ter de 1 a 25 itens.');
  }
  const [cliente, vendedorDados] = await Promise.all([
    clientesService.buscarCliente(favorecido),
    vendedoresService.buscarVendedor(vendedor)
  ]);
  if (!cliente) falhar('Cliente não encontrado; consulte os clientes antes de preparar o pedido.');
  if (!vendedorDados) falhar('Vendedor não encontrado.');
  const itens = [];
  const ids = new Set();
  for (const [i, entrada] of args.itens.entries()) {
    const id = inteiro(entrada.produto_id, `itens[${i}].produto_id`);
    if (ids.has(id)) falhar('Produto repetido. Agrupe a quantidade em um único item.');
    ids.add(id);
    const quantidade = inteiro(entrada.quantidade, `itens[${i}].quantidade`, 1, 100000);
    let produto;
    try { produto = await produtoService.buscar(id); }
    catch (_) { falhar(`Produto ${id} não encontrado.`); }
    if (produto.ativo === false || !produto.item_legado ||
        (modalidade === 'orcamento' && produto.perfil_orcamento !== true) ||
        (modalidade === 'kit-feirinha' && produto.perfil_kit_feirinha !== true)) {
      falhar(`Produto ${id} inativo, sem vínculo ao legado ou não disponível na modalidade.`);
    }
    if (produto.preco === null || produto.preco === undefined || texto(produto.preco) === '') {
      falhar(`Produto ${produto.nome} está sem preço cadastrado.`);
    }
    const referencia = moeda(produto.preco, 'preco_referencia');
    if (referencia <= 0) falhar(`Produto ${produto.nome} possui preço de referência zerado. Revise no cadastro.`);
    const preco = entrada.preco === undefined ? referencia : moeda(entrada.preco, 'preco');
    if (preco < referencia) {
      falhar(`Preço do produto ${produto.nome} abaixo da referência (R$ ${referencia.toFixed(2)}). O MCP não autoriza descontos; revise no sistema.`);
    }
    const subtotal = Math.round(preco * 100) * quantidade;
    itens.push({
      produto_id: id, nome: produto.nome, quantidade,
      preco, preco_referencia: referencia,
      subtotal: subtotal / 100
    });
  }
  const totalCentavos = itens.reduce((s, i) => s + Math.round(i.subtotal * 100), 0);
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos > 1000000000) falhar('Total do pedido fora do limite.');
  const total = totalCentavos / 100;
  const payload = {
    data, favorecido, vendedor, volumes, total,
    carrada_codigo: carrada, obs: obs || null,
    aviso_whatsapp_carrada: Boolean(carrada),
    itens: itens.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco: i.preco }))
  };
  const resumo = {
    cliente: { favorecido, nome: texto(cliente.nome || cliente.razao_social || cliente.fantasia) },
    vendedor: { favorecido: vendedor, nome: texto(vendedorDados.nome || vendedorDados.razao_social) },
    data, modalidade, volumes, carrada_codigo: carrada, observacao: obs || null,
    aviso_whatsapp_carrada: Boolean(carrada),
    itens, total
  };
  await estrutura();
  const id = crypto.randomUUID();
  const codigo = crypto.randomBytes(5).toString('hex').toUpperCase();
  await pool.query(`
    INSERT INTO mcp_pedidos_rascunhos(id, codigo_hash, payload, resumo, expira_em)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW() + INTERVAL '15 minutes')
  `, [id, sha(codigo), JSON.stringify(payload), JSON.stringify(resumo)]);
  return {
    status: 'aguardando_confirmacao', rascunho_id: id, codigo_confirmacao: codigo,
    expira_em_minutos: TTL_MINUTOS, resumo,
    instrucoes: 'Mostre cliente, itens, preços e total. Se existir carrada, informe que confirmar o pedido também dispara automaticamente o aviso WhatsApp de entrada na carrada, pela rotina da Inserção V2. Somente execute confirmar_pedido após confirmação explícita do usuário em resposta posterior.'
  };
}

async function consultarRascunho({ rascunho_id }) {
  if (!ID_RE.test(texto(rascunho_id))) falhar('ID do rascunho inválido.');
  await estrutura();
  const r = await pool.query(`
    SELECT id, status, resumo, pedido_resultado, erro, expira_em, confirmado_em
    FROM mcp_pedidos_rascunhos WHERE id=$1
  `, [rascunho_id]);
  if (!r.rows.length) falhar('Rascunho não encontrado.');
  const row = r.rows[0];
  return {
    rascunho_id: row.id, status: row.status,
    expirado: new Date(row.expira_em).getTime() < Date.now(),
    resumo: row.resumo, pedido_resultado: row.pedido_resultado,
    revisao_manual_necessaria: row.status === 'revisao_necessaria',
    confirmado_em: row.confirmado_em
  };
}

async function confirmarPedido({ rascunho_id, codigo_confirmacao, confirmacao }) {
  if (!ID_RE.test(texto(rascunho_id))) falhar('ID do rascunho inválido.');
  if (confirmacao !== 'CONFIRMO') falhar('A gravação exige confirmação explícita: CONFIRMO.');
  if (!/^[A-F0-9]{10}$/.test(texto(codigo_confirmacao))) falhar('Código de confirmação inválido.');
  await estrutura();
  // Reserva atômica: somente uma chamada pode sair para o Firebird.
  const claim = await pool.query(`
    UPDATE mcp_pedidos_rascunhos
    SET status = 'em_processamento'
    WHERE id = $1 AND codigo_hash = $2
      AND status = 'aguardando_confirmacao' AND expira_em > NOW()
    RETURNING payload
  `, [rascunho_id, sha(codigo_confirmacao)]);
  if (!claim.rows.length) {
    const atual = await consultarRascunho({ rascunho_id });
    return { ...atual, mensagem: 'Rascunho expirado, inválido, já utilizado ou sendo processado. Não reenviar a gravação.' };
  }
  try {
    const payload = claim.rows[0].payload;
    // Revalida a tabela imediatamente antes da escrita. Alteração de preço
    // invalida a prévia antiga; a mesma tentativa nunca é reaberta.
    for (const item of payload.itens) {
      const atual = await produtoService.buscar(item.produto_id);
      if (!atual || atual.ativo === false || !atual.item_legado ||
          moeda(atual.preco, 'preco_atual') > Number(item.preco)) {
        await pool.query(`
          UPDATE mcp_pedidos_rascunhos SET status='revisao_necessaria',
            erro='Produto ou preço alterado desde a preparação. Refaça a prévia.'
          WHERE id=$1
        `, [rascunho_id]);
        return { status: 'revisao_necessaria', rascunho_id,
          mensagem: 'Produto ou preço alterado desde a preparação. Faça um novo rascunho; nada foi gravado.' };
      }
    }
    const resultado = await pedidosService.inserirPedido(payload);
    const pedido = resultado?.pedido || resultado?.data?.pedido || resultado?.data || resultado;
    const numero = texto(pedido?.numero);
    if (!numero) {
      await pool.query(`
        UPDATE mcp_pedidos_rascunhos SET status='revisao_necessaria', pedido_resultado=$2::jsonb,
          erro='O legado respondeu sem número de pedido. Verifique no sistema antes de qualquer novo envio.'
        WHERE id=$1
      `, [rascunho_id, JSON.stringify(resultado)]);
      return { status: 'revisao_necessaria', rascunho_id, mensagem: 'O legado não retornou o número. Verifique o pedido antes de tentar novamente.' };
    }
    await pool.query(`
      UPDATE mcp_pedidos_rascunhos
      SET status='confirmado', pedido_resultado=$2::jsonb, confirmado_em=NOW()
      WHERE id=$1
    `, [rascunho_id, JSON.stringify(resultado)]);
    return {
      status: 'confirmado', rascunho_id, numero_pedido: numero, resultado,
      aviso_whatsapp_carrada: resultado?.avisoWhatsappCarrada || null,
      observacao_envio: payload.aviso_whatsapp_carrada
        ? 'Verifique aviso_whatsapp_carrada: aceito_pelo_provedor não significa entregue; falhas não devem causar reenvio do pedido.'
        : null
    };
  } catch (err) {
    // Em erro de rede, a operação no Firebird pode ter sido concluída.
    // Nunca liberar a mesma tentativa para reenvio automático.
    await pool.query(`
      UPDATE mcp_pedidos_rascunhos SET status='revisao_necessaria',
        erro='A gravação teve resultado incerto. Conferir no legado antes de repetir.'
      WHERE id=$1
    `, [rascunho_id]);
    return { status: 'revisao_necessaria', rascunho_id, mensagem: 'Resultado da gravação incerto. Conferir o sistema legado; não reenviar automaticamente.' };
  }
}

module.exports = { buscarClientes, buscarVendedores, buscarProdutos, prepararPedido, confirmarPedido, consultarRascunho };
