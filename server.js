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
  res.json(lerProdutos());
});

// ===== ADMIN =====
app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.post('/admin-1234', (req, res) => {
  const texto = req.body.texto;
  if (!texto) return res.json({ ok: false, erro: 'Texto vazio' });

  const linhas = texto.split('\n');
  const produtosExistentes = lerProdutos();
  const mapa = {};

  // indexa produtos existentes por ID
  produtosExistentes.forEach(p => {
    if (p.id) mapa[p.id] = p;
  });

  let categoriaAtual = 'SEM CATEGORIA';

  linhas.forEach(l => {
    const linha = l.trim();
    if (!linha) return;

    // categoria (linha toda maiúscula)
    if (linha === linha.toUpperCase()) {
      categoriaAtual = linha;
      return;
    }

    // formato: ID | NOME | PREÇO
    const partes = linha.split('|').map(p => p.trim());
    if (partes.length < 3) return;

    const id = partes[0];
    const nome = partes[1];
    const preco = parseFloat(
      partes[2].replace(',', '.').replace(/[^\d.]/g, '')
    );

    if (!id || !nome || isNaN(preco)) return;

    if (mapa[id]) {
      // atualiza produto existente
      mapa[id].nome = nome;
      mapa[id].preco = preco;
      mapa[id].categoria = categoriaAtual;
    } else {
      // cria novo produto
      mapa[id] = {
        id,
        nome,
        preco,
        categoria: categoriaAtual,
        foto: ''
      };
    }
  });

  const listaFinal = Object.values(mapa);
  fs.writeFileSync(DATA_PATH, JSON.stringify(listaFinal, null, 2));

  res.json({ ok: true, total: listaFinal.length });
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo rodando com ID fixo por planilha');
});
