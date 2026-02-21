const express = require('express');
const router = express.Router();
const pool = require('../../db/connection');

// GET all transportadoras
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM transportadoras ORDER BY id');
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar transportadoras:', error);
        res.status(500).json({ error: 'Erro ao buscar transportadoras' });
    }
});

// GET transportadora by ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM transportadoras WHERE id = $1',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Transportadora não encontrada' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao buscar transportadora:', error);
        res.status(500).json({ error: 'Erro ao buscar transportadora' });
    }
});

// POST new transportadora
router.post('/', async (req, res) => {
    const { nome, contato_principal, telefone, observacoes } = req.body;
    
    // Validação: nome é obrigatório
    if (!nome) {
        return res.status(400).json({ error: 'Campo "nome" é obrigatório' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO transportadoras (nome, contato_principal, telefone, observacoes) VALUES ($1, $2, $3, $4) RETURNING *',
            [nome, contato_principal || null, telefone || null, observacoes || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao criar transportadora:', error);
        res.status(500).json({ error: 'Erro ao criar transportadora' });
    }
});

// PUT update transportadora
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nome, contato_principal, telefone, observacoes } = req.body;

    // Validação: nome é obrigatório
    if (!nome) {
        return res.status(400).json({ error: 'Campo "nome" é obrigatório' });
    }

    try {
        const result = await pool.query(
            'UPDATE transportadoras SET nome = $1, contato_principal = $2, telefone = $3, observacoes = $4 WHERE id = $5 RETURNING *',
            [nome, contato_principal || null, telefone || null, observacoes || null, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Transportadora não encontrada' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao atualizar transportadora:', error);
        res.status(500).json({ error: 'Erro ao atualizar transportadora' });
    }
});

// DELETE transportadora
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM transportadoras WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Transportadora não encontrada' });
        }
        res.json({ message: 'Transportadora deletada com sucesso', id: result.rows[0].id });
    } catch (error) {
        console.error('Erro ao deletar transportadora:', error);
        res.status(500).json({ error: 'Erro ao deletar transportadora' });
    }
});

module.exports = router;