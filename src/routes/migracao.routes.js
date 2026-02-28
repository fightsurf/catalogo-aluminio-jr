const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../../db/connection');

const router = express.Router();

// 🔐 chave simples de segurança
const CHAVE = 'migrar-aluminio-jr-2026';

router.get('/migrar-produtos', async (req, res) => {
  try {
    const { key } = req.query;

    if (key !== CHAVE) {
      return res.status(403).json({
        success: false,
        message: 'Acesso negado'
      });
    }

    const filePath = '/opt/render/project/data/produtos.json';

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Arquivo produtos.json não encontrado'
      });
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const produtos = JSON.parse(raw);

    let contador = 0;

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
      contador++;
    }

    return res.json({
      success: true,
      message: `Migração concluída`,
      total_inseridos: contador
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;
