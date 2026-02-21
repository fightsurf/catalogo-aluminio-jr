const express = require('express');
const router = express.Router();

// Mock database
let transportadoras = [];

// CRUD operations for Transportadoras

// Create a new transportadora
router.post('/', (req, res) => {
    const newTransportadora = req.body;
    transportadoras.push(newTransportadora);
    res.status(201).json(newTransportadora);
});

// Read all transportadoras
router.get('/', (req, res) => {
    res.status(200).json(transportadoras);
});

// Read a transportadora by ID
router.get('/:id', (req, res) => {
    const { id } = req.params;
    const transportadora = transportadoras.find(t => t.id === id);
    if (!transportadora) return res.status(404).send('Transportadora not found');
    res.status(200).json(transportadora);
});

// Update a transportadora by ID
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const index = transportadoras.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).send('Transportadora not found');
    transportadoras[index] = {...transportadoras[index], ...req.body};
    res.status(200).json(transportadoras[index]);
});

// Delete a transportadora by ID
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    const index = transportadoras.findIndex(t => t.id === id);
    if (index === -1) return res.status(404).send('Transportadora not found');
    transportadoras.splice(index, 1);
    res.status(204).send();
});

module.exports = router;