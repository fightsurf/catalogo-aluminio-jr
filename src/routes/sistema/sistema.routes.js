const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const sistemaAplicativos = require('../../services/sistema/sistemaAplicativos.service');
const router = express.Router();
router.get('/', requireAuth, (req,res) => res.sendFile(path.resolve(__dirname,'../../../views/sistema/index.html')));
router.get('/api/apps', requireAuth, async (req,res) => {
  try { res.set('Cache-Control','no-store'); res.json(await sistemaAplicativos.getSummary()); }
  catch(err){ console.error('[sistema] erro ao montar catálogo:',err); res.status(500).json({erro:'Não foi possível montar o catálogo de aplicativos.'}); }
});
router.put('/api/apps/config', requireAuth, async (req,res) => {
  try { res.json({ok:true, app:await sistemaAplicativos.saveConfig(req.body || {})}); }
  catch(err){ console.error('[sistema] erro ao salvar configuração:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível salvar.'}); }
});
router.delete('/api/apps/config', requireAuth, async (req,res) => {
  try { res.json({ok:true, app:await sistemaAplicativos.resetConfig(req.body?.rota)}); }
  catch(err){ console.error('[sistema] erro ao restaurar configuração:',err); res.status(500).json({erro:'Não foi possível restaurar.'}); }
});
module.exports = router;
