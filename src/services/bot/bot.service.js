'use strict';
const pool = require('../../../db/connection');
const temporarias = require('../whatsapp/whatsapp-conversas-temporarias.service');
const botFluxo = require('./botFluxo.services');

// Endpoint legado: mantido, mas sem persistir mensagens.
async function receberMensagem({ telefone, mensagem, tipo }) {
  const tel = String(telefone || '').trim();
  if (!tel) throw new Error('Telefone obrigatório.');
  let primeiroContato = false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const insercao = await client.query(`INSERT INTO bot_contatos
      (telefone, criado_em, atualizado_em, fluxo_primeiro_contato_enviado)
      VALUES ($1, NOW(), NOW(), true)
      ON CONFLICT (telefone) DO NOTHING RETURNING id`, [tel]);
    primeiroContato = insercao.rowCount > 0 && /^\d{10,15}$/.test(tel);
    await client.query('UPDATE bot_contatos SET atualizado_em=NOW() WHERE telefone=$1', [tel]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  temporarias.publicar({ telefone: tel, mensagem, tipo, direcao: 'ENTRADA' });
  if (primeiroContato) {
    botFluxo.executarPrimeiroContatoAutomatico(tel).catch(err =>
      console.error('[Bot] Falha na saudacao de contato novo:', err.message));
  }
  return { status: 'mensagem_ao_vivo', primeiro_contato: primeiroContato };
}
module.exports = { receberMensagem };
