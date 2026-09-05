const express = require('express');
const multer = require('multer');
const os = require('os');
const controller = require('../../controllers/status-videos/status-videos.controller');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');

const router = express.Router();
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;

// Multer grava diretamente em disco temporário. Nunca usa memoryStorage para vídeo.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!mime.startsWith('video/')) return cb(new Error('Selecione um arquivo de vídeo válido.'));
    cb(null, true);
  },
});

function uploadVideo(req, res, next) {
  upload.single('video')(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Vídeo muito grande. Limite: 250 MB.' });
    }
    return res.status(400).json({ success: false, message: error.message || 'Falha ao receber o vídeo.' });
  });
}

router.get('/diagnostico', requireAuth, controller.diagnostico);
router.get('/publicacoes/:requestId', requireAuth, controller.statusPublicacao);
router.post('/publicar', requireAuth, uploadVideo, controller.publicar);

module.exports = router;
