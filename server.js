const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_PATH = path.join(__dirname, 'data', 'produtos.json');

// ===== LEITURA SEGURA =====
function lerProdutos() {
  try {
    if (!fs.existsSync(DATA_PATH)) return [];
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// ===== CATÁLOGO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// ===== API =====
app.get('/api/produtos', (req, res) => {
  res.json(lerProdutos());
});

// ===== ADMIN (GERADOR) =====
app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ⚠️ NÃO GRAVA EM DISCO NO RENDER
app.post('/admin-1234', (req, res) => {
  const texto = req.body.texto;
  if (!texto) return res.json({ ok: false });

  const linhas = texto.split('\n');
  const produtos = [];
  let categoriaAtual = 'SEM CATEGORIA';

  linhas.forEach(l => {
    const linha = l.trim();
    if (!linha) return;

    if (linha === linha.toUpperCase()) {
      categoriaAtual = linha;
      return;
    }

    const partes = linha.split('\t');
    if (partes.length < 3) return;

    const id = partes[0].trim();
    const nome = partes[1].trim();
    const preco = parseFloat(
      partes[2].replace(',', '.').replace(/[^\d.]/g, '')
    );

    if (!id || !nome || isNaN(preco)) return;

    produtos.push({
      id,
      nome,
      preco,
      categoria: categoriaAtual,
      foto: ''
    });
  });

  // devolve JSON para você copiar
  res.json({
    ok: true,
    total: produtos.length,
    produtos
  });
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo rodando (dados versionados no GitHub)');
});
