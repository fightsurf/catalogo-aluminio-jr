const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const avnSistemaAplicativos = require('../../services/avn/avnSistemaAplicativos.service');
const router = express.Router();
router.get('/', requireAuth, (req,res) => res.sendFile(path.resolve(__dirname,'../../../views/avn/index.html')));
router.get('/api/apps', requireAuth, async (req,res) => {
  try { res.set('Cache-Control','no-store'); res.json(await avnSistemaAplicativos.getSummary()); }
  catch(err){ console.error('[AVN sistema] erro ao montar catálogo:',err); res.status(500).json({erro:'Não foi possível montar o catálogo de aplicativos.'}); }
});
router.put('/api/apps/config', requireAuth, async (req,res) => {
  try { res.json({ok:true, app:await avnSistemaAplicativos.saveConfig(req.body || {})}); }
  catch(err){ console.error('[AVN sistema] erro ao salvar configuração:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível salvar.'}); }
});
router.put('/api/apps/ordem', requireAuth, async (req,res) => {
  try { res.json({ok:true, apps:await avnSistemaAplicativos.reorderApps(req.body?.categoria, req.body?.rotas || [])}); }
  catch(err){ console.error('[AVN sistema] erro ao ordenar aplicativos:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível salvar a ordem dos aplicativos.'}); }
});
router.delete('/api/apps/config', requireAuth, async (req,res) => {
  try { res.json({ok:true, app:await avnSistemaAplicativos.resetConfig(req.body?.rota)}); }
  catch(err){ console.error('[AVN sistema] erro ao restaurar configuração:',err); res.status(500).json({erro:'Não foi possível restaurar.'}); }
});

router.get('/api/categorias', requireAuth, async (req,res) => {
  try { res.set('Cache-Control','no-store'); res.json({categorias:await avnSistemaAplicativos.getCategories()}); }
  catch(err){ console.error('[AVN sistema] erro ao listar categorias:',err); res.status(500).json({erro:'Não foi possível listar as categorias.'}); }
});
router.post('/api/categorias', requireAuth, async (req,res) => {
  try { res.status(201).json({ok:true,categoria:await avnSistemaAplicativos.createCategory(req.body || {})}); }
  catch(err){ console.error('[AVN sistema] erro ao criar categoria:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível criar a categoria.'}); }
});
router.put('/api/categorias/:nome', requireAuth, async (req,res) => {
  try { res.json({ok:true,categoria:await avnSistemaAplicativos.updateCategory(req.params.nome,req.body || {})}); }
  catch(err){ console.error('[AVN sistema] erro ao alterar categoria:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível alterar a categoria.'}); }
});
router.delete('/api/categorias/:nome', requireAuth, async (req,res) => {
  try { res.json(await avnSistemaAplicativos.deleteCategory(req.params.nome)); }
  catch(err){ console.error('[AVN sistema] erro ao excluir categoria:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível excluir a categoria.'}); }
});
router.put('/api/categorias-ordem', requireAuth, async (req,res) => {
  try { res.json({ok:true,categorias:await avnSistemaAplicativos.reorderCategories(req.body?.nomes || [])}); }
  catch(err){ console.error('[AVN sistema] erro ao ordenar categorias:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível ordenar as categorias.'}); }
});
module.exports = router;
