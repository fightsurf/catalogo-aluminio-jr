'use strict';
const express = require('express');
const path = require('path');
// As 906 imagens SVG chegam dentro da dependência npm, instalada no build.
const workoutPackageRoot = path.dirname(require.resolve('@bryllim/workout-guide/manifest.json'));
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const avnSistemaAplicativos = require('../../services/avn/avnSistemaAplicativos.service');
const avnTreinosRoutes = require('./avn-treinos.routes');
const avnNutricaoRoutes = require('./avn-nutricao.routes');
const avnHidratacaoRoutes = require('./avn-hidratacao.routes');
const pool = require('../../../db/connection');
const router = express.Router();

// A aplicação existente já monta este router em /avn/sistema, protegido por requireAuth.
// Optou-se por concentrar a nova funcionalidade aqui para não substituir o server.js
// do sistema da fábrica nem introduzir conflito com outros módulos.
const treinoApps = [
  {rota:'/avn/sistema/exercicios', nome:'Biblioteca de Exercícios', icone:'dumbbell', descricao:'Catálogo ilustrado por grupo muscular, instruções e equipamentos.'},
  {rota:'/avn/sistema/montador', nome:'Montador de Treinos', icone:'list-plus', descricao:'Monte a semana com arrastar e soltar; personalize cada exercício.'},
  {rota:'/avn/sistema/minha-academia', nome:'Minha Academia', icone:'warehouse', descricao:'Máquinas e acessórios disponíveis para os programas de treino.'},
  {rota:'/avn/sistema/perfil-treinamento', nome:'Perfil de Treinamento', icone:'clipboard-user', descricao:'Experiência, regularidade, objetivos e limitações para orientar a IA.'},
  {rota:'/avn/sistema/treinar', nome:'Registrar Treino', icone:'clipboard-check', descricao:'Registre cargas e séries realmente executadas.'},
];
const nutricaoApps = [
  {rota:'/avn/sistema/nutricao/diario',nome:'Diário alimentar',categoria:'Nutrição',icone:'notebook-pen',descricao:'Registrar alimentos realmente consumidos e seus nutrientes.'},
  {rota:'/avn/sistema/nutricao/dieta',nome:'Dieta programada',categoria:'Nutrição',icone:'calendar-days',descricao:'Planejamento de refeições de segunda a domingo.'},
  {rota:'/avn/sistema/nutricao/alimentos',nome:'Alimentos',categoria:'Nutrição',icone:'utensils',descricao:'Cadastro de alimentos, TACO, USDA e consulta IA em JSON.'},
  {rota:'/avn/sistema/nutricao/metas',nome:'Minhas metas',categoria:'Nutrição',icone:'target',descricao:'Metas de calorias, macros e micronutrientes.'},
  {rota:'/avn/sistema/nutricao/receitas',nome:'Receitas',categoria:'Nutrição',icone:'chef-hat',descricao:'Composição nutricional de preparações por ingredientes e rendimento final.'},
  {rota:'/avn/sistema/nutricao/agua',nome:'Água ingerida',categoria:'Nutrição',icone:'droplets',descricao:'Ingestão diária de água e gráfico, sincronizados com Android.'}
];
const corporalApps = [
  {rota:'/avn/sistema/peso',nome:'Peso',categoria:'Avaliação Física',icone:'scale',descricao:'Histórico de peso corporal.'},
  {rota:'/avn/sistema/imc',nome:'IMC',categoria:'Avaliação Física',icone:'calculator',descricao:'Histórico de índice de massa corporal.'},
  {rota:'/avn/sistema/gordura-corporal',nome:'Gordura Corporal',categoria:'Avaliação Física',icone:'percent',descricao:'Percentual de gordura corporal.'},
  {rota:'/avn/sistema/massa-magra',nome:'Massa Magra',categoria:'Avaliação Física',icone:'activity',descricao:'Histórico de massa magra.'},
  {rota:'/avn/sistema/agua-corporal',nome:'Água Corporal',categoria:'Avaliação Física',icone:'droplets',descricao:'Histórico de água corporal.'},
  {rota:'/avn/sistema/massa-ossea',nome:'Massa Óssea',categoria:'Avaliação Física',icone:'bone',descricao:'Histórico de massa óssea.'},
];
const todosApps = [...treinoApps, ...nutricaoApps, ...corporalApps];
async function inserirTreinosNoResumo(summary) {
  await avnSistemaAplicativos.ensureSchema();
  const {rows:registros}=await pool.query('SELECT rota,nome,categoria,visibilidade,favorito,ordem FROM public.avn_sistema_aplicativos_config WHERE rota=ANY($1::text[])',[todosApps.map(a=>a.rota)]);
  const configs=new Map(registros.map(c=>[c.rota,c]));
  // Mantém compatibilidade com a estrutura usada pela Central de Aplicativos do AVN.
  const existentes = new Set(summary.apps.map(x => x.rota));
  const adicionais = todosApps.filter(a => !existentes.has(a.rota)).map((a, i) => ({
    id:Buffer.from(a.rota).toString('base64url'), ...a, categoria:a.categoria || 'Atividades Físicas',
    visibilidade:'principal', favorito:false, ordem:2000+i, conhecido:true, personalizado:false,
  }));
  for(const app of adicionais){const c=configs.get(app.rota);if(c){app.nome=c.nome||app.nome;app.categoria=c.categoria||app.categoria;app.visibilidade=c.visibilidade||app.visibilidade;app.favorito=!!c.favorito;app.ordem=c.ordem??app.ordem;app.personalizado=true;}}
  summary.apps.push(...adicionais);
  summary.apps.sort((a,b)=>(a.ordem??999999)-(b.ordem??999999)||a.nome.localeCompare(b.nome,'pt-BR')); 
  summary.total += adicionais.length;
  summary.visiveis += adicionais.filter(a=>a.visibilidade!=='oculto').length;
  for(const a of adicionais){let cat=summary.categoriasDetalhes.find(x=>x.nome===a.categoria);if(cat)cat.quantidade++;else{summary.categorias.push(a.categoria);summary.categoriasDetalhes.push({nome:a.categoria,icone:a.categoria==='Nutrição'?'utensils':a.categoria==='Avaliação Física'?'scale':'activity',ordem:null,quantidade:1,personalizada:false});}}
  return summary;
}

