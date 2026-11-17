'use strict';
// Evita saudar como novo cliente quem ja recebeu uma abordagem pela Mala Direta.
// A verificacao cobre tambem campanhas anteriores a esta integracao.
const pool = require('../../../db/connection');

function telefoneCanonico(telefone) {
  const valor = String(telefone || '').trim();
  return /^\d{10,15}$/.test(valor) ? valor : null;
}

// A Z-API pode devolver o numero sem o nono digito, mesmo quando
// a campanha enviou para o numero com 9. Nunca comparar apenas o sufixo:
// exigir o mesmo DDI 55, DDD e os oito digitos finais.
function telefonesEquivalentes(telefone) {
  const tel = telefoneCanonico(telefone);
  if (!tel) return [];
  if (/^55\d{2}\d{8}$/.test(tel)) {
    return [tel, tel.slice(0, 4) + '9' + tel.slice(4)];
  }
  if (/^55\d{2}9\d{8}$/.test(tel)) {
    return [tel, tel.slice(0, 4) + tel.slice(5)];
  }
  return [tel];
}

async function abordadoPelaMalaDireta(telefone, executor = pool) {
  const telefones = telefonesEquivalentes(telefone);
  // Um identificador nao canonico nunca autoriza saudacao automatica.
  if (!telefones.length) return true;
  const consulta = await executor.query(`
    SELECT EXISTS (
      SELECT 1 FROM mala_direta_destinatarios
      WHERE telefone = ANY($1::varchar[])
        AND (
          iniciado_envio_em IS NOT NULL
          OR etapa_enviada_index >= 0
          OR imagem_aceita_em IS NOT NULL
          OR enviado_em IS NOT NULL
          OR status IN ('enviando', 'enviado', 'incerto')
        )
    ) AS abordado
  `, [telefones]);
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
