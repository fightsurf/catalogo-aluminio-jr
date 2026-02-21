const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// PostgreSQL pool connection
const pool = new Pool({
  user: 'your_username',
  host: 'localhost',
  database: 'your_database',
  password: 'your_password',
  port: 5432,
});

// POST route to add a new transportadora-cidade relationship
router.post('/transportadora-cidade', async (req, res) => {
  const { transportadoraId, cidadeId } = req.body;
  try {
    const result = await pool.query(`
      INSERT INTO transportadoras_cidades (transportadora_id, cidade_id) 
      VALUES ($1, $2)
      ON CONFLICT (transportadora_id, cidade_id) DO NOTHING
      RETURNING *;
    `, [transportadoraId, cidadeId]);

    if (result.rowCount === 0) {
      return res.status(409).json({ message: 'Relationship already exists.' });
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding relationship:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// GET route to retrieve transportadora-cidade relationships
router.get('/transportadora-cidade', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transportadoras_cidades;');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error retrieving relationships:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

module.exports = router;