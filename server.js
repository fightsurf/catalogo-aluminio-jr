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

// ===== GERAR ID AUTOMÁTICO =====
function gerarId(nome) {
  return nome
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

// ===== CATÁLOGO =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'catalogo.html'));
});

// ===== API =====
app.get('/api/produtos', (req, res) => {
  res.json(lerProdutos());
});

// ===== ADMIN PREÇOS =====
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

    // categoria = linha toda maiúscula sem número
    if (linha === linha.toUpperCase() && !linha.match(/\d/)) {
      categoriaAtual = linha;
      return;
    }

    // formato esperado do Excel:
    // NUMERO \t NOME \t R$ PREÇO
    const partes = linha.split('\t').map(p => p.trim());
    if (partes.length < 3) return;

    const nome = partes[1];
    const preco = parseFloat(
      partes[2].replace(',', '.').replace(/[^\d.]/g, '')
    );

    if (!nome || isNaN(preco)) return;

    const id = gerarId(nome);

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
  });

  const listaFinal = Object.values(mapa);
  fs.writeFileSync(DATA_PATH, JSON.stringify(listaFinal, null, 2));

  res.json({ ok: true, total: listaFinal.length });
});

// ===== ADMIN FOTOS =====
app.get('/admin-fotos', (req, res) => {
  const produtos = lerProdutos();

  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Admin Fotos</title>
      <style>
        body { font-family: Arial; padding: 20px; background: #f5f5f5; }
        table { width: 100%; border-collapse: collapse; background: #fff; }
        th, td { border: 1px solid #ccc; padding: 8px; }
        th { background: #eee; }
        input { width: 100%; }
        button { margin-top: 15px; padding: 10px 20px; font-size: 16px; }
      </style>
    </head>
    <body>

    <h2>📸 Atualizar fotos dos produtos</h2>

    <form method="POST" action="/admin-fotos">
      <table>
        <tr>
          <th>ID</th>
          <th>Produto</th>
          <th>URL da Foto</th>
        </tr>

        ${produtos.map(p => `
          <tr>
            <td>${p.id}</td>
            <td>${p.nome}</td>
            <td>
              <input
                type="text"
                name="foto_${p.id}"
                value="${p.foto || ''}"
                placeholder="https://..."
              >
            </td>
          </tr>
        `).join('')}

      </table>

      <button type="submit">Salvar Fotos</button>
    </form>

    </body>
    </html>
  `);
});

app.post('/admin-fotos', (req, res) => {
  const produtos = lerProdutos();

  produtos.forEach(p => {
    const novaFoto = req.body[`foto_${p.id}`];
    if (novaFoto !== undefined) {
      p.foto = novaFoto.trim();
    }
  });

  fs.writeFileSync(DATA_PATH, JSON.stringify(produtos, null, 2));
  res.redirect('/admin-fotos');
});

// ===== SERVER =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('🟢 Catálogo rodando (Excel + Fotos + IDs)');
});
