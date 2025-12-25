const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_PATH = path.join(__dirname, 'data', 'produtos.json');

// ===== CATÁLOGO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// ===== API =====
app.get('/api/produtos', (req, res) => {
  const dados = fs.readFileSync(DATA_PATH, 'utf-8');
  res.json(JSON.parse(dados));
});

// ===== ADMIN =====
app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.post('/admin-1234', (req, res) => {
  const texto = req.body.texto;
  if (!texto) return res.json({ ok: false });

  const linhas = texto.split('\n');
  const produtos = [];

  let categoriaAtual = 'SEM CATEGORIA';

  linhas.forEach(linha => {
    const limpa = linha.trim();
    if (!limpa) return;

    // linha toda maiúscula = categoria
    if (limpa === limpa.toUpperCase()) {
      categoriaAtual = limpa;
      return;
    }

    // produto (TAB ou R$)
    const partes = limpa.split('\t');
    if (partes.length < 2) return;

    const nome = partes[0].trim();
    const precoTexto = partes[1]
      .replace('R$', '')
      .replace(',', '.')
      .trim();

    const preco = parseFloat(precoTexto);
    if (isNaN(preco)) return;

    produtos.push({
      categoria: categoriaAtual,
      nome,
      preco
    });
  });

  fs.writeFileSync(DATA_PATH, JSON.stringify(produtos, null, 2));
  res.json({ ok: true, total: produtos.length });
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
