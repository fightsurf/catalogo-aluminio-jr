const express = require('express');
const router = express.Router();
const pool = require('../../db/connection');

// ======================================
// POST - vincular cidade à transportadora
// ======================================
router.post('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;
  const { codigo_ibge } = req.body;

  if (!codigo_ibge) {
    return res.status(400).json({ error: 'codigo_ibge é obrigatório' });
  }

  try {
    // Buscar cidade pelo codigo_ibge
    const cidadeResult = await pool.query(
      'SELECT id FROM cidades WHERE codigo_ibge = $1',
      [codigo_ibge]
    );

    if (cidadeResult.rowCount === 0) {
      return res.status(404).json({ error: 'Cidade não encontrada' });
    }

    const cidade_id = cidadeResult.rows[0].id;

    // Inserir relacionamento
    const insertResult = await pool.query(
      `
      INSERT INTO transportadora_cidade (transportadora_id, cidade_id)
      VALUES ($1, $2)
      ON CONFLICT (transportadora_id, cidade_id) DO NOTHING
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

module.exports = router;
