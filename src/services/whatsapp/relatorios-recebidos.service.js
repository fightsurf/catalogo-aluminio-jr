const pool = require('../../../db/connection');
const clientesLegadoService = require('../legado/clientes/clientes.service');

let estruturaPronta = null;
const cacheClientes = new Map();
const CLIENTE_CACHE_MS = 30000;

async function criarEstrutura() {
  if (estruturaPronta) return estruturaPronta;

  estruturaPronta = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_relatorios (
        id BIGSERIAL PRIMARY KEY,
        telefone VARCHAR(120) NOT NULL,
        relatorio TEXT NOT NULL,
        recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_relatorios_telefone
      ON whatsapp_relatorios (telefone)
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_whatsapp_relatorios_recebido_em
      ON whatsapp_relatorios (recebido_em DESC)
    `);
  })().catch((error) => {
    estruturaPronta = null;
    throw error;
  });

  return estruturaPronta;
}

function limparTexto(valor) {
  return String(valor ?? '').trim();
}

function normalizarTelefone(valor) {
  let telefone = limparTexto(valor).replace(/\D+/g, '');
  if (telefone.startsWith('55') && (telefone.length === 12 || telefone.length === 13)) {
    telefone = telefone.slice(2);
  }
  return telefone;
}

function normalizarParaComparacao(valor) {
  return limparTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function ehRelatorioAluminioJR(mensagem) {
  const original = limparTexto(mensagem);
  if (!original) return false;

  const normalizada = normalizarParaComparacao(original);

  return normalizada.includes('RELATORIO ALUMINIO JR') &&
    /\|\s*QTD\s*:/i.test(original);
}

async function buscarClientePorTelefone(telefone) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  if (!telefoneNormalizado) return null;

  const agora = Date.now();
  const cache = cacheClientes.get(telefoneNormalizado);
  if (cache && cache.expiraEm > agora) {
    return cache.cliente;
  }

  try {
    const clientes = await clientesLegadoService.listarClientes({
      telefone: telefoneNormalizado,
      status: 'todos',
      limite: 5
    });

    const cliente = Array.isArray(clientes) && clientes.length ? clientes[0] : null;
    cacheClientes.set(telefoneNormalizado, { cliente, expiraEm: agora + CLIENTE_CACHE_MS });
    return cliente;
  } catch (error) {
    console.error(`Erro ao identificar cliente pelo telefone ${telefoneNormalizado}:`, error.message);
    return null;
  }
}

async function enriquecerComClientes(registros) {
  const cache = new Map();

  for (const registro of registros) {
    const chave = normalizarTelefone(registro.telefone);
    if (!chave) {
      registro.cliente = null;
      continue;
    }

    if (!cache.has(chave)) {
      cache.set(chave, await buscarClientePorTelefone(chave));
    }

    registro.cliente = cache.get(chave) || null;
  }

  return registros;
}

async function capturar({ telefone, mensagem, relatorio, fromMe, tipo }) {
  const texto = limparTexto(mensagem || relatorio);
  const telefoneLimpo = limparTexto(telefone);

  if (fromMe === true || String(fromMe).toLowerCase() === 'true') {
    return { salvo: false, motivo: 'mensagem_enviada_por_mim' };
  }

  if (tipo && String(tipo).toLowerCase() !== 'texto') {
    return { salvo: false, motivo: 'nao_texto' };
  }

  if (!telefoneLimpo || !texto) {
    return { salvo: false, motivo: 'dados_incompletos' };
  }

  if (!ehRelatorioAluminioJR(texto)) {
    return { salvo: false, motivo: 'nao_e_relatorio' };
  }

  await criarEstrutura();

  const result = await pool.query(
    `
      INSERT INTO whatsapp_relatorios (telefone, relatorio)
      VALUES ($1, $2)
      RETURNING id, telefone, relatorio, recebido_em
    `,
    [telefoneLimpo, texto]
  );

  return { salvo: true, registro: result.rows[0] };
}

async function listar({ telefone } = {}) {
  await criarEstrutura();

  const telefoneBusca = limparTexto(telefone);
  const params = [];
  let where = '';

  if (telefoneBusca) {
    params.push(`%${telefoneBusca}%`);
    where = `WHERE telefone ILIKE $${params.length}`;
  }

  const result = await pool.query(
    `
      SELECT id, telefone, relatorio, recebido_em
      FROM whatsapp_relatorios
      ${where}
      ORDER BY recebido_em DESC, id DESC
      LIMIT 500
    `,
    params
  );

  return enriquecerComClientes(result.rows);
}

async function buscarPorId(id) {
  await criarEstrutura();

  const numeroId = Number(id);
  if (!Number.isInteger(numeroId) || numeroId <= 0) {
    throw new Error('Registro inválido.');
  }

  const result = await pool.query(
    `
      SELECT id, telefone, relatorio, recebido_em
      FROM whatsapp_relatorios
      WHERE id = $1
      LIMIT 1
    `,
    [numeroId]
  );

  if (!result.rows[0]) return null;
  const [registro] = await enriquecerComClientes([result.rows[0]]);
  return registro;
}

async function excluir(id) {
  await criarEstrutura();

  const numeroId = Number(id);
  if (!Number.isInteger(numeroId) || numeroId <= 0) {
    throw new Error('Registro inválido.');
  }

  const result = await pool.query(
    `
      DELETE FROM whatsapp_relatorios
      WHERE id = $1
      RETURNING id
    `,
    [numeroId]
  );

  return result.rows[0] || null;
}

module.exports = {
  criarEstrutura,
  ehRelatorioAluminioJR,
  capturar,
  listar,
  buscarPorId,
  excluir
};
