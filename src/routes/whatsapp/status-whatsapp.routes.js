const express = require('express');
const multer = require('multer');
const controller = require('../../controllers/whatsapp/status-whatsapp.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();

const TIPOS_PERMITIDOS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 12 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (!TIPOS_PERMITIDOS.has(file.mimetype)) {
      return callback(new Error('Formato não permitido. Use JPG, PNG ou WEBP.'));
    }

    return callback(null, true);
  },
});

router.get('/conexao', requireAuth, controller.verificarConexao);
router.post('/imagem', requireAuth, upload.single('imagem'), controller.publicarImagem);

router.use((error, req, res, next) => {
  if (!error) return next();

  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'A imagem ultrapassa o limite de 12 MB.',
    });
  }

  return res.status(400).json({
    success: false,
    message: error.message || 'Arquivo de imagem inválido.',
  });
});

module.exports = router;
