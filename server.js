const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== GARANTIR PASTA DATA =====
const DATA_DIR = path.join(__dirname, 'data');
const DATA_PATH = path.join(DATA_DIR, 'produtos.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

if (!fs.existsSync(DATA_PATH)) {
  fs.writeFileSync(DATA_PATH, '[]');
}

// ===== ARQUIVOS ESTÁTICOS =====
app.use('/public', express.static(path.join(__dirname, 'public')));

// ===== CATÁLOGO PÚBLICO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// ===== API PRODUTOS =====
app.get('/api/produtos', (req, res) => {
  try {
    const dados = fs.readFileSync(DATA_PATH, 'utf-8');
    res.json(JSON.parse(dados));
  } catch (err) {
    res.json([]);
  }
});

// ===== ADMIN SECRETO =====
app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.post('/admin-1234', (req, res) => {
  const texto = req.body.texto;
  if (!texto) return res.json({ ok: false });

  const linhas = texto.split('\n');
  const produtos = [];

  linhas.forEach(linha => {
    const partes = linha.split('\t');
    if (partes.length >= 2) {
      produtos.push({
        nome: partes[0].trim(),
        preco: partes[1].trim()
      });
    }
  });

  fs.writeFileSync(DATA_PATH, JSON.stringify(produtos, null, 2));
  res.json({ ok: true, total: produtos.length });
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🟢 Catálogo rodando na porta ${PORT}`);
});
