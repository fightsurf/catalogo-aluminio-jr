const pool = require('../../../db/connection');

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

async function listarConversas({ page, limit, data_inicio, data_fim, nivel_atendimento, telefone }) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM bot_contatos ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  params.push(limitNum);
  params.push(offset);

  const dataResult = await pool.query(
    `SELECT id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em, atualizado_em
     FROM bot_contatos
     ${where}
     ORDER BY atualizado_em DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    dados: dataResult.rows,
    total,
    pagina: pageNum,
    total_paginas: Math.ceil(total / limitNum)
  };
}

async function listarMensagens({ telefone, page, limit }) {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  const countResult = await pool.query(
    'SELECT COUNT(*) FROM bot_mensagens WHERE telefone = $1',
    [telefone]
  );
  const total = parseInt(countResult.rows[0].count);

  const dataResult = await pool.query(
    `SELECT id, telefone, mensagem, tipo, direcao, processada_ia, intencao_classificada, criada_em
     FROM bot_mensagens
     WHERE telefone = $1
     ORDER BY criada_em DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [telefone, limitNum, offset]
  );

  return {
    dados: dataResult.rows.reverse(),
    total
  };
}

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
