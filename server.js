const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const transportadorasRouter = require('./src/routes/transportadoras');
const transportadoraCidadeRouter = require('./src/routes/transportadoraCidade');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== CONEXÃO POSTGRESQL =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// ===== DISCO PERSISTENTE =====
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
    console.error(err);
    return [];
  }
}

// =====================================================
// CATÁLOGO
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

// =====================================================
// APIs
// =====================================================

app.get('/api/produtos', (req, res) => {
  res.json(lerProdutos());
});

app.use('/api/transportadoras', transportadorasRouter);
app.use('/api', transportadoraCidadeRouter);

// =====================================================
// SERVER
// =====================================================

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando');
});
