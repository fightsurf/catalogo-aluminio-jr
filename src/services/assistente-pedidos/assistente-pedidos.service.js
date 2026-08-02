const crypto = require('crypto');
const pool = require('../../../db/connection');
const produtoService = require('../produto/produto.service');
const carradasService = require('../legado/carradas/carradas.service');
const pedidosInsercaoV2Service = require('../legado/pedidos-insercao-v2/pedidos-insercao-v2.service');
const clientesService = require('../legado/clientes/clientes.service');
const transportadoraService = require('../logistica/transportadoraService');

const CAPACIDADE_DIARIA = Number(process.env.ASSISTENTE_PEDIDOS_CAPACIDADE_DIARIA || 1100);
const CIDADES = [
  { valor: 'catole-do-rocha', nome: 'Catolé do Rocha', uf: 'PB', coletaFabrica: true },
  { valor: 'sao-bento', nome: 'São Bento', uf: 'PB' },
  { valor: 'brejo-do-cruz', nome: 'Brejo do Cruz', uf: 'PB' },
  { valor: 'jardim-de-piranhas', nome: 'Jardim de Piranhas', uf: 'RN' },
  { valor: 'santa-cruz-do-capibaribe', nome: 'Santa Cruz do Capibaribe', uf: 'PE' }
];

let schemaPromise;

function limparTexto(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

function numero(valor, campo) {
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`Campo inválido: ${campo}`);
  return n;
}

