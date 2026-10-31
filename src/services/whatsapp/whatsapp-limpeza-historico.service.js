'use strict';
const pool = require('../../../db/connection');

// Executa UMA vez no deploy. Remove somente mensagens/monitor e resumos,
// preservando o cadastro bot_contatos e os vinculos de identidade WhatsApp.
async function executarUmaVez() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS whatsapp_migracoes_executadas (
      chave TEXT PRIMARY KEY, executada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const chave = 'whatsapp_sem_historico_20261031_v1';
    const claim = await client.query(
      'INSERT INTO whatsapp_migracoes_executadas (chave) VALUES ($1) ON CONFLICT DO NOTHING RETURNING chave', [chave]
    );
    if (claim.rowCount) {
      await client.query('DELETE FROM bot_mensagens');
      await client.query('DELETE FROM whatsapp_webhook_eventos');
      await client.query('UPDATE bot_contatos SET ultima_mensagem = NULL WHERE ultima_mensagem IS NOT NULL');
    }
    await client.query('COMMIT');
    return { executada: !!claim.rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
module.exports = { executarUmaVez };
