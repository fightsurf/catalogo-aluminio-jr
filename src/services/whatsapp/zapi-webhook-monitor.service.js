'use strict';

// Histórico de callbacks e consulta do monitor. Não guarda o payload completo nem credenciais.
const pool = require('../../../db/connection');
let estruturaPromise;

function criarEstrutura() {
  if (!estruturaPromise) {
    estruturaPromise = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_webhook_eventos (
        id BIGSERIAL PRIMARY KEY,
        recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        telefone TEXT,
        mensagem TEXT,
        tipo TEXT,
        zapi_instancia TEXT,
        zapi_message_id TEXT,
        estado VARCHAR(20) NOT NULL,
        motivo TEXT,
        direcao VARCHAR(12)
      )`);
      await pool.query('ALTER TABLE whatsapp_webhook_eventos ADD COLUMN IF NOT EXISTS direcao VARCHAR(12)');
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_eventos_data
        ON whatsapp_webhook_eventos(recebido_em DESC, id DESC)`);
    })().catch(err => { estruturaPromise = null; throw err; });
  }
  return estruturaPromise;
}

function cortar(valor, limite) {
  return typeof valor === 'string' ? valor.slice(0, limite) : '';
}

async function registrarEvento({ payload = {}, dados = {}, estado, motivo = '' }) {
  await criarEstrutura();
  const telefone = cortar(dados.telefone || payload?.phone, 120);
  const tipo = cortar(dados.tipo || (payload?.text ? 'texto' : payload?.audio ? 'audio' : payload?.image ? 'imagem' : ''), 32);
  // Somente mensagens recebidas e interpretadas têm o texto no histórico de auditoria.
  const mensagem = estado === 'ignorada' || estado === 'erro'
    ? '' : cortar(dados.mensagem, 5000);
  await pool.query(`INSERT INTO whatsapp_webhook_eventos
    (telefone, mensagem, tipo, zapi_instancia, zapi_message_id, estado, motivo, direcao)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      telefone, mensagem, tipo,
      cortar(dados.instancia || payload?.instanceId, 120),
      cortar(dados.messageId || payload?.messageId, 250),
      estado, cortar(motivo, 160),
      dados.direcao || (payload?.fromMe === true ? 'SAIDA' : payload?.fromMe === false ? 'ENTRADA' : null)
    ]);
}

// Unifica registros anteriores do bot com o histórico do novo webhook.
async function listarRecebimentos({ limite = 100 } = {}) {
  const total = Math.max(1, Math.min(200, Number.parseInt(limite, 10) || 100));
  await criarEstrutura();
  const sql = `SELECT * FROM (
      SELECT 'zapi-' || e.id::text AS chave, e.recebido_em, e.telefone,
        e.mensagem, e.tipo, e.zapi_message_id AS message_id,
        e.estado, e.motivo, e.direcao, 'Z-API direta' AS origem
      FROM whatsapp_webhook_eventos e
      UNION ALL
      SELECT 'bot-' || m.id::text AS chave, m.criada_em AS recebido_em,
        m.telefone, m.mensagem, m.tipo, NULL::text AS message_id,
        'registrada' AS estado, NULL::text AS motivo, m.direcao, 'Integração anterior' AS origem
      FROM bot_mensagens m
      WHERE m.direcao = 'ENTRADA' AND m.zapi_message_id IS NULL
    ) eventos
    ORDER BY recebido_em DESC, chave DESC
    LIMIT $1`;
  const result = await pool.query(sql, [total]);
  return result.rows;
}

module.exports = { criarEstrutura, registrarEvento, listarRecebimentos };
