'use strict';
const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const piloto = require('../../services/whatsapp/transcricoes-piloto.service');
const router = express.Router();

router.use(requireAuth);
router.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../../../views/whatsapp/transcricoes-piloto.html'));
});
router.get('/api', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...piloto.listar() });
});
// Server-Sent Events: mantém somente o painel de mensagens sincronizado.
// Não há polling nem recarregamento da página. Exige a sessão administrativa.
router.get('/eventos', (_req, res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');

  const enviar = registros => {
    if (res.destroyed || res.writableEnded) return;
    res.write('event: mensagens\ndata: ' + JSON.stringify({ registros }) + '\n\n');
    res.flush?.();
  };
  const cancelar = piloto.assinarMensagens(enviar);
  const manterConexao = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) {
      res.write(': conexao ativa\n\n');
      res.flush?.();
    }
  }, 25000);
  manterConexao.unref?.();
  const limparConexao = () => {
    clearInterval(manterConexao);
    cancelar();
  };
  res.once('close', limparConexao);
  res.once('error', limparConexao);
  enviar(piloto.listarMensagens());
});

module.exports = router;
