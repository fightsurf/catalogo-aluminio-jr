const pool = require('../../../db/connection');
const botEvents = require('./botEvents');
const botFluxoService = require('./botFluxo.services');

async function receberMensagem({ telefone, mensagem, tipo }) {
  const client = await pool.connect();
  let contatoCriadoAgora = false;

  try {
    await client.query('BEGIN');

    // Verificar se contato existe; criar se não existir
    const contatoExiste = await client.query(
      'SELECT id FROM bot_contatos WHERE telefone = $1',
      [telefone]
    );

    if (contatoExiste.rows.length === 0) {
      await client.query(
        `INSERT INTO bot_contatos (telefone, criado_em, atualizado_em)
         VALUES ($1, NOW(), NOW())`,
        [telefone]
      );

      contatoCriadoAgora = true;
    }

    // Inserir mensagem
    await client.query(
      `INSERT INTO bot_mensagens (telefone, mensagem, tipo, direcao, processada_ia, criada_em)
       VALUES ($1, $2, $3, 'ENTRADA', false, NOW())`,
      [telefone, mensagem, tipo]
    );

    // Atualizar ultima_mensagem e atualizado_em
    await client.query(
      `UPDATE bot_contatos
       SET ultima_mensagem = $1, atualizado_em = NOW()
       WHERE telefone = $2`,
      [mensagem, telefone]
    );

    await client.query('COMMIT');

    if (contatoCriadoAgora) {
      setImmediate(() => {
        botFluxoService
          .executarFluxo(telefone, 'PRIMEIRO_CONTATO')
          .then(resultado => {
            console.log(`[botPrimeiroContato] fluxo disparado | telefone=${telefone} status=${resultado.status}`);
          })
          .catch(err => {
            console.error(`[botPrimeiroContato] erro ao disparar fluxo | telefone=${telefone}: ${err.message}`);
          });
      });
    }

    botEvents.emit('nova_mensagem', { telefone, mensagem, tipo });

    return {
      status: 'mensagem_registrada',
      primeiro_contato: contatoCriadoAgora
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { receberMensagem };