function novoApp(rota){return todosApps.find(a=>a.rota===rota);}
async function salvarConfigNovo(body){
  const base=novoApp(String(body.rota||''));if(!base)return null;
  const nome=String(body.nome??base.nome).trim().slice(0,160)||base.nome;
  const categoria=String(body.categoria??base.categoria??'Atividades Físicas').trim().slice(0,100)||'Atividades Físicas';
  const visibilidade=['principal','secundario','oculto'].includes(body.visibilidade)?body.visibilidade:'principal';
  const ordem=Number.isInteger(body.ordem)?body.ordem:null;
  await avnSistemaAplicativos.ensureSchema();
  await pool.query(`INSERT INTO public.avn_sistema_aplicativos_config(rota,nome,categoria,visibilidade,favorito,ordem,atualizado_em)
    VALUES($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT(rota) DO UPDATE SET nome=EXCLUDED.nome,categoria=EXCLUDED.categoria,visibilidade=EXCLUDED.visibilidade,
      favorito=EXCLUDED.favorito,ordem=EXCLUDED.ordem,atualizado_em=NOW()`,
    [base.rota,nome,categoria,visibilidade,Boolean(body.favorito),ordem]);
  return (await inserirTreinosNoResumo(await avnSistemaAplicativos.getSummary())).apps.find(a=>a.rota===base.rota);
}
router.get('/', requireAuth, (req,res) => res.sendFile(path.resolve(__dirname,'../../../views/avn/index.html')));
router.get('/api/apps', requireAuth, async (req,res) => {
  try { res.set('Cache-Control','no-store'); res.json(await inserirTreinosNoResumo(await avnSistemaAplicativos.getSummary())); }
  catch(err){ console.error('[AVN sistema] erro ao montar catálogo:',err); res.status(500).json({erro:'Não foi possível montar o catálogo de aplicativos.'}); }
});
router.put('/api/apps/config', requireAuth, async (req,res) => {
  try { res.json({ok:true, app:await salvarConfigNovo(req.body||{}) || await avnSistemaAplicativos.saveConfig(req.body || {})}); }
  catch(err){ console.error('[AVN sistema] erro ao salvar configuração:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível salvar.'}); }
});
router.put('/api/apps/ordem', requireAuth, async (req,res) => {
  try {
    const categoria=String(req.body?.categoria||'').trim();const rotas=Array.isArray(req.body?.rotas)?req.body.rotas:[];
    await avnSistemaAplicativos.reorderApps(categoria,rotas);
    const existing=await inserirTreinosNoResumo(await avnSistemaAplicativos.getSummary());
    const custom=rotas.filter(x=>novoApp(x));
    for(let i=0;i<custom.length;i++){
      const app=existing.apps.find(a=>a.rota===custom[i]);
      if(app)await salvarConfigNovo({...app,ordem:rotas.indexOf(custom[i])*10+10});
    }
    res.json({ok:true,apps:(await inserirTreinosNoResumo(await avnSistemaAplicativos.getSummary())).apps.filter(a=>a.categoria===categoria)});
  }
  catch(err){ console.error('[AVN sistema] erro ao ordenar aplicativos:',err); res.status(err.status||500).json({erro:err.message||'Não foi possível salvar a ordem dos aplicativos.'}); }
});
router.delete('/api/apps/config', requireAuth, async (req,res) => {
  try {
    if(novoApp(req.body?.rota)){
      await pool.query('DELETE FROM public.avn_sistema_aplicativos_config WHERE rota=$1',[req.body.rota]);
      return res.json({ok:true,app:(await inserirTreinosNoResumo(await avnSistemaAplicativos.getSummary())).apps.find(a=>a.rota===req.body.rota)});
    }
    res.json({ok:true,app:await avnSistemaAplicativos.resetConfig(req.body?.rota)});
  }
  catch(err){ console.error('[AVN sistema] erro ao restaurar configuração:',err); res.status(500).json({erro:'Não foi possível restaurar.'}); }
});
router.get('/api/categorias', requireAuth, async (req,res) => {
  try {
    res.set('Cache-Control','no-store');
    const summary=await inserirTreinosNoResumo(await avnSistemaAplicativos.getSummary());
    res.json({categorias:summary.categoriasDetalhes});
  }
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
  catch(err){ console.error('[AVN sistema] erro ao excluir categoria:',err); res.status(500).json({erro:'Não foi possível excluir a categoria.'}); }
});
router.put('/api/categorias-ordem', requireAuth, async (req,res) => {
  try { res.json({ok:true,categorias:await avnSistemaAplicativos.reorderCategories(req.body?.nomes || [])}); }
  catch(err){ console.error('[AVN sistema] erro ao ordenar categorias:',err); res.status(err.status||500).json({erro:'Não foi possível salvar a ordem das categorias.'}); }
});

