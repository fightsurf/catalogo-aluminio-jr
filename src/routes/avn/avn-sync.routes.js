'use strict';
const express = require('express');
const pool = require('../../../db/connection');
const { importar } = require('./avn-health.routes');
const router = express.Router();
// ATENÇÃO: rota de escrita pública solicitada para uso pessoal.
// Qualquer pessoa que descubra a URL pode enviar medições ao usuário configurado.
// Não registrar IP, tokens nem conteúdo sensível em logs.
router.post('/importar', async (req, res) => {
  try {
    let id = process.env.AVN_SYNC_USUARIO_ID;
    if (id && !/^\d+$/.test(id)) return res.status(503).json({ erro: 'AVN_SYNC_USUARIO_ID inválido.' });
    if (!id) {
      const users = await pool.query('SELECT id FROM public.avn_usuario ORDER BY id LIMIT 2');
      if (users.rowCount !== 1) return res.status(503).json({ erro: 'Configure AVN_SYNC_USUARIO_ID no Render quando houver zero ou múltiplos usuários.' });
      id = String(users.rows[0].id);
    }
    req.params.usuarioId = id;
    return importar(req, res);
  } catch (e) {
    console.error('[AVN Sync]', e);
    return res.status(500).json({ erro: 'Erro ao preparar sincronização.' });
  }
});
module.exports = router;
