const fs = require('fs');
const path = require('path');
const pool = require('../src/db/connection');

async function migrar() {
  try {
    const filePath = '/opt/render/project/data/produtos.json';

    if (!fs.existsSync(filePath)) {
      console.log('Arquivo produtos.json não encontrado.');
      process.exit(1);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const produtos = JSON.parse(raw);

    console.log(`Iniciando migração de ${produtos.length} produtos...`);

    for (const p of produtos) {
      await pool.query(
        `INSERT INTO produtos
        (nome, preco, categoria, foto, capacidade_caixa)
        VALUES ($1,$2,$3,$4,$5)`,
        [
          p.nome,
          Number(p.preco) || 0,
          p.categoria || null,
          p.foto || null,
          p.capacidade_caixa || 1
        ]
      );
    }

    console.log('✅ Migração concluída com sucesso.');
    process.exit();
  } catch (error) {
    console.error('❌ Erro na migração:', error);
    process.exit(1);
  }
}

migrar();
