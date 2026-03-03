'use strict';

const express = require('express');
const app = express();

// Importing existing bot routes
const botIntencoesRoutes = require('./src/routes/bot/botIntencoes.routes');

app.use('/bot', botIntencoesRoutes);
// Other existing routes...

app.get('/bot/intencoes-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/bot-admin/bot-intencoes.html'));
});

// Existing /bot/contatos handler...

module.exports = app;