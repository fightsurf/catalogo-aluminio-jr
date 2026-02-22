const express = require('express');
const router = express.Router();
const pool = require('../../db/connection');

// ======================================
// GET - listar todas transportadoras
// ======================================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transportadoras ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar transportadoras' });
  }
});

// ======================================
// POST - criar transportadora
// ======================================
router.post('/', async (req, res) => {
  const { nome, contato_principal, telefone, observacoes } = req.body;

  if (!nome) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO transportadoras
      (nome, contato_principal, telefone, observacoes)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
      `,
      [nome, contato_principal || null, telefone || null, observacoes || null]
    );

    res.status(201).json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar transportadora' });
  }
});

module.exports = router;
