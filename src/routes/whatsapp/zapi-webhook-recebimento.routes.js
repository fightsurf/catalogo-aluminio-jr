'use strict';

const express = require('express');
const crypto = require('crypto');
const recebimento = require('../../services/whatsapp/zapi-webhook-recebimento.service');
const router = express.Router();

// A Z-API permite configurar a URL do webhook, incluindo um parâmetro de consulta.
// O segredo é definido apenas em ZAPI_WEBHOOK_TOKEN no Render (nunca no GitHub).
function autenticar(req, res, next) {
  const esperado = String(process.env.ZAPI_WEBHOOK_TOKEN || '').trim();
  if (esperado.length < 32) {
    return res.status(503).json({ success: false, message: 'Webhook ainda não configurado.' });
  }

  const enviado = typeof req.query.chave === 'string'
    ? req.query.chave : String(req.get('x-zapi-webhook-token') || '');
  const a = Buffer.from(enviado);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, message: 'Credencial inválida.' });
  }
  next();
}

// Checagem simples de implantação, sem inserir registros.
router.get('/zapi', autenticar, (_req, res) => res.json({
  success: true, webhook: 'zapi-recebimento', configurado: true
}));

router.post('/zapi', autenticar, async (req, res) => {
  try {
    const resultado = await recebimento.registrar(req.body);
    return res.status(200).json({ success: true, ...resultado });
  } catch (error) {
    // Nunca registrar o payload nem as credenciais nos logs.
    console.error('[Webhook Z-API] Falha ao registrar mensagem:', error.message);
    return res.status(500).json({ success: false, message: 'Falha no registro.' });
  }
});

module.exports = router;
