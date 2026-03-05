// Existing routes remain unchanged

// Route for botFluxo
app.get('/bot/fluxo', (req, res) => { res.sendFile(path.join(__dirname, 'views', 'bot-admin', 'botFluxo.html')); });
