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
router.put('/api/apps/ordem', requireAuth, async (req,res) => {
  try { res.json({ok:true, apps:await sistemaAplicativos.reorderApps(req.body?.categoria, req.body?.rotas || [])}); }
  catch(err){ console.error('[sistema] erro ao ordenar aplicativos:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível salvar a ordem dos aplicativos.'}); }
});
router.delete('/api/apps/config', requireAuth, async (req,res) => {
  try { res.json({ok:true, app:await sistemaAplicativos.resetConfig(req.body?.rota)}); }
  catch(err){ console.error('[sistema] erro ao restaurar configuração:',err); res.status(500).json({erro:'Não foi possível restaurar.'}); }
});

router.get('/api/categorias', requireAuth, async (req,res) => {
  try { res.set('Cache-Control','no-store'); res.json({categorias:await sistemaAplicativos.getCategories()}); }
  catch(err){ console.error('[sistema] erro ao listar categorias:',err); res.status(500).json({erro:'Não foi possível listar as categorias.'}); }
});
router.post('/api/categorias', requireAuth, async (req,res) => {
  try { res.status(201).json({ok:true,categoria:await sistemaAplicativos.createCategory(req.body || {})}); }
  catch(err){ console.error('[sistema] erro ao criar categoria:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível criar a categoria.'}); }
});
router.put('/api/categorias/:nome', requireAuth, async (req,res) => {
  try { res.json({ok:true,categoria:await sistemaAplicativos.updateCategory(req.params.nome,req.body || {})}); }
  catch(err){ console.error('[sistema] erro ao alterar categoria:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível alterar a categoria.'}); }
});
router.delete('/api/categorias/:nome', requireAuth, async (req,res) => {
  try { res.json(await sistemaAplicativos.deleteCategory(req.params.nome)); }
  catch(err){ console.error('[sistema] erro ao excluir categoria:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível excluir a categoria.'}); }
});
router.put('/api/categorias-ordem', requireAuth, async (req,res) => {
  try { res.json({ok:true,categorias:await sistemaAplicativos.reorderCategories(req.body?.nomes || [])}); }
  catch(err){ console.error('[sistema] erro ao ordenar categorias:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível ordenar as categorias.'}); }
});
module.exports = router;
