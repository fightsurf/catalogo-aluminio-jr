'use strict';
const pool = require('../../../db/connection');
const temporarias = require('../whatsapp/whatsapp-conversas-temporarias.service');
const filaSaudacao = require('./primeiro-contato-fila.service');

// Endpoint legado: mantido, mas sem persistir mensagens.
async function receberMensagem({ telefone, mensagem, tipo }) {
  const tel = String(telefone || '').trim();
  if (!tel) throw new Error('Telefone obrigatório.');
  let primeiroContato = false;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    primeiroContato = await filaSaudacao.registrarContato(tel, client);
    await client.query('UPDATE bot_contatos SET atualizado_em=NOW() WHERE telefone=$1', [tel]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  temporarias.publicar({ telefone: tel, mensagem, tipo, direcao: 'ENTRADA' });
  primeiroContato = primeiroContato && await filaSaudacao.processarTelefone(tel).catch(err => {
    console.error('[Bot] Saudacao pendente:', err.message);
    return false;
  });
  return { status: 'mensagem_ao_vivo', primeiro_contato: primeiroContato };
}
module.exports = { receberMensagem };
