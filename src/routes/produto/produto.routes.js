const express = require('express');
const multer = require('multer');
const router = express.Router();
const controller = require('../../controllers/produto/produto.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const tiposPermitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    if (!tiposPermitidos.includes(file.mimetype)) {
      return cb(new Error('Formato invalido. Use JPG, PNG, WEBP ou GIF.'));
    }

    cb(null, true);
  },
});

function tratarErroUpload(err, req, res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'Imagem muito grande. Limite: 10 MB.' });
  }

  return res.status(400).json({ success: false, message: err.message || 'Erro no upload da imagem.' });
}

router.get('/', controller.listar);
router.get('/:id', controller.buscar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.post('/:id/fotos/:posicao', upload.single('foto'), tratarErroUpload, controller.uploadFoto);
router.delete('/:id', controller.excluir);

module.exports = router;
