// Importing botIntencoesRoutes
const botIntencoesRoutes = require('./src/routes/bot/botIntencoes.routes');

// Registering botIntencoesRoutes with the existing routes
app.use('/bot', botIntencoesRoutes);

// Adding the view route for intencoes-admin
app.get('/bot/intencoes-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'bot-admin', 'bot-intencoes.html'));
});