'use strict';

const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const importacao = require('../../services/logistica/importacaoCidades.service');
const ia = require('../../services/logistica/importacaoCidadesIa.service');

const router = express.Router({ mergeParams: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 5, fileSize: 10 * 1024 * 1024, fields: 2, fieldSize: 80 * 1024, parts: 7 },
  fileFilter(_req, arquivo, cb) {
    if (['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(arquivo.mimetype)) return cb(null, true);
    const erro = new Error('Envie fotos JPG, PNG ou WebP, ou um PDF.');
    erro.status = 400;
    erro.isValidation = true;
    return cb(erro);
  }
}).array('arquivos', 5);

router.use(requireAuth);
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use((req, res, next) => {
  const valor = req.params.id;
  if (!/^[1-9]\d*$/.test(String(valor || '')) || !Number.isSafeInteger(Number(valor))) {
    return res.status(400).json({ erro: 'Selecione uma transportadora válida.' });
  }
  req.transportadoraId = Number(valor);
  next();
});

function responderErro(res, erro) {
  const conhecido = erro.isValidation === true || (Number.isInteger(erro.status) && erro.status >= 400 && erro.status < 600);
  if (!conhecido) console.error('[logistica/importacao-cidades] Falha ao concluir a operação.');
  return res.status(conhecido ? erro.status || 400 : 500).json({
    erro: conhecido ? erro.message : 'Não foi possível concluir a importação. Confira as cidades vinculadas antes de tentar novamente.'
  });
}

router.post('/interpretar', (req, res) => {
  upload(req, res, async erroUpload => {
    if (erroUpload) {
      const erro = erroUpload instanceof multer.MulterError
        ? Object.assign(new Error('Upload inválido ou acima do limite: até 5 fotos ou um PDF, com 10 MB no total.'), { status: 413 })
        : erroUpload;
      return responderErro(res, erro);
    }
    try {
      const resultado = await ia.interpretar({
        texto: req.body?.texto, uf_padrao: req.body?.uf_padrao, arquivos: req.files || []
      });
      return res.json(resultado);
    } catch (erro) { return responderErro(res, erro); }
  });
});

router.post('/previa', async (req, res) => {
  try {
    const resultado = await importacao.prepararImportacao({
      transportadora_id: req.transportadoraId, cidades: req.body?.cidades
    }, { usuario: req.adminUser });
    return res.json(resultado);
  } catch (erro) { return responderErro(res, erro); }
});

router.post('/confirmar', async (req, res) => {
  try {
    const resultado = await importacao.confirmarImportacao({
      transportadora_id: req.transportadoraId, token_previa: req.body?.token_previa
    }, { usuario: req.adminUser });
    return res.json(resultado);
  } catch (erro) { return responderErro(res, erro); }
});

module.exports = router;
