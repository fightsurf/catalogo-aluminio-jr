const express = require('express');
const path = require('path');

// =====================================================
// 📦 IMPORTAÇÃO DE ROTAS MODULARES
// =====================================================

const transportadorasRoutes = require('./src/routes/transportadorasRoutes');
const logisticaRoutes = require('./src/routes/logisticaRoutes');
const funcionarioRoutes = require('./src/routes/funcionario/funcionario.routes');
const fornecedorRoutes = require('./src/routes/fornecedor/fornecedor.routes');
const produtoRoutes = require('./src/routes/produto/produto.routes');
const produtoCategoriaRoutes = require('./src/routes/produtoCategoria/produtoCategoria.routes');
const volumeRoutes = require('./src/routes/volume/volume.routes');
const adminVolumeRoutes = require('./src/routes/volume/adminVolume.routes');
const prestacaoContasRoutes = require('./src/routes/prestacao_contas/prestacao_contas.routes');
const botRoutes = require('./src/routes/bot/bot.routes');
const botAdminRoutes = require('./src/routes/bot/bot.admin.routes');
const botContatosRoutes = require('./src/routes/bot/botContatos.routes');

const app = express();

// =====================================================
// 🔧 MIDDLEWARES (SEMPRE ANTES DAS ROTAS)
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/prestacao_contas', express.static(path.join(__dirname, 'views', 'prestacao_contas')));

// =====================================================
// 📡 APIs (ROTAS DO BACKEND)
// =====================================================

app.use('/api/produtos-categorias', produtoCategoriaRoutes);
app.use('/api/produtos', produtoRoutes);
app.use('/api/transportadoras', transportadorasRoutes);
app.use('/api/logistica', logisticaRoutes);
app.use('/api/funcionarios', funcionarioRoutes);
app.use('/api/fornecedores', fornecedorRoutes);
app.use('/api/volume', volumeRoutes);
app.use('/api/admin-volume', adminVolumeRoutes);
app.use('/api/prestacoes', prestacaoContasRoutes);
app.use('/bot', botRoutes);
app.use('/bot/admin', botAdminRoutes);
app.use('/bot', botContatosRoutes);
app.use('/bot-admin', express.static(path.join(__dirname, 'views', 'bot-admin')));

app.get('/bot/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'bot-admin', 'index.html'));
});

// =====================================================
// 📦 ROTAS DE PÁGINAS (VIEWS)
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

app.get('/catalogo-celular', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo-celular.html'));
});

app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/admin-produtos', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'produto', 'admin-produtos.html'));
});

app.get('/kits-feirinha', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'kits-feirinha.html'));
});

app.get('/orcamento', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'orcamento.html'));
});

app.get('/combinador', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'combinador.html'));
});

app.get('/admin-logistica', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'logistica-admin.html'));
});

app.get('/admin-funcionarios', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'funcionario', 'admin-funcionario.html'));
});

app.get('/admin-fornecedores', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'fornecedor', 'admin-fornecedor.html'));
});

app.get('/logistica-estado', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'logistica-estado.html'));
});

app.get('/admin-fotos-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-fotos.html'));
});

app.get('/frete', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'frete-bot.html'));
});

app.get('/calcular-volumes', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'volume', 'volume.html'));
});

app.get('/admin-volume', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'volume', 'admin-volume.html'));
});

app.get('/prestacao-contas', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'prestacao_contas', 'prestacao.html'));
});

// =====================================================
// 🚀 SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

// Criar índices de forma segura ao iniciar
const botAdminService = require('./src/services/bot/bot.admin.service');
botAdminService.criarIndices().catch(err => console.warn('⚠️  Índices bot (não crítico):', err.message));

app.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando na porta', PORT);
});
