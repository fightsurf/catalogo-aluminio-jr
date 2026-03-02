const pool = require('../../../db/connection');

const NIVEIS_VALIDOS = ['HUMANO', 'IA'];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

async function listarContatos() {
  const result = await pool.query(
    `SELECT id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em
     FROM bot_contatos
     ORDER BY atualizado_em DESC`
  );
  return result.rows;
}

async function atualizarContato(id, campos) {
  const sets = [];
  const params = [];

  if (campos.nome !== undefined) {
    params.push(campos.nome);
    sets.push(`nome = $${params.length}`);
  }

  if (campos.nivel_atendimento !== undefined) {
    if (!NIVEIS_VALIDOS.includes(campos.nivel_atendimento)) {
    throw new ValidationError('nivel_atendimento inválido. Use HUMANO ou IA.');
    }
    params.push(campos.nivel_atendimento);
    sets.push(`nivel_atendimento = $${params.length}`);
  }

  if (sets.length === 0) {
    throw new ValidationError('Nenhum campo válido para atualizar.');
  }

  sets.push(`atualizado_em = NOW()`);
  params.push(id);

  const result = await pool.query(
    `UPDATE bot_contatos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, telefone, nome, nivel_atendimento, ultima_mensagem, criado_em, atualizado_em`,
    params
  );

  return result.rows[0] || null;
}

module.exports = { listarContatos, atualizarContato, ValidationError };
