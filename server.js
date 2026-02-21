const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

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
// 📡 API PRODUTOS (AINDA JSON)
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
// 🧪 TESTE DE BANCO
// =====================================================

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ server_time: result.rows[0].now });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao conectar no banco' });
  }
});

// =====================================================
// 🚀 SERVER
// =====================================================

// =====================================================
// 🏗️ CRIAR TABELAS (TEMPORÁRIO)
// =====================================================

app.get('/init-db', async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transportadoras (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        contato_principal TEXT,
        telefone TEXT,
        observacoes TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cidades (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        estado TEXT NOT NULL,
        codigo_ibge INTEGER UNIQUE NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS transportadora_cidade (
        id SERIAL PRIMARY KEY,
        transportadora_id INTEGER REFERENCES transportadoras(id) ON DELETE CASCADE,
        cidade_id INTEGER REFERENCES cidades(id) ON DELETE CASCADE
      );
    `);

    res.json({ message: 'Tabelas criadas com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar tabelas' });
  }
});


// =====================================================
// 🌎 IMPORTAR CIDADES DO IBGE (TEMPORÁRIO)
// =====================================================

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

app.get('/importar-cidades', async (req, res) => {
  try {
    const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios');
    const municipios = await response.json();

    for (const m of municipios) {
      const nome = m.nome;
      const estado = m.microrregiao.mesorregiao.UF.sigla;
      const codigo = m.id;

      await pool.query(
        `INSERT INTO cidades (nome, estado, codigo_ibge)
         VALUES ($1, $2, $3)
         ON CONFLICT (codigo_ibge) DO NOTHING`,
        [nome, estado, codigo]
      );
    }

    res.json({ message: 'Cidades importadas com sucesso' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao importar cidades' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo Alumínio JR rodando');
});
