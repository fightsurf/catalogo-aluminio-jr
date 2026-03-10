const pool = require('../../../db/connection');
const botEvents = require('./botEvents');
const botFluxoService = require('./botFluxo.services');

async function receberMensagem({ telefone, mensagem, tipo }) {
  const client = await pool.connect();
  let deveDispararPrimeiroContato = false;

  try {
    await client.query('BEGIN');

    // Busca contato com lock para evitar corrida em mensagens simultâneas
    let contatoResult = await client.query(
      `SELECT id, fluxo_primeiro_contato_enviado
       FROM bot_contatos
       WHERE telefone = $1
       FOR UPDATE`,
      [telefone]
    );

    if (contatoResult.rows.length === 0) {
      await client.query(
        `INSERT INTO bot_contatos (
          telefone,
          criado_em,
          atualizado_em,
          fluxo_primeiro_contato_enviado
        )
        VALUES ($1, NOW(), NOW(), false)`,
        [telefone]
      );

      contatoResult = await client.query(
        `SELECT id, fluxo_primeiro_contato_enviado
         FROM bot_contatos
         WHERE telefone = $1
         FOR UPDATE`,
        [telefone]
      );
    }

    const contato = contatoResult.rows[0];

    if (contato && contato.fluxo_primeiro_contato_enviado === false) {
      await client.query(
        `UPDATE bot_contatos
         SET fluxo_primeiro_contato_enviado = true
         WHERE id = $1`,
        [contato.id]
      );

      deveDispararPrimeiroContato = true;
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

    if (deveDispararPrimeiroContato) {
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
      primeiro_contato: deveDispararPrimeiroContato
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { receberMensagem };