// Serve as imagens em domínio próprio, com controle de acesso e cache.
router.use('/midias', requireAuth, express.static(path.join(workoutPackageRoot,'assets'), {
  dotfiles:'deny',fallthrough:false,immutable:true,maxAge:'7d',
  setHeaders(res){res.setHeader('X-Content-Type-Options','nosniff');}
}));

for(const a of corporalApps){const slug=a.rota.split('/').pop();router.get('/'+slug,requireAuth,(_req,res)=>res.sendFile(path.resolve(__dirname,'../../../views/avn/indicador-'+slug+'.html')));}

// Montador, biblioteca, consulta e execução: API + 4 páginas sob login já existente.
router.use('/api/treinos', requireAuth, avnTreinosRoutes);
for (const [rota, arquivo] of [
  ['exercicios','exercicios.html'],['montador','montador.html'],
  ['meus-treinos','meus-treinos.html'],['treinar','treinar.html'],
  ['minha-academia','minha-academia.html'],['perfil-treinamento','perfil-treinamento.html'],
]) {
  router.get('/'+rota, requireAuth, (_req,res)=>res.sendFile(path.resolve(__dirname,'../../../views/avn/'+arquivo)));
}
router.use('/api/nutricao', requireAuth, avnNutricaoRoutes);
router.use('/api/hidratacao', requireAuth, avnHidratacaoRoutes.web);
router.get('/nutricao', requireAuth, (req,res) => {
  const oldTab=String(req.query.tab||'');
  const destino=['diario','dieta','alimentos','metas','receitas','agua'].includes(oldTab)?oldTab:'diario';
  res.redirect(302,'/avn/sistema/nutricao/'+destino);
});
for(const pagina of ['diario','dieta','alimentos','metas','receitas','agua']){
  router.get('/nutricao/'+pagina,requireAuth,(_req,res)=>res.sendFile(path.resolve(__dirname,'../../../views/avn/nutricao-'+pagina+'.html')));
}
module.exports=router;
