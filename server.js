const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== DISCO PERSISTENTE (RENDER) =====
const DATA_DIR = '/opt/render/project/data';
const DATA_PATH = path.join(DATA_DIR, 'produtos.json');

// garante pasta e arquivo
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_PATH)) {
  fs.writeFileSync(DATA_PATH, '[]');
}

// ===== FUNÇÃO SEGURA PARA LER JSON =====
function lerProdutos() {
  try {
    const conteudo = fs.readFileSync(DATA_PATH, 'utf-8').trim();
    if (!conteudo) return [];
    return JSON.parse(conteudo);
  } catch (err) {
    console.error('❌ ERRO AO LER produtos.json:', err.message);
    return [];
  }
}

// ===== CATÁLOGO PÚBLICO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// ===== API =====
app.get('/api/produtos', (req, res) => {
  res.json(lerProdutos());
});

// ===== ADMIN (PLANILHA) =====
app.get('/admin-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.post('/admin-1234', (req, res) => {
  const texto = req.body.texto;
  if (!texto) {
    return res.json({ ok: false, erro: 'Texto vazio' });
  }

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

    // linha toda maiúscula = categoria
    if (linha === linha.toUpperCase()) {
      categoriaAtual = linha;
      return;
    }

    // aceita TAB, | ou múltiplos espaços
    let partes = [];

    if (linha.includes('|')) {
      partes = linha.split('|').map(p => p.trim());
    } else if (linha.includes('\t')) {
      partes = linha.split('\t').map(p => p.trim());
    } else {
      // tenta separar por espaços grandes
      partes = linha.split(/\s{2,}/).map(p => p.trim());
    }

    if (partes.length < 3) return;

    const id = partes[0];
    const nome = partes[1];
    const preco = parseFloat(
      partes[2].replace(',', '.').replace(/[^\d.]/g, '')
    );

    if (!id || !nome || isNaN(preco)) return;

    if (mapa[id]) {
      // atualiza mantendo foto
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

  res.json({
    ok: true,
    total: listaFinal.length
  });
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo rodando com DISCO PERSISTENTE');
});
