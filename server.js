require('dotenv').config();

const express = require('express');
const path = require('path');

// =====================================================
// 📦 IMPORTAÇÃO DE ROTAS MODULARES
// =====================================================

const transportadorasRoutes = require('./src/routes/transportadorasRoutes');
const logisticaRoutes = require('./src/routes/logisticaRoutes');
const funcionarioRoutes = require('./src/routes/funcionario/funcionario.routes');
const fornecedorRoutes = require('./src/routes/fornecedor/fornecedor.routes');
const produtoRoutes = require('./src/routes/produto/produto.routes'); // 🔥 NOVO

const app = express();

// =====================================================
// 🔧 MIDDLEWARES
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// =====================================================
// 📡 APIs
// =====================================================

// 🔥 PRODUTOS (AGORA 100% BANCO)
app.use('/api/produtos', produtoRoutes);

// Transportadoras
app.use('/api/transportadoras', transportadorasRoutes);

// Logística
app.use('/api/logistica', logisticaRoutes);

// Funcionários
app.use('/api/funcionarios', funcionarioRoutes);

// Fornecedores
app.use('/api/fornecedores', fornecedorRoutes);

// =====================================================
// 🚀 SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando na porta', PORT);
});
