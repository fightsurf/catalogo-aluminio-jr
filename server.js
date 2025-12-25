const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_PATH = path.join(__dirname, 'data', 'produtos.json');

// ===== FUNÇÃO SEGURA PARA LER JSON =====
function lerProdutos() {
  try {
    if (!fs.existsSync(DATA_PATH)) return [];
    const conteudo = fs.readFileSync(DATA_PATH, 'utf-8').trim();
    if (!conteudo) return [];
    return JSON.parse(conteudo);
  } catch (err) {
    console.error('❌ ERRO AO LER produtos.json:', err.message);
    return [];
  }
}

// ===== CATÁLOGO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// ===== API =====
app.get('/api/produtos', (req, res) => {
  const produtos = lerProdutos();
  res.json(produtos);
});

// ===== ADMIN =====
app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.post('/admin-1234', (req, res) => {
  const texto = req.body.texto;
  if (!texto) return res.json({ ok: false, erro: 'Texto vazio' });

  const linhas = texto.split('\n');
  const produtos = [];

  let categoriaAtual = 'SEM CATEGORIA';

  linhas.forEach(linha => {
    const limpa = linha.trim();
    if (!limpa) return;

    // categoria = linha toda maiúscula
    if (limpa === limpa.toUpperCase()) {
      categoriaAtual = limpa;
      return;
    }

    // aceita TAB ou "R$"
    let nome = '';
    let precoTexto = '';

    if (limpa.includes('\t')) {
      const partes = limpa.split('\t');
      nome = partes[0].trim();
      precoTexto = partes[1];
    } else if (limpa.includes('R$')) {
      const partes = limpa.split('R$');
      nome = partes[0].trim();
      precoTexto = partes[1];
    } else {
      return;
    }

    const preco = parseFloat(
      precoTexto.replace(',', '.').replace(/[^\d.]/g, '')
    );

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
  console.log(`🟢 Catálogo rodando na porta ${PORT}`);
});
