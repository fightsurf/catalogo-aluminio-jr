const pool = require('../../../db/connection');

const processamentoEmAndamento = new Map();

async function getAutonomiaAtiva() {
  const result = await pool.query(
    `SELECT valor
     FROM bot_config
     WHERE chave = $1
     LIMIT 1`,
    ['autonomia_ativa']
  );

  if (!result.rows.length) {
    return false;
  }

  return String(result.rows[0].valor).toLowerCase() === 'true';
}

async function setAutonomiaAtiva(ativa) {
  const valor = ativa ? 'true' : 'false';

  await pool.query(
    `INSERT INTO bot_config (chave, valor, atualizado_em)
     VALUES ($1, $2, NOW())
     ON CONFLICT (chave)
     DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW()`,
    ['autonomia_ativa', valor]
  );

  return { ativa };
}

async function buscarUltimaMensagemPendenteEntrada(telefone) {
  const result = await pool.query(
    `SELECT id, telefone, mensagem, direcao, processada_ia, criada_em
     FROM bot_mensagens
     WHERE telefone = $1
     ORDER BY criada_em DESC, id DESC
     LIMIT 1`,
    [telefone]
  );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processarTelefoneAutonomamente({ telefone, porta }) {
  const tel = String(telefone || '').trim();
  if (!tel) return;

  if (processamentoEmAndamento.has(tel)) {
    return;
  }

  processamentoEmAndamento.set(tel, true);

  try {
    const autonomiaAtiva = await getAutonomiaAtiva();
    if (!autonomiaAtiva) {
      return;
    }

    await delay(1500);

    const ultima = await buscarUltimaMensagemPendenteEntrada(tel);

    if (!ultima) {
      return;
    }

    if (ultima.direcao !== 'ENTRADA') {
      return;
    }

    if (ultima.processada_ia === true) {
      return;
    }

    const baseUrl = `http://127.0.0.1:${porta}`;

    const classificarRes = await fetch(
      `${baseUrl}/bot/classificar-intencao/${encodeURIComponent(tel)}`,
      { method: 'POST' }
    );

    const classificarData = await classificarRes.json().catch(() => ({}));

    if (!classificarRes.ok) {
      console.error('[botAutonomia] erro ao classificar:', classificarData.message || classificarRes.status);
      return;
    }

    const intencao = String(classificarData.intencao || '').trim().toUpperCase();

    if (!intencao || intencao === 'DESCONHECIDO') {
      console.log(`[botAutonomia] intenção ignorada | telefone=${tel} intencao=${intencao || 'vazia'}`);
      return;
    }

    const fluxoRes = await fetch(`${baseUrl}/bot/fluxo/executar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telefone: tel,
        intencao
      })
    });

    const fluxoData = await fluxoRes.json().catch(() => ({}));

    if (!fluxoRes.ok) {
      console.error('[botAutonomia] erro ao executar fluxo:', fluxoData.message || fluxoRes.status);
      return;
    }

    console.log(`[botAutonomia] fluxo disparado | telefone=${tel} intencao=${intencao}`);
  } catch (err) {
    console.error('[botAutonomia] falha no processamento autônomo:', err.message);
  } finally {
    processamentoEmAndamento.delete(tel);
  }
}

module.exports = {
  getAutonomiaAtiva,
  setAutonomiaAtiva,
  processarTelefoneAutonomamente
};
