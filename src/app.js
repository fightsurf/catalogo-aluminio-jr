const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const DATA_FILE = path.join(__dirname, '..', 'data', 'products.json');

// URL secreta do admin (mude o sufixo para algo seu)
const ADMIN_PATH = '/admin-9f3k2x';

// helpers
function lerProdutos() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function salvarProdutos(produtos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(produtos, null, 2));
}

// ===== CATÁLOGO PÚBLICO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'catalogo.html'));
});

app.get('/api/produtos', (req, res) => {
  const produtos = lerProdutos().filter(p => p.ativo !== false);
  res.json(produtos);
});

// ===== ADMIN (URL SECRETA) =====
app.get(ADMIN_PATH, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'admin.html'));
});

// Atualização em massa por texto colado (Excel → colar)
app.post(`${ADMIN_PATH}/bulk-update`, (req, res) => {
  const texto = req.body.texto || '';
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);

  const produtos = lerProdutos();
  let atualizados = 0;
  let naoEncontrados = [];

  linhas.forEach(linha => {
    // aceita TAB ou múltiplos espaços
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

  res.json({
    atualizados,
    naoEncontrados
  });
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🟢 Catálogo rodando na porta ${PORT}`);
  console.log(`🔐 Admin em ${ADMIN_PATH}`);
});

