'use strict';
const express = require('express');
const service = require('../../services/integracoes/elevenlabs-jr.service');
const router = express.Router();
const MAX_REQUISICOES_MINUTO = 5;
let janela = 0, contagem = 0;

function origemValida(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({erro:'Origem não autorizada.'});
    } catch (_) { return res.status(403).json({erro:'Origem inválida.'}); }
  }
  next();
}
function limitar(req,res,next) {
  const t = Date.now();
  if (t-janela >= 60000) { janela=t; contagem=0; }
  if (++contagem > MAX_REQUISICOES_MINUTO) return res.status(429).json({erro:'Limite de testes atingido. Aguarde um minuto.'});
  next();
}
function erro(res,e) { res.status(e.status || 500).json({erro: e.message || 'Falha ao chamar integração de voz.'}); }
router.get('/config', (req,res) => res.json(service.configurar()));
router.get('/vozes', async(req,res) => { try{res.json({vozes:await service.listarVozes()});} catch(e){erro(res,e);} });
router.get('/modelos', async(req,res) => { try{res.json({modelos:await service.listarModelos()});} catch(e){erro(res,e);} });
router.post('/gerar', origemValida, limitar, async(req,res) => {
  try {
    const audio = await service.gerarAudio(req.body || {});
    const previewId = service.salvarPreview(audio, req.adminUser);
    res.set('X-Preview-Id', previewId);
    res.set('Cache-Control','no-store');
    res.type('audio/mpeg').send(audio.bytes);
  } catch(e) {erro(res,e);}
});
router.post('/enviar-teste', origemValida, limitar, async(req,res) => {
  try { res.json(req.body?.previewId ? await service.enviarPreview(req.body, req.adminUser) : await service.enviarTeste(req.body || {})); }
  catch(e) {erro(res,e);}
});
module.exports = router;
