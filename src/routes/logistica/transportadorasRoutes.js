'use strict';
const express = require('express');
const router = express.Router();
const controller = require('../../controllers/logistica/transportadorasController');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const mesclagem = require('../../services/logistica/mesclagemTransportadorasService');

function mesmaOrigem(req, res, next) {
  const origem = req.get('origin');
  if (!origem) return next();
  try {
    if (new URL(origem).host !== req.get('host')) {
      return res.status(403).json({ error: 'Origem não autorizada.' });
    }
  } catch (_) {
    return res.status(403).json({ error: 'Origem inválida.' });
  }
  next();
}

function erroMesclagem(res, erro) {
  const status = Number(erro.statusCode || 500);
  if (status >= 500) console.error('[logistica/mesclagem]', erro);
  res.status(status).json({ error: status >= 500 ? 'Erro interno na mesclagem. Nenhum dado foi alterado.' : erro.message });
}

router.post('/mesclagem/previa', requireAuth, mesmaOrigem, async (req, res) => {
  try {
    res.json(await mesclagem.preverMesclagem(req.body));
  } catch (erro) {
    erroMesclagem(res, erro);
  }
});

router.post('/mesclagem/confirmar', requireAuth, mesmaOrigem, async (req, res) => {
  try {
    const usuario = req.adminUser && (req.adminUser.email || req.adminUser.nome || req.adminUser.username || req.adminUser);
    res.json(await mesclagem.confirmarMesclagem(req.body, usuario));
  } catch (erro) {
    erroMesclagem(res, erro);
  }
});

router.get('/', controller.listar);
router.post('/', controller.criar);
router.put('/:id', controller.atualizar);
router.patch('/:id/telefone-principal', controller.atualizarTelefonePrincipal);
router.delete('/:id', controller.deletar);

module.exports = router;
