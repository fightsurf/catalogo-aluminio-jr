'use strict';
// Intenções administrativas privadas, independentes das intenções de atendimento.
const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const pagamentos = require('../legado/pagamentos/pagamentos.service');
const clientesLegado = require('../legado/clientes/clientes.service');
const pedidosCliente = require('../legado/pedidos-cliente/pedidos-cliente.service');
const envio = require('./envio-whatsapp.service');
const classificador = require('./classificador-intencoes-admin.service');
const acoesAdmin = require('./acoes-admin.service');

const ACOES = Object.freeze({
  localizar_cliente: 'Localizar cliente',
  ultimos_pedidos_cliente: 'Localizar últimos pedidos do cliente',
  configurada: 'Ação configurável',
  etapa_futura: 'Etapa futura (sem execução)'
});
const ACOES_EXECUTAVEIS = new Set(['localizar_cliente', 'ultimos_pedidos_cliente', 'configurada']);
const sessoes = new Map();
const SESSAO_MS = 10 * 60 * 1000;
let preparando = null;

async function preparar() {
  if (!preparando) {
    preparando = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_admin_intencoes (
          id BIGSERIAL PRIMARY KEY,
          chave VARCHAR(90) NOT NULL UNIQUE,
          nome VARCHAR(120) NOT NULL,
          descricao TEXT NOT NULL DEFAULT '',
          acao VARCHAR(60) NOT NULL CHECK (acao IN ('localizar_cliente')),
          frases TEXT NOT NULL,
          ativo BOOLEAN NOT NULL DEFAULT TRUE,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // Migração compatível com cadastros anteriores.
      await pool.query("ALTER TABLE whatsapp_admin_intencoes ADD COLUMN IF NOT EXISTS descricao TEXT NOT NULL DEFAULT ''");
      await pool.query("ALTER TABLE whatsapp_admin_intencoes ADD COLUMN IF NOT EXISTS proximas_intencoes BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[]");
      await pool.query('ALTER TABLE whatsapp_admin_intencoes ADD COLUMN IF NOT EXISTS acao_id BIGINT');
      // Migração compatível: etapas futuras são inativas até existir um executor.
      await pool.query("ALTER TABLE whatsapp_admin_intencoes DROP CONSTRAINT IF EXISTS whatsapp_admin_intencoes_acao_check");
      await pool.query("ALTER TABLE whatsapp_admin_intencoes ADD CONSTRAINT whatsapp_admin_intencoes_acao_check CHECK (acao IN ('localizar_cliente','ultimos_pedidos_cliente','configurada','etapa_futura'))");
      await pool.query(`UPDATE whatsapp_admin_intencoes SET descricao =
        'Localiza os clientes cadastrados na Alumínio JR pelo nome completo ou parcial e retorna a lista por WhatsApp. Não modifica cadastros.'
        WHERE acao = 'localizar_cliente' AND TRIM(descricao) = ''`);
      await pool.query(`
        INSERT INTO whatsapp_admin_intencoes (chave, nome, descricao, acao, frases, ativo)
        VALUES ('localizar_cliente', 'Localizar cliente',
                'Localiza os clientes cadastrados pelo nome ou parte do nome e devolve a lista por WhatsApp. Não altera clientes.',
                'localizar_cliente',
                'localize cliente\nlocalizar cliente\nprocure cliente\nbusque cliente', TRUE)
        ON CONFLICT (chave) DO NOTHING`);
    })().catch(error => { preparando = null; throw error; });
  }
  await preparando;
}

