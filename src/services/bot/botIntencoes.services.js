const pool = require('../../../db/connection');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

class DuplicateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuplicateError';
  }
}

async function listarTodas() {
  const result = await pool.query(
    `SELECT id, nome, descricao, resposta_texto, acao, exige_humano, ativa, criado_em, atualizado_em
     FROM bot_intencoes
     ORDER BY criado_em DESC`
  );
  return result.rows;
}

async function criar(dados) {
  const { nome, descricao, resposta_texto, acao, exige_humano } = dados;

  if (!nome || /\s/.test(nome)) {
    throw new ValidationError('nome é obrigatório e não pode conter espaços.');
  }
  if (!descricao) {
    throw new ValidationError('descricao é obrigatória.');
  }

  const nomeMaiusculo = nome.toUpperCase();

  try {
    const result = await pool.query(
      `INSERT INTO bot_intencoes (nome, descricao, resposta_texto, acao, exige_humano)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, descricao, resposta_texto, acao, exige_humano, ativa, criado_em, atualizado_em`,
      [nomeMaiusculo, descricao, resposta_texto || null, acao || null, exige_humano || false]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') throw new DuplicateError('Intenção com esse nome já existe.');
    throw err;
  }
}

async function atualizar(id, dados) {
  const { descricao, resposta_texto, acao, exige_humano, ativa } = dados;

  const sets = [];
  const params = [];

  if (descricao !== undefined) {
    if (!descricao) throw new ValidationError('descricao é obrigatória.');
    params.push(descricao);
    sets.push(`descricao = $${params.length}`);
  }
  if (resposta_texto !== undefined) {
    params.push(resposta_texto);
    sets.push(`resposta_texto = $${params.length}`);
  }
  if (acao !== undefined) {
    params.push(acao);
    sets.push(`acao = $${params.length}`);
  }
  if (exige_humano !== undefined) {
    params.push(exige_humano);
    sets.push(`exige_humano = $${params.length}`);
  }
  if (ativa !== undefined) {
    params.push(ativa);
    sets.push(`ativa = $${params.length}`);
  }

  if (sets.length === 0) {
    throw new ValidationError('Nenhum campo válido para atualizar.');
  }

  sets.push(`atualizado_em = NOW()`);
  params.push(id);

  const result = await pool.query(
    `UPDATE bot_intencoes SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, nome, descricao, resposta_texto, acao, exige_humano, ativa, criado_em, atualizado_em`,
    params
  );

  return result.rows[0] || null;
}

async function listarAtivas() {
  const result = await pool.query(
    `SELECT nome, descricao FROM bot_intencoes WHERE ativa = true`
  );
  return result.rows;
}

async function deletar(id) {
  const result = await pool.query(
    `DELETE FROM bot_intencoes WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { listarTodas, criar, atualizar, listarAtivas, deletar, ValidationError, DuplicateError };
