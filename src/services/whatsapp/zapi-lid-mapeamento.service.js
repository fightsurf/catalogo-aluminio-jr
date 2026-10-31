'use strict';

// Vincula um identificador privado do WhatsApp ao telefone somente quando a
// Z-API fornece os dois valores no mesmo evento. Nunca deduz telefone do LID.
const pool = require('../../../db/connection');
let estruturaPromise;

function ehLid(valor) {
  return /^\d+@lid$/i.test(String(valor || '').trim());
}

function ehTelefone(valor) {
  return /^\d{10,15}$/.test(String(valor || '').trim());
}

function identificarLid(payload) {
  if (ehLid(payload?.chatLid)) return String(payload.chatLid).trim();
  // senderLid pertence ao remetente da mensagem; em uma mensagem enviada
  // pela fábrica não podemos presumir que ele identifica o destinatário.
  if (payload?.fromMe === false && ehLid(payload?.senderLid)) {
    return String(payload.senderLid).trim();
  }
  return '';
}

async function prepararEstrutura() {
  if (!estruturaPromise) {
    estruturaPromise = pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_lid_telefones (
      instancia TEXT NOT NULL,
      lid TEXT NOT NULL,
      telefone TEXT NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (instancia, lid)
    )`).catch((error) => {
      estruturaPromise = null;
      throw error;
    });
  }
  return estruturaPromise;
}

async function resolverTelefone({ instancia, telefone, lid }) {
  const original = String(telefone || '').trim();
  const instanciaSegura = String(instancia || '').trim();
  if (!instanciaSegura || (!ehLid(original) && !ehTelefone(original))) return original;

  await prepararEstrutura();
  // Só aprender uma associação quando o mesmo webhook traz telefone E LID.
  if (ehTelefone(original) && ehLid(lid)) {
    await pool.query(`INSERT INTO whatsapp_lid_telefones
      (instancia, lid, telefone, atualizado_em)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (instancia, lid)
      DO UPDATE SET telefone = EXCLUDED.telefone, atualizado_em = NOW()`,
    [instanciaSegura, lid, original]);
    return original;
  }

  if (ehLid(original)) {
    const resultado = await pool.query(
      'SELECT telefone FROM whatsapp_lid_telefones WHERE instancia = $1 AND lid = $2',
      [instanciaSegura, original]
    );
    return resultado.rows[0]?.telefone || original;
  }
  return original;
}

module.exports = { ehLid, ehTelefone, identificarLid, prepararEstrutura, resolverTelefone };
