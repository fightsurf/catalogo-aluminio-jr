const pool = require('../../../db/connection');

let estruturaPronta = null;

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

  return result.rows;
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
  excluir
};
