const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== PASTAS =====
const VIEWS_DIR = path.join(__dirname, '..', 'views');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(__dirname, '..', 'data', 'products.json');

app.use(express.static(PUBLIC_DIR));

// ===== URL SECRETA ADMIN =====
const ADMIN_PATH = '/admin-9f3k2x';

// ===== HELPERS =====
function lerProdutos() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function salvarProdutos(produtos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(produtos, null, 2));
}

// =====================================================
// 🌐 CATÁLOGO DESKTOP
// =====================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'catalogo.html'));
});

// =====================================================
// 📱 CATÁLOGO CELULAR  ✅ ESTA ROTA FALTAVA
// =====================================================
app.get('/catalogo-celular.html', (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'catalogo-celular.html'));
});

// =====================================================
// 📦 API PRODUTOS
// =====================================================
app.get('/api/produtos', (req, res) => {
  const produtos = lerProdutos().filter(p => p.ativo !== false);
  res.json(produtos);
});

// =====================================================
// 🔐 ADMIN
// =====================================================
app.get(ADMIN_PATH, (req, res) => {
  res.sendFile(path.join(VIEWS_DIR, 'admin.html'));
});

// Atualização em massa (Excel → colar)
app.post(`${ADMIN_PATH}/bulk-update`, (req, res) => {
  const texto = req.body.texto || '';
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);

  const produtos = lerProdutos();
  let atualizados = 0;
  let naoEncontrados = [];

  linhas.forEach(linha => {
    const partes = linha.split(/\t| {2,}/);
    if (partes.length < 2) return;

    const nome = partes[0].trim().toLowerCase();
    const precoStr = partes[1].replace(',', '.').trim();
    const preco = parseFloat(precoStr);

    if (isNaN(preco)) return;

    const produto = produtos.find(p => p.nome.toLowerCase() === nome);
    if (produto) {
      produto.preco = preco;
      atualizados++;
    } else {
      naoEncontrados.push(partes[0]);
    }
  });

  salvarProdutos(produtos);

  res.json({ atualizados, naoEncontrados });
});

// =====================================================
// 🚀 SERVER
// =====================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🟢 Catálogo rodando na porta ${PORT}`);
  console.log(`📱 Mobile: /catalogo-celular.html`);
  console.log(`🔐 Admin: ${ADMIN_PATH}`);
});