function inteiroPositivo(valor, campo) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Campo inválido: ${campo}`);
  return n;
}

function normalizarPerfil(valor) {
  const perfil = limparTexto(valor).toLowerCase();
  if (['tradicional', 'orcamento', 'orçamento'].includes(perfil)) return 'orcamento';
  if (['kit', 'kit-feirinha', 'feirinha'].includes(perfil)) return 'kit-feirinha';
  throw new Error('Tipo de pedido inválido.');
}

function dataIso(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return limparTexto(valor).slice(0, 10);
  return data.toISOString().slice(0, 10);
}

async function criarEstrutura() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS assistente_pedido_links (
          id BIGSERIAL PRIMARY KEY,
          token_hash CHAR(64) NOT NULL UNIQUE,
          favorecido BIGINT NOT NULL,
          cliente_nome TEXT NOT NULL,
          cliente_cidade TEXT,
          cliente_uf VARCHAR(2),
          ativo BOOLEAN NOT NULL DEFAULT TRUE,
          expira_em TIMESTAMPTZ,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ultimo_acesso_em TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS assistente_pre_pedidos (
          id BIGSERIAL PRIMARY KEY,
          link_id BIGINT REFERENCES assistente_pedido_links(id),
          favorecido BIGINT NOT NULL,
          cliente_nome TEXT NOT NULL,
          modalidade VARCHAR(30) NOT NULL,
          carrada_codigo BIGINT NOT NULL,
          data_entrega DATE NOT NULL,
          cidade VARCHAR(120) NOT NULL,
          uf VARCHAR(2),
          coleta_fabrica BOOLEAN NOT NULL DEFAULT FALSE,
          transportadora_id BIGINT,
          transportadora_nome TEXT,
          quantidade_itens NUMERIC(14,3) NOT NULL,
          total NUMERIC(14,2) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'aguardando_confirmacao',
          observacao TEXT,
          pedido_legado_numero VARCHAR(40),
          erro_confirmacao TEXT,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmado_em TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS assistente_pre_pedido_itens (
          id BIGSERIAL PRIMARY KEY,
          pre_pedido_id BIGINT NOT NULL REFERENCES assistente_pre_pedidos(id) ON DELETE CASCADE,
          produto_id BIGINT NOT NULL,
          item_legado BIGINT,
          nome TEXT NOT NULL,
          foto TEXT,
          quantidade NUMERIC(14,3) NOT NULL,
          preco NUMERIC(14,6) NOT NULL,
          subtotal NUMERIC(14,2) NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_assistente_pre_pedidos_status_criado
          ON assistente_pre_pedidos(status, criado_em DESC);
        CREATE INDEX IF NOT EXISTS idx_assistente_pre_pedidos_carrada
          ON assistente_pre_pedidos(carrada_codigo, status);
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function gerarLink({ favorecido, expira_em }) {
  await criarEstrutura();
  const clienteId = inteiroPositivo(favorecido, 'favorecido');
  const cliente = await clientesService.buscarCliente(clienteId);
  if (!cliente) throw new Error('Cliente não encontrado.');

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const result = await pool.query(
    `INSERT INTO assistente_pedido_links
      (token_hash, favorecido, cliente_nome, cliente_cidade, cliente_uf, expira_em)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, favorecido, cliente_nome, cliente_cidade, cliente_uf, ativo, expira_em, criado_em`,
    [
      tokenHash,
      clienteId,
      limparTexto(cliente.nome) || `Cliente ${clienteId}`,
      limparTexto(cliente.cidade) || null,
      limparTexto(cliente.uf).slice(0, 2) || null,
      expira_em || null
    ]
  );

  return { ...result.rows[0], token };
}

async function buscarLinkPorToken(token, { registrarAcesso = false } = {}) {
  await criarEstrutura();
  const tokenLimpo = limparTexto(token);
  if (!tokenLimpo) throw new Error('Link inválido.');

  const result = await pool.query(
    `SELECT * FROM assistente_pedido_links
     WHERE token_hash = $1
       AND ativo = TRUE
       AND (expira_em IS NULL OR expira_em > NOW())`,
    [hashToken(tokenLimpo)]
  );
  const link = result.rows[0];
  if (!link) throw new Error('Link inválido, expirado ou desativado.');

  if (registrarAcesso) {
    await pool.query('UPDATE assistente_pedido_links SET ultimo_acesso_em = NOW() WHERE id = $1', [link.id]);
  }
  return link;
}

async function obterContextoPublico(token) {
  const link = await buscarLinkPorToken(token, { registrarAcesso: true });
  return {
    cliente: {
      favorecido: link.favorecido,
      nome: link.cliente_nome,
      cidade: link.cliente_cidade,
      uf: link.cliente_uf
    },
    cidades: CIDADES.map((cidade) => ({
      ...cidade,
      rotulo: `${cidade.nome} - ${cidade.uf}`
    })),
    capacidadeDiaria: CAPACIDADE_DIARIA
  };
}

async function listarProdutos(perfil) {
  const perfilNormalizado = normalizarPerfil(perfil);
  return produtoService.listar({ perfil: perfilNormalizado, apenasAtivos: true });
}

function ehFimDeSemana(dataEmIso) {
  const [ano, mes, dia] = String(dataEmIso || '').split('-').map(Number);
  if (!ano || !mes || !dia) return false;
  const diaDaSemana = new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay();
  return diaDaSemana === 0 || diaDaSemana === 6;
}

async function listarDatasDisponiveis(quantidadePedido) {
  const quantidade = numero(quantidadePedido, 'quantidade');
  if (quantidade <= 0) throw new Error('O pedido precisa ter ao menos um item.');
  if (quantidade > CAPACIDADE_DIARIA) return [];

  const [carradas, reservasResult] = await Promise.all([
    carradasService.listarCarradas({ incluirResumoProducao: true }),
    pool.query(`
      SELECT carrada_codigo, COALESCE(SUM(quantidade_itens), 0) AS quantidade_reservada
      FROM assistente_pre_pedidos
      WHERE status IN ('aguardando_confirmacao', 'confirmando', 'erro_confirmacao')
      GROUP BY carrada_codigo
    `)
  ]);
  const reservas = new Map(
    reservasResult.rows.map((row) => [Number(row.carrada_codigo), Number(row.quantidade_reservada || 0)])
  );
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  return (Array.isArray(carradas) ? carradas : [])
    .map((carrada) => {
      const aProduzir = Number(
        carrada.quantidadeItensAProduzir ??
        carrada.quantidade_itens_a_produzir ??
        carrada.resumoProducao?.quantidadeItensAProduzir ??
        0
      );
      const codigo = Number(carrada.codigo);
      const reservado = reservas.get(codigo) || 0;
      const data = dataIso(carrada.data);
      const livre = Math.max(0, CAPACIDADE_DIARIA - aProduzir - reservado);
      return {
        codigo,
        data,
        descricao: limparTexto(carrada.descricao),
        itensAProduzir: aProduzir,
        itensReservados: reservado,
        capacidadeLivre: livre,
        disponivel: livre >= quantidade
      };
    })
    .filter((item) =>
      item.codigo &&
      item.data &&
      !ehFimDeSemana(item.data) &&
      new Date(`${item.data}T00:00:00`) >= hoje &&
      item.disponivel
    )
    .sort((a, b) => a.data.localeCompare(b.data));
}

function removerAcentos(texto) {
  return limparTexto(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function listarTransportadoras(cidadeValor) {
  const cidade = CIDADES.find((item) => item.valor === cidadeValor);
  if (!cidade) throw new Error('Cidade inválida.');
  if (cidade.coletaFabrica) return [];

  const alvo = removerAcentos(cidade.nome);
  const transportadoras = await transportadoraService.listarTransportadoras();
  return transportadoras.filter((item) => removerAcentos(item.nome).includes(alvo));
}

async function validarItens(itensEntrada, modalidade) {
  if (!Array.isArray(itensEntrada) || !itensEntrada.length) throw new Error('Pedido sem itens.');
  const produtos = await listarProdutos(modalidade);
  const mapa = new Map(produtos.map((produto) => [Number(produto.id), produto]));
  const itens = itensEntrada.map((entrada, indice) => {
    const produtoId = inteiroPositivo(entrada.produto_id ?? entrada.produtoId, `itens[${indice}].produto_id`);
    const produto = mapa.get(produtoId);
    if (!produto) throw new Error(`Produto ${produtoId} indisponível para esta modalidade.`);
    const quantidade = numero(entrada.quantidade, `itens[${indice}].quantidade`);
    if (quantidade <= 0) throw new Error(`Quantidade inválida no produto ${produto.nome}.`);
    const preco = Number(produto.preco || 0);
    return {
      produto_id: produtoId,
      item_legado: produto.item_legado || null,
      nome: limparTexto(produto.nome),
      foto: limparTexto(produto.foto) || null,
      quantidade,
      preco,
      subtotal: Number((quantidade * preco).toFixed(2))
    };
  });
  return itens;
}

async function criarPrePedido(token, payload = {}) {
  await criarEstrutura();
  const link = await buscarLinkPorToken(token);
  const modalidade = normalizarPerfil(payload.modalidade);
  const itens = await validarItens(payload.itens, modalidade);
  const quantidadeItens = itens.reduce((soma, item) => soma + item.quantidade, 0);
  const total = Number(itens.reduce((soma, item) => soma + item.subtotal, 0).toFixed(2));
  const carradaCodigo = inteiroPositivo(payload.carrada_codigo, 'carrada_codigo');
  const datas = await listarDatasDisponiveis(quantidadeItens);
  const carrada = datas.find((item) => item.codigo === carradaCodigo);
  if (!carrada) throw new Error('A data selecionada não possui mais capacidade disponível. Escolha outra data.');

  const cidade = CIDADES.find((item) => item.valor === payload.cidade);
  if (!cidade) throw new Error('Cidade inválida.');

  let transportadora = null;
  if (!cidade.coletaFabrica) {
    const disponiveis = await listarTransportadoras(cidade.valor);
    const transportadoraId = inteiroPositivo(payload.transportadora_id, 'transportadora_id');
    transportadora = disponiveis.find((item) => Number(item.id) === transportadoraId);
    if (!transportadora) throw new Error('Transportadora inválida para a cidade selecionada.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serializa a reserva de capacidade para evitar que dois clientes ocupem a mesma vaga simultaneamente.
    await client.query('SELECT pg_advisory_xact_lock($1)', [93001]);
    const datasAtualizadas = await listarDatasDisponiveis(quantidadeItens);
    const carradaAtualizada = datasAtualizadas.find((item) => item.codigo === carradaCodigo);
    if (!carradaAtualizada) {
      throw new Error('A data selecionada acabou de atingir a capacidade. Escolha outra data.');
    }

    const pedidoResult = await client.query(
      `INSERT INTO assistente_pre_pedidos
       (link_id, favorecido, cliente_nome, modalidade, carrada_codigo, data_entrega,
        cidade, uf, coleta_fabrica, transportadora_id, transportadora_nome,
        quantidade_itens, total, observacao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        link.id, link.favorecido, link.cliente_nome, modalidade, carrada.codigo, carrada.data,
        cidade.nome, cidade.uf, Boolean(cidade.coletaFabrica), transportadora?.id || null,
        transportadora?.nome || null, quantidadeItens, total, limparTexto(payload.observacao) || null
      ]
    );
    const pedido = pedidoResult.rows[0];
    for (const item of itens) {
      await client.query(
        `INSERT INTO assistente_pre_pedido_itens
         (pre_pedido_id, produto_id, item_legado, nome, foto, quantidade, preco, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [pedido.id, item.produto_id, item.item_legado, item.nome, item.foto, item.quantidade, item.preco, item.subtotal]
      );
    }
    await client.query('COMMIT');
    return { ...pedido, itens };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listarPrePedidos({ status } = {}) {
  await criarEstrutura();
  const params = [];
  let where = '';
  if (limparTexto(status)) {
    params.push(limparTexto(status));
    where = 'WHERE p.status = $1';
  }
  const result = await pool.query(
    `SELECT p.*, COUNT(i.id)::int AS total_linhas
     FROM assistente_pre_pedidos p
     LEFT JOIN assistente_pre_pedido_itens i ON i.pre_pedido_id = p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.criado_em DESC
     LIMIT 300`,
    params
  );
  return result.rows;
}

async function buscarPrePedido(id, client = pool) {
  await criarEstrutura();
  const pedidoResult = await client.query('SELECT * FROM assistente_pre_pedidos WHERE id = $1', [inteiroPositivo(id, 'id')]);
  const pedido = pedidoResult.rows[0];
  if (!pedido) throw new Error('Pré-pedido não encontrado.');
  const itensResult = await client.query('SELECT * FROM assistente_pre_pedido_itens WHERE pre_pedido_id = $1 ORDER BY id', [pedido.id]);
  return { ...pedido, itens: itensResult.rows };
}

async function confirmarPrePedido(id) {
  await criarEstrutura();
  const client = await pool.connect();
  let pedido;
  try {
    await client.query('BEGIN');
    const lock = await client.query('SELECT * FROM assistente_pre_pedidos WHERE id = $1 FOR UPDATE', [inteiroPositivo(id, 'id')]);
    pedido = lock.rows[0];
    if (!pedido) throw new Error('Pré-pedido não encontrado.');
    if (pedido.status === 'confirmado') {
      await client.query('COMMIT');
      return { jaConfirmado: true, pedido: await buscarPrePedido(id) };
    }
    if (pedido.status === 'confirmando') throw new Error('Este pré-pedido já está sendo confirmado.');
    await client.query("UPDATE assistente_pre_pedidos SET status='confirmando', atualizado_em=NOW(), erro_confirmacao=NULL WHERE id=$1", [pedido.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
  client.release();

  try {
    const completo = await buscarPrePedido(id);
    const observacoes = [
      `Assistente de pedidos #${completo.id}`,
      `Entrega: ${completo.cidade} - ${completo.uf}`,
      completo.coleta_fabrica ? 'Coleta na fábrica' : `Transportadora: ${completo.transportadora_nome}`,
      limparTexto(completo.observacao)
    ].filter(Boolean).join(' | ');

    const resultado = await pedidosInsercaoV2Service.inserirPedido({
      data: new Date().toISOString().slice(0, 10),
      favorecido: Number(completo.favorecido),
      obs: observacoes,
      volumes: Number(completo.quantidade_itens),
      total: Number(completo.total),
      carrada_codigo: Number(completo.carrada_codigo),
      itens: completo.itens.map((item) => ({
        produto_id: Number(item.produto_id),
        quantidade: Number(item.quantidade),
        preco: Number(item.preco)
      }))
    });

    const numeroPedido = resultado?.pedido?.numero || resultado?.numero || null;
    await pool.query(
      `UPDATE assistente_pre_pedidos
       SET status='confirmado', pedido_legado_numero=$2, confirmado_em=NOW(), atualizado_em=NOW(), erro_confirmacao=NULL
       WHERE id=$1`,
      [completo.id, numeroPedido]
    );
    return { jaConfirmado: false, resultado, pedido: await buscarPrePedido(id) };
  } catch (error) {
    await pool.query(
      `UPDATE assistente_pre_pedidos
       SET status='erro_confirmacao', erro_confirmacao=$2, atualizado_em=NOW()
       WHERE id=$1`,
      [pedido.id, error.message]
    );
    throw error;
  }
}

module.exports = {
  CAPACIDADE_DIARIA,
  CIDADES,
  criarEstrutura,
  gerarLink,
  obterContextoPublico,
  listarProdutos,
  listarDatasDisponiveis,
  listarTransportadoras,
  criarPrePedido,
  listarPrePedidos,
  buscarPrePedido,
  confirmarPrePedido
};
