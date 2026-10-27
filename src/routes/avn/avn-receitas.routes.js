'use strict';
const express=require('express');
const pool=require('../../../db/connection');
const {calcular,composicao,micronutrientesDisponiveis}=require('../../services/avn/avn-receitas-calculo.service');
const {interpretar} = require('../../services/avn/avn-receitas-importacao.service');
const router=express.Router();
const id=v=>/^\d+$/.test(String(v||''))&&Number(v)>0;
const bad=(m,s=400)=>Object.assign(new Error(m),{status:s});
const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){console.error('[AVN receitas]',e);res.status(e.status||500).json({erro:e.status?e.message:'Falha ao processar receita. Consulte os logs.'});}};
const uid=v=>{if(!id(v))throw bad('Selecione um usuário válido.');return String(v);};
async function usuarioExiste(db,u){if(!(await db.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[u])).rowCount)throw bad('Usuário não encontrado.',404);}
async function montagem(db,u,b){
 const nome=String(b.nome||'').trim();if(!nome||nome.length>180)throw bad('Informe o nome da receita (até 180 caracteres).');
 const preparo=String(b.preparo||'').trim().slice(0,120)||null;
 const rendimento=Number(b.rendimento_g);
 if(!Number.isFinite(rendimento)||rendimento<=0||rendimento>100000)throw bad('Peso final da receita inválido.');
 if(!Array.isArray(b.ingredientes)||!b.ingredientes.length||b.ingredientes.length>60)throw bad('Informe de 1 a 60 ingredientes.');
 const itens=[];let somaPesos=0;
 for(const [ordem,i] of b.ingredientes.entries()){
  if(!id(i.alimento_id))throw bad('Selecione um alimento válido.');
  const g=Number(i.quantidade_g);if(!Number.isFinite(g)||g<=0||g>10000)throw bad('Peso de ingrediente inválido.');
  const r=await db.query(`SELECT * FROM public.avn_alimentos WHERE id=$1 AND ativo AND (usuario_id=$2 OR usuario_id IS NULL) AND fonte<>'receita'`,[i.alimento_id,u]);
  if(!r.rowCount)throw bad('Ingrediente não encontrado ou é outra receita.',400);
  const f=r.rows[0];itens.push({alimento_id:f.id,nome_snapshot:f.nome,quantidade_g:g,ordem,composicao_100g:composicao(f)});somaPesos+=g;
 }
 const {rows:nutrientes}=await db.query('SELECT codigo FROM public.avn_nutrientes');
 const calc=calcular(itens,rendimento,nutrientes.map(n=>n.codigo));return {nome,preparo,rendimento,itens,somaPesos,calc};
}
async function salvar(req,res,editar){
 const u=uid(req.body?.usuarioId),recId=req.params.id;const db=await pool.connect();
 try{await db.query('BEGIN');await usuarioExiste(db,u);
  let antiga=null;if(editar){if(!id(recId))throw bad('Receita inválida.');const r=await db.query('SELECT * FROM public.avn_receitas WHERE id=$1 AND usuario_id=$2 FOR UPDATE',[recId,u]);if(!r.rowCount)throw bad('Receita não encontrada.',404);antiga=r.rows[0];}
  const data=await montagem(db,u,req.body||{});const c=data.calc;
  const v=[data.nome,data.preparo,c.kcal_100g,c.proteinas_g_100g,c.carboidratos_g_100g,c.gorduras_g_100g,c.fibras_g_100g,JSON.stringify(c.micronutrientes_100g)];
  let alimento;
  if(editar){const r=await db.query(`UPDATE public.avn_alimentos SET nome=$1,preparo=$2,kcal_100g=$3,proteinas_g_100g=$4,carboidratos_g_100g=$5,gorduras_g_100g=$6,fibras_g_100g=$7,micronutrientes_100g=$8::jsonb,atualizado_em=NOW() WHERE id=$9 AND usuario_id=$10 RETURNING id`,[...v,antiga.alimento_id,u]);alimento=r.rows[0];}
  else{const r=await db.query(`INSERT INTO public.avn_alimentos(usuario_id,nome,preparo,kcal_100g,proteinas_g_100g,carboidratos_g_100g,gorduras_g_100g,fibras_g_100g,micronutrientes_100g,fonte,fonte_referencia) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'receita','Composição estimada pelos ingredientes') RETURNING id`,[u,...v]);alimento=r.rows[0];}
  let receita;
  if(editar){const r=await db.query('UPDATE public.avn_receitas SET nome=$1,preparo=$2,rendimento_g=$3,atualizado_em=NOW() WHERE id=$4 RETURNING *',[data.nome,data.preparo,data.rendimento,recId]);receita=r.rows[0];await db.query('DELETE FROM public.avn_receita_ingredientes WHERE receita_id=$1',[recId]);}
  else{const r=await db.query('INSERT INTO public.avn_receitas(usuario_id,alimento_id,nome,preparo,rendimento_g) VALUES($1,$2,$3,$4,$5) RETURNING *',[u,alimento.id,data.nome,data.preparo,data.rendimento]);receita=r.rows[0];}
  for(const i of data.itens)await db.query('INSERT INTO public.avn_receita_ingredientes(receita_id,alimento_id,quantidade_g,ordem,composicao_100g,nome_snapshot) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[receita.id,i.alimento_id,i.quantidade_g,i.ordem,JSON.stringify(i.composicao_100g),i.nome_snapshot]);
  await db.query('COMMIT');res.status(editar?200:201).json({receita,alimento_id:alimento.id,composicao_100g:c,soma_ingredientes_g:data.somaPesos});
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
router.get('/',route(async(req,res)=>{const u=uid(req.query.usuarioId);await usuarioExiste(pool,u);const r=await pool.query(`SELECT r.*,a.kcal_100g,a.proteinas_g_100g,a.carboidratos_g_100g,a.gorduras_g_100g,a.fibras_g_100g,a.micronutrientes_100g FROM public.avn_receitas r JOIN public.avn_alimentos a ON a.id=r.alimento_id WHERE r.usuario_id=$1 ORDER BY r.nome,r.id`,[u]);res.json(r.rows);}));
// O catálogo usado pela IA é o mesmo exibido para revisão no formulário.
async function catalogoUsuario(u){
 const r=await pool.query(`SELECT * FROM public.avn_alimentos WHERE ativo
   AND (usuario_id=$1 OR usuario_id IS NULL) AND fonte<>'receita'
   ORDER BY nome,id LIMIT 1200`,[u]);
 return r.rows;
}
router.get('/catalogo',route(async(req,res)=>{
 const u=uid(req.query.usuarioId);await usuarioExiste(pool,u);
 res.set('Cache-Control','no-store').json(await catalogoUsuario(u));
}));
router.post('/interpretar',route(async(req,res)=>{
 const u=uid(req.body?.usuarioId);await usuarioExiste(pool,u);
 const catalogo=await catalogoUsuario(u);
 const dados=await interpretar(req.body?.texto,catalogo);
 res.set('Cache-Control','no-store').json(dados);
}));
router.get('/:id',route(async(req,res)=>{const u=uid(req.query.usuarioId);if(!id(req.params.id))throw bad('Receita inválida.');const r=await pool.query('SELECT * FROM public.avn_receitas WHERE id=$1 AND usuario_id=$2',[req.params.id,u]);if(!r.rowCount)throw bad('Receita não encontrada.',404);const q=await pool.query('SELECT alimento_id,quantidade_g,nome_snapshot,ordem,composicao_100g FROM public.avn_receita_ingredientes WHERE receita_id=$1 ORDER BY ordem,id',[r.rows[0].id]);
 // Fonte única: calcular soma nutricional dos ingredientes salvos; depois normalizar por rendimento.
 const codigos=(await pool.query('SELECT codigo FROM public.avn_nutrientes')).rows.map(n=>n.codigo);
 const c=calcular(q.rows,Number(r.rows[0].rendimento_g),codigos);
 // Disponibilizar os micros positivos observados sem ocultá-los quando
 // um ingrediente não possui informação. O total parcial é identificado.
 const micros=micronutrientesDisponiveis(q.rows,Number(r.rows[0].rendimento_g),codigos);
 res.set('Cache-Control','no-store').json({...r.rows[0],ingredientes:q.rows,totais_ingredientes:c.totais_ingredientes,
  micronutrientes_totais:micros.totais,micronutrientes_parciais:micros.parciais,
  composicao_100g:{
   kcal:c.kcal_100g,proteinas_g:c.proteinas_g_100g,carboidratos_g:c.carboidratos_g_100g,gorduras_g:c.gorduras_g_100g,
   micronutrientes_100g:micros.por100g
  }
 });}));
router.post('/',route((req,res)=>salvar(req,res,false)));
router.put('/:id',route((req,res)=>salvar(req,res,true)));
module.exports=router;
