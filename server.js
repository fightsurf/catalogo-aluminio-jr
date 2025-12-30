const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== DISCO PERSISTENTE (RENDER) =====
const DATA_DIR = '/opt/render/project/data';
const DATA_PATH = path.join(DATA_DIR, 'produtos.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_PATH)) {
  fs.writeFileSync(DATA_PATH, '[]');
}

// ===== LEITURA SEGURA =====
function lerProdutos() {
  try {
    const txt = fs.readFileSync(DATA_PATH, 'utf-8').trim();
    if (!txt) return [];
    return JSON.parse(txt);
  } catch (err) {
    console.error('❌ ERRO JSON:', err.message);
    return [];
  }
}

// =====================================================
// 📦 CATÁLOGOS
// =====================================================

// Catálogo padrão (desktop)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// Catálogo mobile
app.get('/catalogo-celular', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo-celular.html'));
});

// 🔥 KITS FEIRINHA (RESTAURADO)
app.get('/kits-feirinha', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'kits-feirinha.html'));
});

// 📋 ORÇAMENTO
app.get('/orcamento', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'orcamento.html'));
});

// =====================================================
// 📡 API PRODUTOS
// =====================================================
app.get('/api/produtos', (req, res) => {
  res.json(lerProdutos());
});

// =====================================================
// 🔐 ADMIN – PLANILHA
// =====================================================
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

  produtosExistentes.forEach(p => {
    if (p.id) mapa[p.id] = p;
  });

  let categoriaAtual = 'SEM CATEGORIA';
  let contador = 0;

  linhas.forEach(raw => {
    const linha = raw.trim();
    if (!linha) return;

    if (linha === linha.toUpperCase() && !linha.match(/^\d+/)) {
      categoriaAtual = linha;
      return;
    }

    const partes = linha.split('\t').map(p => p.trim());
    if (partes.length < 3) return;

    const id = partes[0];
    const nome = partes[1];
    const precoTexto = partes[2];

    const preco = parseFloat(
      precoTexto.replace(',', '.').replace(/[^\d.]/g, '')
    );

    if (!id || !nome || isNaN(preco)) return;

    if (mapa[id]) {
      mapa[id].nome = nome;
      mapa[id].preco = preco;
      mapa[id].categoria = categoriaAtual;
    } else {
      mapa[id] = {
        id,
        nome,
        preco,
        categoria: categoriaAtual,
        foto: ''
      };
    }

    contador++;
  });

  fs.writeFileSync(DATA_PATH, JSON.stringify(Object.values(mapa), null, 2));

  res.json({
    ok: true,
    total: Object.keys(mapa).length,
    processados: contador
  });
});

// =====================================================
// 🖼️ ADMIN – FOTOS
// =====================================================
app.get('/admin-fotos-1234', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-fotos.html'));
});

app.post('/admin-fotos-1234', (req, res) => {
  const { id, foto } = req.body;
  if (!id || !foto) {
    return res.json({ ok: false });
  }

  const produtos = lerProdutos();
  const produto = produtos.find(p => p.id === id);

  if (!produto) {
    return res.json({ ok: false, erro: 'Produto não encontrado' });
  }

  produto.foto = foto.trim();
  fs.writeFileSync(DATA_PATH, JSON.stringify(produtos, null, 2));

  res.json({ ok: true });
});

// =====================================================
// 🚀 SERVER
// =====================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando');
  console.log('📦 Catálogo: /');
  console.log('📱 Catálogo celular: /catalogo-celular');
  console.log('🔥 Kits feirinha: /kits-feirinha');
  console.log('📋 Orçamento: /orcamento');
});
