'use strict';
// Evita saudar como novo cliente quem ja recebeu uma abordagem pela Mala Direta.
// A verificacao cobre tambem campanhas anteriores a esta integracao.
const pool = require('../../../db/connection');

function telefoneCanonico(telefone) {
  const valor = String(telefone || '').trim();
  return /^\d{10,15}$/.test(valor) ? valor : null;
}

async function abordadoPelaMalaDireta(telefone, executor = pool) {
  const tel = telefoneCanonico(telefone);
  // Um identificador nao canonico nunca autoriza saudacao automatica.
  if (!tel) return true;
  const consulta = await executor.query(`
    SELECT EXISTS (
      SELECT 1 FROM mala_direta_destinatarios
      WHERE telefone = $1
        AND (
          iniciado_envio_em IS NOT NULL
          OR etapa_enviada_index >= 0
          OR imagem_aceita_em IS NOT NULL
          OR enviado_em IS NOT NULL
          OR status IN ('enviando', 'enviado', 'incerto')
        )
    ) AS abordado
  `, [tel]);
  return consulta.rows[0]?.abordado === true;
}

// Chamada na transacao de claim do destinatario, antes da Z-API.
// Se falhar, a transacao e desfeita e nenhuma mensagem nova e disparada.
async function registrarEnvioIniciado(telefone, executor = pool) {
  const tel = telefoneCanonico(telefone);
  if (!tel) throw new Error('Telefone invalido para registro de abordagem.');
  await executor.query(`
    INSERT INTO bot_contatos (telefone, criado_em, atualizado_em, fluxo_primeiro_contato_enviado)
    VALUES ($1, NOW(), NOW(), true)
    ON CONFLICT (telefone) DO NOTHING
  `, [tel]);
}

module.exports = { abordadoPelaMalaDireta, registrarEnvioIniciado };
