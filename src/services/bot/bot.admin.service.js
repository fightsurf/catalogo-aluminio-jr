const pool = require('../../../db/connection');
const lidVinculos = require('../whatsapp/zapi-lid-vinculos.service');

function normalizarTelefone(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function validarTelefoneManual(telefone) {
  if (!telefone) {
    throw new Error('Telefone é obrigatório.');
  }

  if (telefone.length < 10) {
    throw new Error('Telefone inválido. Informe o número com DDI e DDD.');
  }
}

async function abrirOuCriarConversa({ telefone }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  validarTelefoneManual(telefoneNormalizado);

  const result = await pool.query(
    `WITH novo AS (
       INSERT INTO bot_contatos (
         telefone,
         ultima_mensagem,
         criado_em,
         atualizado_em,
         fluxo_primeiro_contato_enviado
       )
       VALUES ($1, 'Conversa iniciada manualmente pelo admin', NOW(), NOW(), true)
       ON CONFLICT (telefone) DO NOTHING
       RETURNING id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em, atualizado_em
     )
     SELECT id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em, atualizado_em
     FROM novo
     UNION ALL
     SELECT id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em, atualizado_em
     FROM bot_contatos
     WHERE telefone = $1
       AND NOT EXISTS (SELECT 1 FROM novo)
     LIMIT 1`,
    [telefoneNormalizado]
  );

  return result.rows[0];
}

// Reune somente LIDs que possuem um unico telefone comprovado.
const CTE_CONVERSAS = `WITH lid_unico AS (
  SELECT lid, MIN(telefone) AS telefone FROM whatsapp_lid_vinculos
  GROUP BY lid HAVING COUNT(DISTINCT telefone) = 1
), origens AS (
  SELECT c.*, COALESCE(v.telefone, c.telefone) AS telefone_canonico
  FROM bot_contatos c LEFT JOIN lid_unico v ON v.lid = c.telefone
), conversas AS (
  SELECT telefone_canonico AS telefone, MAX(id) AS id,
    MAX(NULLIF(nome, '')) AS nome,
    (ARRAY_AGG(nivel_atendimento ORDER BY atualizado_em DESC))[1] AS nivel_atendimento,
    (ARRAY_AGG(ultima_mensagem ORDER BY atualizado_em DESC))[1] AS ultima_mensagem,
    MIN(criado_em) AS criado_em, MAX(atualizado_em) AS atualizado_em
  FROM origens GROUP BY telefone_canonico
)`;

async function listarConversas({ page, limit, data_inicio, data_fim, nivel_atendimento, telefone }) {
  await lidVinculos.prepararEstrutura();
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;
  const conditions = [];
  const params = [];
  if (data_inicio) {
    params.push(data_inicio);
    conditions.push(`atualizado_em >= $${params.length}`);
  }
  if (data_fim) {
    params.push(data_fim);
    conditions.push(`atualizado_em <= $${params.length}`);
  }
  if (nivel_atendimento) {
    params.push(nivel_atendimento);
    conditions.push(`nivel_atendimento = $${params.length}`);
  }
  if (telefone) {
    params.push(`%${telefone}%`);
    conditions.push(`telefone ILIKE $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await pool.query(
    `${CTE_CONVERSAS} SELECT COUNT(*) FROM conversas ${where}`, params
  );
  const total = parseInt(countResult.rows[0].count, 10);
  const result = await pool.query(
    `${CTE_CONVERSAS}
     SELECT id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em, atualizado_em
     FROM conversas ${where} ORDER BY atualizado_em DESC, telefone ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limitNum, offset]
  );
  return { dados: result.rows, total, pagina: pageNum, total_paginas: Math.ceil(total / limitNum) };
}

// Mensagens existem somente na memoria das telas conectadas por WebSocket.
async function listarMensagens() { return { dados: [],total:0 }; }

async function criarIndices() {
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_bot_mensagens_telefone ON bot_mensagens(telefone)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_bot_contatos_atualizado_em ON bot_contatos(atualizado_em)`
  );
  await pool.query(
    `ALTER TABLE bot_mensagens ADD COLUMN IF NOT EXISTS intencao_classificada VARCHAR(100)`
  );
  await pool.query(
    `ALTER TABLE bot_intencoes ADD COLUMN IF NOT EXISTS fluxo_chave TEXT`
  );
}

module.exports = { abrirOuCriarConversa, listarConversas, listarMensagens, criarIndices };
