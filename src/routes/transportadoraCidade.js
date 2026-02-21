const express = require('express');
const router = express.Router();
const pool = require('../../db/connection');

// =====================================================
// POST /transportadoras/:id/cidades
// Vincular cidade à transportadora usando codigo_ibge
// =====================================================
router.post('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;
  const { codigo_ibge } = req.body;

  if (!codigo_ibge) {
    return res.status(400).json({ error: 'codigo_ibge é obrigatório' });
  }

  try {
    // 1️⃣ Buscar cidade pelo codigo_ibge
    const cidadeResult = await pool.query(
      'SELECT id FROM cidades WHERE codigo_ibge = $1',
      [codigo_ibge]
    );

    if (cidadeResult.rowCount === 0) {
      return res.status(404).json({ error: 'Cidade não encontrada' });
    }

    const cidade_id = cidadeResult.rows[0].id;

    // 2️⃣ Inserir relacionamento usando cidade_id
    const insertResult = await pool.query(
      `
      INSERT INTO transportadora_cidade (transportadora_id, cidade_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
      RETURNING *;
      `,
      [id, cidade_id]
    );

    if (insertResult.rowCount === 0) {
      return res.status(409).json({ message: 'Relacionamento já existe' });
    }

    res.status(201).json(insertResult.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao vincular cidade' });
  }
});

// =====================================================
// GET /transportadoras/:id/cidades
// Listar cidades vinculadas à transportadora
// =====================================================
router.get('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT c.codigo_ibge, c.nome, c.estado
      FROM transportadora_cidade tc
      JOIN cidades c ON tc.cidade_id = c.id
      WHERE tc.transportadora_id = $1;
      `,
      [id]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar cidades' });
  }
});

// =====================================================
// GET /cidades/:codigo_ibge/transportadoras
// Listar transportadoras que atendem a cidade
// =====================================================
router.get('/cidades/:codigo_ibge/transportadoras', async (req, res) => {
  const { codigo_ibge } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT t.id, t.nome, t.telefone
      FROM transportadora_cidade tc
      JOIN cidades c ON tc.cidade_id = c.id
      JOIN transportadoras t ON tc.transportadora_id = t.id
      WHERE c.codigo_ibge = $1;
      `,
      [codigo_ibge]
    );

    res.json(result.rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar transportadoras' });
  }
});

module.exports = router;
