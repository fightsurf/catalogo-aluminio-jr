const express = require('express');
const fs = require('fs');
const path = require('path');

const transportadorasRoutes = require('./src/routes/transportadorasRoutes');
const logisticaRoutes = require('./src/routes/logisticaRoutes');
const funcionarioRoutes = require('./src/routes/funcionario/funcionario.routes');
const fornecedorRoutes = require('./src/routes/fornecedor/fornecedor.routes');



const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// 💾 DISCO PERSISTENTE (PRODUTOS)
// =====================================================

const DATA_DIR = '/opt/render/project/data';
const DATA_PATH = path.join(DATA_DIR, 'produtos.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_PATH)) {
  fs.writeFileSync(DATA_PATH, '[]');
}

function lerProdutos() {
  try {
    const txt = fs.readFileSync(DATA_PATH, 'utf-8').trim();
    if (!txt) return [];
    return JSON.parse(txt);
  } catch (err) {
    console.error('Erro ao ler produtos:', err);
    return [];
  }
}

// =====================================================
// 📦 ROTAS DE PÁGINAS (VIEWS)
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

app.get('/catalogo-celular', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo-celular.html'));
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

// 🔥 ADMIN LOGÍSTICA
app.get('/admin-logistica', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'logistica-admin.html'));
});

// 🔥 ADMIN FUNCIONÁRIOS
app.get('/admin-funcionarios', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'funcionario', 'admin-funcionario.html'));
});

// =====================================================
// 📡 APIs
// =====================================================

// Produtos (JSON legado)
app.get('/api/produtos', (req, res) => {
  res.json(lerProdutos());
});

// Transportadoras (CRUD principal)
app.use('/api/transportadoras', transportadorasRoutes);

// Logística
app.use('/api/logistica', logisticaRoutes);

// Funcionários
app.use('/api/funcionarios', funcionarioRoutes);

//Fornecedores
app.use('/api/fornecedores', fornecedorRoutes);

// =====================================================
// 🚀 SERVER
// =====================================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando na porta', PORT);
});