function validar(dados) {
  const nome = String(dados?.nome || '').trim();
  const acao = String(dados?.acao || '').trim();
  const descricao = String(dados?.descricao || '').trim();
  const frases = String(dados?.frases || '').replace(/\r/g, '').trim();
  if (nome.length < 3 || nome.length > 120) throw new Error('Nome deve ter de 3 a 120 caracteres.');
  if (descricao.length < 12 || descricao.length > 800) throw new Error('Descreva a intenção em 12 a 800 caracteres.');
  if (!Object.hasOwn(ACOES, acao)) throw new Error('Ação administrativa indisponível.');
  const acaoId = acao === 'configurada' ? Number(dados?.acao_id) : null;
  if (acao === 'configurada' && (!Number.isSafeInteger(acaoId) || acaoId <= 0)) {
    throw new Error('Selecione uma ação cadastrada.');
  }
  if (!ACOES_EXECUTAVEIS.has(acao) && dados?.ativo !== false) {
    throw new Error('Uma etapa sem ação implementada deve permanecer inativa.');
  }
  const proximas = dados?.proximas_intencoes ?? [];
  if (!Array.isArray(proximas) || proximas.length > 20 ||
      proximas.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Vincule até 20 próximas intenções válidas.');
  }
  const proximasIntencoes = [...new Set(proximas.map(Number))];
  const lista = frases.split('\n').map(x => x.trim()).filter(Boolean);
  if (!lista.length || lista.length > 20 || lista.some(x => x.length < 5 || x.length > 100)) {
    throw new Error('Informe de 1 a 20 frases, uma por linha, com 5 a 100 caracteres.');
  }
  return { nome, descricao, acao, acaoId, frases: lista.join('\n'), ativo: dados.ativo !== false, proximasIntencoes };
}
async function listar() {
  await preparar();
  const r = await pool.query(`
    SELECT id, chave, nome, descricao, acao, acao_id, frases, ativo, proximas_intencoes, criado_em, atualizado_em
    FROM whatsapp_admin_intencoes ORDER BY id ASC`);
  return r.rows;
}
async function validarVinculos(ids, idAtual = null) {
  if (!ids.length) return;
  if (idAtual && ids.includes(Number(idAtual))) throw new Error('Uma intenção não pode apontar para ela mesma.');
  const r = await pool.query('SELECT id FROM whatsapp_admin_intencoes WHERE id = ANY($1::BIGINT[])', [ids]);
  if (r.rows.length !== ids.length) throw new Error('Uma das próximas intenções não existe mais. Atualize a lista.');
}
async function cadastrar(dados) {
  const d = validar(dados);
  await preparar();
  await validarVinculos(d.proximasIntencoes);
  if (d.acaoId && !(await acoesAdmin.obter(d.acaoId))?.ativo) throw Error('Ação cadastrada inexistente ou inativa.');
  const chave = 'int_' + crypto.randomUUID().replace(/-/g, '');
  const r = await pool.query(`
    INSERT INTO whatsapp_admin_intencoes (chave, nome, descricao, acao, acao_id, frases, ativo, proximas_intencoes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::BIGINT[]) RETURNING *`,
    [chave, d.nome, d.descricao, d.acao, d.acaoId, d.frases, d.ativo, d.proximasIntencoes]);
  return r.rows[0];
}
async function atualizar(id, dados) {
  const d = validar(dados);
  await preparar();
  await validarVinculos(d.proximasIntencoes, id);
  if (d.acaoId && !(await acoesAdmin.obter(d.acaoId))?.ativo) throw Error('Ação cadastrada inexistente ou inativa.');
  const r = await pool.query(`
    UPDATE whatsapp_admin_intencoes
    SET nome=$2, descricao=$3, acao=$4, acao_id=$5, frases=$6, ativo=$7, proximas_intencoes=$8::BIGINT[], atualizado_em=NOW()
    WHERE id=$1 RETURNING *`,
    [id, d.nome, d.descricao, d.acao, d.acaoId, d.frases, d.ativo, d.proximasIntencoes]);
  if (!r.rows.length) throw new Error('Intenção não encontrada.');
  return r.rows[0];
}
async function excluir(id) {
  await preparar();
  const r = await pool.query('DELETE FROM whatsapp_admin_intencoes WHERE id=$1 RETURNING id', [id]);
  if (!r.rows.length) throw new Error('Intenção não encontrada.');
  await pool.query('UPDATE whatsapp_admin_intencoes SET proximas_intencoes = array_remove(proximas_intencoes, $1::BIGINT) WHERE $1::BIGINT = ANY(proximas_intencoes)', [id]);
  return true;
}
function semAcentos(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function identificar(texto, intencoes) {
  let original = String(texto || '').trim().slice(0, 1000);
  original = original.replace(/^sistema\b\s*[,.:;!?\-]*\s*/i, '');
  const normal = semAcentos(original);
  for (const intencao of intencoes) {
    if (!intencao.ativo || !ACOES_EXECUTAVEIS.has(intencao.acao)) continue;
    const frases = String(intencao.frases || '').split('\n').map(x => x.trim()).filter(Boolean);
    frases.sort((a,b) => b.length - a.length);
    for (const frase of frases) {
      const esperada = semAcentos(frase);
      if (normal === esperada) return { intencao, argumento: '' };
      if (normal.startsWith(esperada + ' ')) {
        // Mantém os acentos do nome ditado, em vez de utilizar o texto normalizado.
        const palavras = frase.split(/\s+/).length;
        const argumento = original.split(/\s+/).slice(palavras).join(' ').replace(/^[,.:;\- ]+/, '').trim();
        return { intencao, argumento };
      }
    }
  }
  return null;
}
function normalizarNome(nome) {
  const resultado = String(nome || '').replace(/\s+/g, ' ').trim().replace(/[.,!?;]+$/, '');
  if (resultado.length < 2 || resultado.length > 100) return '';
  return resultado;
}
const LIMITE_CLIENTES_RESPOSTA = 5;
function telefoneCliente(cliente) {
  return String(cliente?.telefonePrincipal || cliente?.telefone_principal ||
    cliente?.telefone1 || cliente?.telefone || cliente?.fone1 || cliente?.fOne1 ||
    cliente?.celular || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function telefoneExibicao(valor) {
  const telefone = String(valor || '').replace(/\D/g, '');
  const nacional = telefone.startsWith('55') && (telefone.length === 12 || telefone.length === 13)
    ? telefone.slice(2) : telefone;
  const prefixo = nacional !== telefone ? '+55 ' : '';
  if (nacional.length === 11) {
    return prefixo + '(' + nacional.slice(0, 2) + ') ' + nacional.slice(2, 7) +
      '-' + nacional.slice(7);
  }
  if (nacional.length === 10) {
    return prefixo + '(' + nacional.slice(0, 2) + ') ' + nacional.slice(2, 6) +
      '-' + nacional.slice(6);
  }
  return String(valor || '').trim() || 'Não informado';
}
async function completarTelefones(lista, buscarCliente) {
  // A consulta de pagamentos pode retornar apenas nome e cidade. Busca detalhes
  // exclusivamente dos cinco clientes exibidos, sem alterar qualquer cadastro.
  return Promise.all(lista.slice(0, LIMITE_CLIENTES_RESPOSTA).map(async cliente => {
    if (telefoneCliente(cliente) || !cliente?.favorecido) return cliente;
    try {
      const detalhe = await buscarCliente(cliente.favorecido);
      if (!detalhe || Number(detalhe.favorecido) !== Number(cliente.favorecido)) return cliente;
      return { ...cliente, telefonePrincipal: telefoneCliente(detalhe) };
    } catch (_) {
      // A indisponibilidade de um telefone não impede a resposta aos demais.
      return cliente;
    }
  }));
}
function respostasClientes(nome, clientes) {
  if (!clientes.length) return ['Não encontrei clientes com o nome "' + nome + '". Informe outro nome.'];
  const linhas = clientes.slice(0, LIMITE_CLIENTES_RESPOSTA).map((c, i) => {
    const nomeCliente = String(c.nome || 'Sem nome').replace(/\s+/g, ' ').trim()
      .replace(/\*/g, '').slice(0, 120);
    const cidade = [c.cidade, c.uf].filter(Boolean)
      .map(x => String(x).replace(/\s+/g, ' ').trim().slice(0, 55)).join('/');
    const telefone = telefoneExibicao(telefoneCliente(c));
    return (i + 1) + '. *' + nomeCliente + '*\n' +
      'Cidade: ' + (cidade || 'Não informada') + '\n' +
      'Telefone: ' + telefone;
  });
  return ['Clientes encontrados para "' + nome + '":\n\n' + linhas.join('\n\n')];
}
function limparSessoes() {
  const agora = Date.now();
  for (const [tel, s] of sessoes) if (s.expira < agora) sessoes.delete(tel);
}
function indiceCliente(texto) {
  const valor = semAcentos(texto);
  const match = valor.match(/^(?:(?:quero|escolho|seleciono)(?: o)?|opcao|numero|cliente)?\s*(10|[1-9])$/);
  return match ? Number(match[1]) - 1 : null;
}
function idsProximas(intencao) {
  return Array.isArray(intencao?.proximas_intencoes)
    ? intencao.proximas_intencoes.map(Number).filter(Number.isSafeInteger) : [];
}
function executavel(intencao, catalogo = []) {
  return !!intencao?.ativo && (intencao.acao === 'configurada'
    ? catalogo.some(a => a.ativo && Number(a.id) === Number(intencao.acao_id))
    : ACOES_EXECUTAVEIS.has(intencao.acao));
}
function resumoSelecao(cliente, origem, cadastradas, catalogo = []) {
  const nome = String(cliente?.nome || 'Cliente').replace(/\*/g, '').trim().slice(0, 120);
  const ids = idsProximas(origem);
  const proximas = cadastradas.filter(i => ids.includes(Number(i.id)));
  const executaveis = proximas.filter(i => executavel(i, catalogo));
  let mensagem = 'Cliente selecionado: *' + nome + '*.';
  if (executaveis.length) {
    mensagem += '\n\nO que deseja fazer com esse cliente?\n' +
      executaveis.map((i, n) => (n + 1) + '. ' + i.nome).join('\n');
  } else if (proximas.length) {
    mensagem += '\n\nHá próximas intenções cadastradas, mas nenhuma está ativa e implementada.';
  } else {
    mensagem += '\n\nAinda não há próxima intenção vinculada. Você pode iniciar outro comando.';
  }
  return { mensagem, executaveis };
}
function chaveDataPedido(valor) {
  const texto = String(valor || '').trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1] + iso[2] + iso[3]);
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return Number(br[3] + br[2] + br[1]);
  const milissegundos = Date.parse(texto);
  return Number.isFinite(milissegundos) ? Math.floor(milissegundos / 86400000) : 0;
}
function dataPedido(valor) {
  const texto = String(valor || '').trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return br[1] + '/' + br[2] + '/' + br[3];
  return texto || 'Não informada';
}
async function respostaUltimosPedidos(cliente, deps = {}) {
  const favorecido = Number(cliente?.favorecido);
  if (!Number.isSafeInteger(favorecido) || favorecido <= 0) {
    throw new Error('Código inválido do cliente selecionado para consultar pedidos.');
  }
  const consultar = deps.listarPedidosPorCliente || pedidosCliente.listarPedidosPorCliente;
  const resultado = await consultar(favorecido);
  const pedidos = (Array.isArray(resultado?.dados) ? resultado.dados : [])
    .filter(p => p && String(p.numero ?? '').trim())
    .sort((a, b) => chaveDataPedido(b.data) - chaveDataPedido(a.data) ||
      Number(b.numero || 0) - Number(a.numero || 0))
    .slice(0, 5);
  const nome = String(cliente.nome || 'Cliente').replace(/\*/g, '').trim().slice(0, 120);
  if (!pedidos.length) return 'Não encontrei pedidos para o cliente *' + nome + '*.';
  const linhas = pedidos.map((pedido, i) => {
    const numero = String(pedido.numero).replace(/\*/g, '').trim().slice(0, 40);
    const total = Number(pedido.total);
    const valor = (Number.isFinite(total) ? total : 0).toLocaleString('pt-BR', {
      style: 'currency', currency: 'BRL'
    });
    const situacao = pedido.cancelado ? '\nSituação: Cancelado' : '';
    return (i + 1) + '. *Pedido ' + numero + '*\nData: ' + dataPedido(pedido.data) +
      '\nValor: ' + valor + situacao;
  });
  return 'Últimos pedidos de *' + nome + '*:\n\n' + linhas.join('\n\n');
}

async function processarMensagem({ telefone, texto, permitido = false }, deps = {}) {
  // O chamador verifica previamente número, instância, direção e eventual LID.
  if (!permitido || !/^\d{10,15}$/.test(String(telefone || ''))) return { reconhecido: false };
  limparSessoes();
  const busca = deps.listarClientes || pagamentos.listarClientes;
  const enviar = deps.enviar || envio.enviarMensagem;
  const buscarIntencoes = deps.listarIntencoes || listar;
  const frase = String(texto || '').trim().slice(0, 1000);
  const pendente = sessoes.get(telefone);
  async function responderUltimosPedidos(intencao, sessao) {
    const mensagem = await respostaUltimosPedidos(sessao.cliente, deps);
    sessoes.set(telefone, { ...sessao, expira: Date.now() + SESSAO_MS });
    await enviar({ telefone, mensagem });
    return { reconhecido: true, intencao: intencao.nome, acao: intencao.acao, resposta: mensagem };
  }
  if (semAcentos(frase) === 'cancelar' && pendente) {
    sessoes.delete(telefone);
    const mensagem = 'Atendimento administrativo cancelado.';
    await enviar({ telefone, mensagem });
    return { reconhecido: true, intencao: 'Cancelar', acao: 'cancelar', resposta: mensagem };
  }
  const todas = await buscarIntencoes();
  const catalogoAcoes = todas.some(i => i.acao === 'configurada' && i.acao_id)
    ? await (deps.listarAcoes || acoesAdmin.listar)() : [];
  const cadastradas = todas.filter(i => executavel(i, catalogoAcoes));
  async function responderConfigurada(intencao, sessao, termo = '') {
    const acao = catalogoAcoes.find(a => a.ativo && Number(a.id) === Number(intencao.acao_id));
    if (!acao) throw Error('Ação configurada indisponível.');
    if (acao.entidade === 'pedidos' && !sessao?.cliente) {
      const mensagem = 'Primeiro localize e selecione um cliente para consultar os pedidos.';
      await enviar({ telefone, mensagem });
      return { reconhecido:true, intencao:intencao.nome, acao:'configurada', resposta:mensagem };
    }
    if (acao.entidade === 'clientes' && !String(termo).trim()) {
      const mensagem = 'Informe o nome do cliente na pesquisa.';
      await enviar({ telefone, mensagem });
      return { reconhecido:true, intencao:intencao.nome, acao:'configurada', resposta:mensagem };
    }
    const resultado = await acoesAdmin.executar(acao, { cliente:sessao?.cliente,termo }, deps);
    let mensagem = resultado.mensagem;
    if (resultado.entidade === 'clientes' && resultado.registros.length) {
      const candidatos = resultado.registros.map(c => ({ favorecido:c.favorecido,nome:c.nome,cidade:c.cidade,uf:c.uf }));
      sessoes.set(telefone,{etapa:'escolher_cliente',candidatos,intencaoId:intencao.id,expira:Date.now()+SESSAO_MS});
      mensagem += '\n\nResponda com um número de 1 a ' + candidatos.length + ' para selecionar o cliente.';
    } else if (sessao?.cliente) {
      sessoes.set(telefone,{...sessao,expira:Date.now()+SESSAO_MS});
    }
    await enviar({ telefone, mensagem });
    return { reconhecido:true,intencao:intencao.nome,acao:'configurada',resposta:mensagem };
  }
  // Números durante o wizard são escolhas e não passam pela IA.
  if (pendente?.etapa === 'escolher_cliente' || pendente?.etapa === 'cliente_selecionado') {
    const indice = indiceCliente(frase);
    if (indice !== null) {
      if (pendente.etapa === 'escolher_cliente') {
        const cliente = pendente.candidatos?.[indice];
        if (!cliente) {
          const mensagem = 'Opção inválida. Escolha um número de 1 a ' + pendente.candidatos.length + '.';
          await enviar({ telefone, mensagem });
          return { reconhecido: true, intencao: 'Selecionar cliente', acao: 'selecionar_cliente', resposta: mensagem };
        }
        const origem = todas.find(i => Number(i.id) === Number(pendente.intencaoId));
        const { mensagem, executaveis } = resumoSelecao(cliente, origem, todas, catalogoAcoes);
        sessoes.set(telefone, { etapa: 'cliente_selecionado',
          cliente: { favorecido: cliente.favorecido, nome: cliente.nome, cidade: cliente.cidade, uf: cliente.uf },
          opcoes: executaveis.map(i => Number(i.id)), expira: Date.now() + SESSAO_MS });
        await enviar({ telefone, mensagem });
        return { reconhecido: true, intencao: 'Selecionar cliente', acao: 'selecionar_cliente', resposta: mensagem };
      }
      const proxima = todas.find(i => Number(i.id) === pendente.opcoes?.[indice] &&
        executavel(i, catalogoAcoes));
      if (proxima && proxima.acao === 'localizar_cliente') {
        sessoes.set(telefone, { etapa: 'aguardando_nome', expira: Date.now() + SESSAO_MS });
        const mensagem = 'Qual é o nome do cliente que deseja localizar?';
        await enviar({ telefone, mensagem });
        return { reconhecido: true, intencao: proxima.nome, acao: proxima.acao, resposta: mensagem };
      }
      if (proxima && proxima.acao === 'ultimos_pedidos_cliente') {
        return responderUltimosPedidos(proxima, pendente);
      }
      if (proxima && proxima.acao === 'configurada') {
        return responderConfigurada(proxima, pendente);
      }
      const mensagem = 'Escolha uma opção disponível ou diga "localize cliente" para iniciar outra busca.';
      await enviar({ telefone, mensagem });
      return { reconhecido: true, intencao: 'Selecionar intenção', acao: 'selecionar_intencao', resposta: mensagem };
    }
  }
  // A IA recebe a transcrição com todas as intenções executáveis e descrições.
  const classificar = deps.classificar || classificador.classificar;
  const encontrado = await classificar(frase, cadastradas);
  if (!encontrado?.intencao && pendente?.etapa !== 'aguardando_nome') {
    if (pendente?.etapa === 'escolher_cliente') {
      const mensagem = 'Escolha o número do cliente na lista (1 a ' + pendente.candidatos.length +
        ') ou diga "localize cliente" para começar outra busca.';
      await enviar({ telefone, mensagem });
      return { reconhecido: true, intencao: 'Selecionar cliente', acao: 'selecionar_cliente', resposta: mensagem };
    }
    return { reconhecido: false, motivo: 'intencao_nao_reconhecida' };
  }
  if (encontrado?.intencao?.acao === 'configurada') {
    return responderConfigurada(encontrado.intencao,pendente?.etapa === 'cliente_selecionado' ? pendente : null,encontrado.argumento);
  }
  if (encontrado?.intencao?.acao === 'ultimos_pedidos_cliente') {
    if (pendente?.etapa === 'cliente_selecionado' &&
        pendente.opcoes?.includes(Number(encontrado.intencao.id))) {
      return responderUltimosPedidos(encontrado.intencao, pendente);
    }
    const mensagem = pendente?.etapa === 'escolher_cliente'
      ? 'Primeiro escolha o número do cliente na lista para consultar seus pedidos.'
      : 'Primeiro localize e selecione um cliente para consultar os últimos pedidos.';
    await enviar({ telefone, mensagem });
    return { reconhecido: true, intencao: encontrado.intencao.nome,
      acao: encontrado.intencao.acao, resposta: mensagem };
  }
  if (encontrado?.intencao && encontrado.intencao.acao !== 'localizar_cliente') {
    return { reconhecido: false, motivo: 'acao_indisponivel' };
  }
  const nome = normalizarNome(encontrado?.intencao ? encontrado.argumento : frase);
  if (!nome) {
    sessoes.set(telefone, { etapa: 'aguardando_nome', expira: Date.now() + SESSAO_MS });
    const mensagem = 'Qual é o nome do cliente que deseja localizar?';
    await enviar({ telefone, mensagem });
    return { reconhecido: true, intencao: encontrado?.intencao?.nome || 'Localizar cliente',
      acao: 'localizar_cliente', resposta: mensagem };
  }
  const encontrados = await busca(nome);
  const primeiros = Array.isArray(encontrados) ? encontrados.slice(0, LIMITE_CLIENTES_RESPOSTA) : [];
  const comTelefones = await completarTelefones(primeiros, deps.buscarCliente || clientesLegado.buscarCliente);
  let mensagem = respostasClientes(nome, comTelefones).join('\n\n');
  if (comTelefones.length) {
    sessoes.set(telefone, { etapa: 'escolher_cliente',
      candidatos: comTelefones.map(c => ({ favorecido:c.favorecido, nome:c.nome, cidade:c.cidade, uf:c.uf })),
      intencaoId: encontrado?.intencao?.id || todas.find(i => i.acao === 'localizar_cliente')?.id,
      expira: Date.now() + SESSAO_MS });
    mensagem += '\n\nResponda com um número de 1 a ' + comTelefones.length + ' para selecionar o cliente.';
  } else {
    sessoes.delete(telefone);
  }
  await enviar({ telefone, mensagem });
  return { reconhecido: true, intencao: encontrado?.intencao?.nome || 'Localizar cliente',
    acao: 'localizar_cliente', resposta: mensagem };
}
module.exports = { ACOES, preparar, listar, cadastrar, atualizar, excluir, identificar,
  respostasClientes, processarMensagem };
