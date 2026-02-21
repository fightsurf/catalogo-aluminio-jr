const express = require('express');
const router = express.Router();
const pool = require('../../db/connection');

// POST /transportadoras/:id/cidades
// Insere relacionamento entre transportadora e cidade
router.post('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;
  const { codigo_ibge } = req.body;

  try {
    if (!codigo_ibge) {
      return res.status(400).json({ 
        error: 'codigo_ibge é obrigatório' 
      });
    }

    const result = await pool.query(
      `INSERT INTO transportadora_cidade (transportadora_id, codigo_ibge)
       VALUES ($1, $2)
       ON CONFLICT (transportadora_id, codigo_ibge) DO NOTHING
       RETURNING *;`,
      [id, codigo_ibge]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ 
        message: 'Relacionamento já existe' 
      });
    }

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Erro ao inserir relacionamento:', error);
    res.status(500).json({ 
      error: 'Erro ao inserir relacionamento' 
    });
  }
});

// GET /transportadoras/:id/cidades
// Retorna todas as cidades vinculadas à transportadora
router.get('/transportadoras/:id/cidades', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT c.codigo_ibge, c.nome
       FROM transportadora_cidade tc
       JOIN cidades c ON tc.codigo_ibge = c.codigo_ibge
       WHERE tc.transportadora_id = $1;`,
      [id]
    );

    res.status(200).json({
      success: true,
      transportadora_id: id,
      cidades: result.rows
    });
  } catch (error) {
    console.error('Erro ao buscar cidades:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar cidades' 
    });
  }
});

// GET /cidades/:codigo_ibge/transportadoras
// Retorna todas as transportadoras que atendem essa cidade
router.get('/cidades/:codigo_ibge/transportadoras', async (req, res) => {
  const { codigo_ibge } = req.params;

  try {
    const result = await pool.query(
      `SELECT t.id, t.nome
       FROM transportadora_cidade tc
       JOIN transportadoras t ON tc.transportadora_id = t.id
       WHERE tc.codigo_ibge = $1;`,
      [codigo_ibge]
    );

    res.status(200).json({
      success: true,
      codigo_ibge: codigo_ibge,
      transportadoras: result.rows
    });
  } catch (error) {
    console.error('Erro ao buscar transportadoras:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar transportadoras' 
    });
  }
});

module.exports = router;