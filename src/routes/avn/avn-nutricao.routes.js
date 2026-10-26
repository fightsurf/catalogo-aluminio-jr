'use strict';
// Autenticação obrigatória no mount em avn-sistema.routes.js.
const express = require('express');
const pool = require('../../../db/connection');
const consultaUsda = require('../../services/avn/avn-nutricao-usda.service');
const consultaTaco = require('../../services/avn/avn-nutricao-taco.service');
const consultaJsonIA = require('../../services/avn/avn-nutricao-ia-json.service');
const router = express.Router();
router.use('/receitas',require('./avn-receitas.routes'));
const REFEICOES = new Set(['cafe','lanche_manha','almoco','lanche_tarde','jantar','ceia','outros']);
const MACROS = ['kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g'];
// Catálogo de micronutrientes armazenado em public.avn_nutrientes (extensível).
const isId = x => /^\d+$/.test(String(x ?? '')) && Number(x)>0;
const bad=(msg, status=400)=>Object.assign(new Error(msg),{status});
const requiredId=x=>{if(!isId(x))throw bad('Identificador inválido.');return String(x);};
function num(x,max=10000) {
 if(x === null || x === undefined || x === '') return null;
 if(typeof x === 'boolean'||typeof x === 'object'||typeof x === 'string' && !x.trim())throw bad('Número inválido.');
 const n=Number(x);if(!Number.isFinite(n)||n<0||n>max)throw bad('Quantidade fora dos limites.');return n;
}
function grams(x){const n=num(x,10000);if(n===null||n<=0)throw bad('Quantidade deve ser maior que zero.');return n;}
function day(x){
 const s=String(x||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw bad('Data inválida. Use AAAA-MM-DD.');
 const d=new Date(s+'T12:00:00Z');if(Number.isNaN(+d)||d.toISOString().slice(0,10)!==s)throw bad('Data inválida.');
 return s;
}
function weekDay(s){return (new Date(s+'T12:00:00Z').getUTCDay()+6)%7;}
function meal(s){if(!REFEICOES.has(s))throw bad('Refeição inválida.');return s;}
async function micros(v,db=pool){
 if(v===undefined||v===null)return {};
 if(!v||typeof v!=='object'||Array.isArray(v))throw bad('Micronutrientes inválidos.');
 const keys=Object.keys(v);
 if(!keys.length)return {};
 const {rows}=await db.query('SELECT codigo FROM public.avn_nutrientes WHERE codigo=ANY($1::text[])',[keys]);
 const allowed=new Set(rows.map(row=>row.codigo));
 if(keys.some(k=>!allowed.has(k)))throw bad('Micronutriente não cadastrado. Atualize o catálogo antes de salvar.');
 const out={};
 for(const k of keys){const n=num(v[k],1000000);if(n!==null)out[k]=n;}
 return out;
}
function slug(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);}
function normalizarUnidade(s){return String(s||'').trim().replace(/^(ug|mcg|μg)$/i,'µg');}
function nutritionOf(food){return {
  kcal:food.kcal_100g==null?null:Number(food.kcal_100g),
  proteinas_g:food.proteinas_g_100g==null?null:Number(food.proteinas_g_100g),
  carboidratos_g:food.carboidratos_g_100g==null?null:Number(food.carboidratos_g_100g),
  gorduras_g:food.gorduras_g_100g==null?null:Number(food.gorduras_g_100g),
  fibras_g:food.fibras_g_100g==null?null:Number(food.fibras_g_100g),
  micros:food.micronutrientes_100g||{}
};}
async function user(id){requiredId(id);const r=await pool.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[id]);if(!r.rowCount)throw bad('Usuário não encontrado.',404);}
async function food(id, uid, db=pool){requiredId(id);const r=await db.query('SELECT * FROM public.avn_alimentos WHERE id=$1 AND ativo AND (usuario_id IS NULL OR usuario_id=$2)',[id,uid]);if(!r.rowCount)throw bad('Alimento não encontrado.',404);return r.rows[0];}
async function foodPayload(body){
 const nome=String(body.nome||'').trim().slice(0,180);if(!nome)throw bad('Informe o nome do alimento.');
 const marca=String(body.marca||'').trim().slice(0,120)||null;
 const preparo=String(body.preparo||'').trim().slice(0,120)||null;
 const p={nome,marca,preparo};
 p.kcal_100g=num(body.kcal_100g,1000);
 for(const k of ['proteinas_g_100g','carboidratos_g_100g','gorduras_g_100g','fibras_g_100g'])p[k]=num(body[k],100);
 p.micronutrientes_100g=await micros(body.micronutrientes_100g);
 p.porcao_nome=String(body.porcao_nome||'').trim().slice(0,100)||null;
 p.porcao_gramas=body.porcao_gramas===''||body.porcao_gramas==null?null:grams(body.porcao_gramas);
 return p;
}
const A = ['nome','marca','preparo','kcal_100g','proteinas_g_100g','carboidratos_g_100g','gorduras_g_100g','fibras_g_100g','micronutrientes_100g','porcao_nome','porcao_gramas'];
function fail(res,e){console.error('[AVN Nutrição]',e);res.status(e.status|| (e.code==='23503'||e.code==='23505'?409:500)).json({erro:e.status?e.message:e.code==='23503'?'Registro possui vínculos e não pode ser removido.':e.code==='23505'?'Registro duplicado.':'Falha no módulo de nutrição. Consulte os logs.'});}
const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){fail(res,e);}};

// Consulta com IA: a lista de todos os nutrientes vem exclusivamente do PostgreSQL.
// Não recebe dados clínicos/pessoais do usuário; não grava alimentos automaticamente.
router.post('/consulta-ia/gerar-json',wrap(async(req,res)=>{
 const {rows}=await pool.query('SELECT codigo,nome,unidade,categoria FROM public.avn_nutrientes ORDER BY codigo');
 const dados=await consultaJsonIA.gerar(req.body||{},rows);
 res.set('Cache-Control','no-store').json(dados);
}));
router.get('/consulta-ia/buscar',wrap(async(req,res)=>{
 const termo=String(req.query.termo||'').trim();if(termo.length<2||termo.length>180)throw bad('Informe um alimento com 2 a 180 caracteres.');
 const fonte=String(req.query.fonte||'taco');
 if(!['taco','usda'].includes(fonte))throw bad('Fonte não disponível.');
 const out=await (fonte==='taco'?consultaTaco.search(termo):consultaUsda.search(termo));res.set('Cache-Control','no-store').json(out);
}));
router.get('/consulta-ia/detalhar/:fdcId',wrap(async(req,res)=>{
 const id=String(req.params.fdcId||'');if(!/^\d{1,12}$/.test(id))throw bad('Identificador USDA inválido.');
 const r=await pool.query('SELECT codigo,unidade FROM public.avn_nutrientes');
 const out=await consultaUsda.detail(id,r.rows);res.set('Cache-Control','no-store').json(out);
}));
router.get('/consulta-ia/taco/:id',wrap(async(req,res)=>{
 const r=await pool.query('SELECT codigo,unidade FROM public.avn_nutrientes');
 const out=await consultaTaco.detail(req.params.id,r.rows);res.set('Cache-Control','no-store').json(out);
}));
router.get('/nutrientes',wrap(async(_req,res)=>{
 const {rows}=await pool.query("SELECT codigo,nome,unidade,categoria FROM public.avn_nutrientes ORDER BY CASE categoria WHEN 'Vitaminas' THEN 0 WHEN 'Minerais' THEN 1 ELSE 2 END,nome,codigo");
 res.set('Cache-Control','no-store').json({macros:MACROS,micros:rows});
}));
router.get('/alimentos',wrap(async(req,res)=>{
 const id=requiredId(req.query.usuarioId);await user(id);
 const q=String(req.query.busca||'').trim().slice(0,120);
 const r=await pool.query(`SELECT * FROM public.avn_alimentos WHERE ativo AND (usuario_id IS NULL OR usuario_id=$1)
 AND ($2='' OR translate(lower(nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') LIKE '%' || translate(lower($2),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') || '%')
 ORDER BY nome,id LIMIT 300`,[id,q]);res.set('Cache-Control','no-store');res.json(r.rows);
}));
router.post('/alimentos',wrap(async(req,res)=>{
 const uid=requiredId(req.body?.usuarioId);await user(uid);const f=await foodPayload(req.body||{});
 if(req.body?.fonte==='usda_fdc'&&/^https:\/\/fdc\.nal\.usda\.gov\/food-details\/\d+\/nutrients$/.test(req.body.fonte_referencia||'')){f.fonte='usda_fdc';f.fonte_referencia=req.body.fonte_referencia;}
 if(req.body?.fonte==='taco'&&/^https:\/\/brolesi\.github\.io\/taco\/foods\/[1-9]\d{0,2}\.json$/.test(req.body.fonte_referencia||'')){f.fonte='taco';f.fonte_referencia=req.body.fonte_referencia;}
 if(req.body?.fonte==='ia_pesquisa'){
  f.fonte='ia_pesquisa';
  const referencia=String(req.body.fonte_referencia||'');
  if(referencia.length<=240&&/^https:\/\/[^\s]+$/.test(referencia))f.fonte_referencia=referencia;
 }
 const vals=A.map(k=>k==='micronutrientes_100g'?JSON.stringify(f[k]):f[k]);
 const r=await pool.query(`INSERT INTO public.avn_alimentos(usuario_id,${A.join(',')},fonte,fonte_referencia) VALUES ($1,${A.map((_,i)=>'$'+(i+2)).join(',')},$13,$14) RETURNING *`,[uid,...vals,f.fonte||'manual',f.fonte_referencia||null]);res.status(201).json(r.rows[0]);
}));
router.put('/alimentos/:id',wrap(async(req,res)=>{
 const e=await pool.query("SELECT 1 FROM public.avn_receitas WHERE alimento_id=$1",[req.params.id]);if(e.rowCount)throw bad('Edite receitas no aplicativo Receitas, não em Alimentos.');
 const uid=requiredId(req.body?.usuarioId),id=requiredId(req.params.id);await user(uid);const f=await foodPayload(req.body);
 const vals=A.map(k=>k==='micronutrientes_100g'?JSON.stringify(f[k]):f[k]);
 const r=await pool.query(`UPDATE public.avn_alimentos SET ${A.map((k,i)=>k+'=$'+(i+1)).join(',')},atualizado_em=NOW() WHERE id=$${A.length+1} AND usuario_id=$${A.length+2} AND ativo RETURNING *`,[...vals,id,uid]);
 if(!r.rowCount)throw bad('Alimento pessoal não encontrado.',404);res.json(r.rows[0]);
}));
router.delete('/alimentos/:id',wrap(async(req,res)=>{
 const e=await pool.query("SELECT 1 FROM public.avn_receitas WHERE alimento_id=$1",[req.params.id]);if(e.rowCount)throw bad('Receitas não podem ser removidas pelo cadastro de Alimentos.');
 const uid=requiredId(req.query.usuarioId),id=requiredId(req.params.id);await user(uid);
 const r=await pool.query('UPDATE public.avn_alimentos SET ativo=FALSE,atualizado_em=NOW() WHERE id=$1 AND usuario_id=$2 AND ativo RETURNING id',[id,uid]);
 if(!r.rowCount)throw bad('Alimento pessoal não encontrado.',404);res.json({ok:true});
}));
router.get('/metas/:usuarioId',wrap(async(req,res)=>{
 await user(req.params.usuarioId);const r=await pool.query('SELECT * FROM public.avn_metas_nutricionais WHERE usuario_id=$1',[req.params.usuarioId]);res.json(r.rows[0]||{usuario_id:req.params.usuarioId,kcal:null,proteinas_g:null,carboidratos_g:null,gorduras_g:null,fibras_g:null,micros:{}});
}));
router.put('/metas/:usuarioId',wrap(async(req,res)=>{
 await user(req.params.usuarioId);const b=req.body||{},v=MACROS.map(k=>num(b[k],k==='kcal'?12000:1000));
 const m=await micros(b.micros);const r=await pool.query(`INSERT INTO public.avn_metas_nutricionais(usuario_id,kcal,proteinas_g,carboidratos_g,gorduras_g,fibras_g,micros) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
 ON CONFLICT(usuario_id) DO UPDATE SET kcal=EXCLUDED.kcal,proteinas_g=EXCLUDED.proteinas_g,carboidratos_g=EXCLUDED.carboidratos_g,gorduras_g=EXCLUDED.gorduras_g,fibras_g=EXCLUDED.fibras_g,micros=EXCLUDED.micros,atualizado_em=NOW() RETURNING *`,[req.params.usuarioId,...v,JSON.stringify(m)]);res.json(r.rows[0]);
}));
async function activePlan(uid,db=pool){const r=await db.query('SELECT * FROM public.avn_dieta_planos WHERE usuario_id=$1 AND ativo ORDER BY id DESC LIMIT 1',[uid]);return r.rows[0]||null;}
router.get('/dieta/:usuarioId',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);const plan=await activePlan(uid);
 if(!plan)return res.json({plano:null,itens:[]});
 const r=await pool.query(`SELECT i.*,a.nome AS alimento_nome,a.kcal_100g,a.proteinas_g_100g,a.carboidratos_g_100g,a.gorduras_g_100g,a.fibras_g_100g,a.micronutrientes_100g
 FROM public.avn_dieta_itens i JOIN public.avn_alimentos a ON a.id=i.alimento_id WHERE i.plano_id=$1 ORDER BY dia_semana,ordem,i.id`,[plan.id]);
 res.json({plano:plan,itens:r.rows});
}));
router.post('/dieta/:usuarioId/itens',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);
 const {dia_semana,refeicao,alimento_id,quantidade_g}=req.body||{};
 const d=Number(dia_semana);if(!Number.isInteger(d)||d<0||d>6)throw bad('Dia da semana inválido.');meal(refeicao);const q=grams(quantidade_g);await food(alimento_id,uid);
 const client=await pool.connect();try{
  await client.query('BEGIN');let plan=await activePlan(uid,client);
  if(!plan){const p=await client.query(`INSERT INTO public.avn_dieta_planos(usuario_id,nome,ativo) VALUES ($1,'Dieta semanal',TRUE) RETURNING *`,[uid]);plan=p.rows[0];}
  const r=await client.query(`INSERT INTO public.avn_dieta_itens(plano_id,dia_semana,refeicao,alimento_id,quantidade_g,ordem)
 VALUES ($1,$2,$3,$4,$5,COALESCE((SELECT MAX(ordem)+1 FROM public.avn_dieta_itens WHERE plano_id=$1 AND dia_semana=$2),0)) RETURNING *`,[plan.id,d,refeicao,alimento_id,q]);
  await client.query('COMMIT');res.status(201).json(r.rows[0]);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
router.delete('/dieta/:usuarioId/itens/:itemId',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId),iid=requiredId(req.params.itemId);await user(uid);
 const r=await pool.query(`DELETE FROM public.avn_dieta_itens i USING public.avn_dieta_planos p WHERE i.plano_id=p.id AND p.usuario_id=$1 AND p.ativo AND i.id=$2 RETURNING i.id`,[uid,iid]);
 if(!r.rowCount)throw bad('Item da dieta não encontrado.',404);res.json({ok:true});
}));
router.get('/diario/:usuarioId',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);const data=day(req.query.data);
 const r=await pool.query('SELECT * FROM public.avn_diario_alimentar WHERE usuario_id=$1 AND data_consumo=$2 ORDER BY id',[uid,data]);
 res.set('Cache-Control','no-store');res.json({data,itens:r.rows});
}));
router.post('/diario/:usuarioId',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);const b=req.body||{},data=day(b.data),ref=meal(b.refeicao),q=grams(b.quantidade_g);
 const f=await food(b.alimento_id,uid),comp=nutritionOf(f);
 const r=await pool.query(`INSERT INTO public.avn_diario_alimentar(usuario_id,data_consumo,refeicao,alimento_id,alimento_nome,quantidade_g,composicao_100g)
 VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,[uid,data,ref,f.id,f.nome,q,JSON.stringify(comp)]);res.status(201).json(r.rows[0]);
}));
router.delete('/diario/:usuarioId/:id',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId),id=requiredId(req.params.id);await user(uid);
 const r=await pool.query('DELETE FROM public.avn_diario_alimentar WHERE id=$1 AND usuario_id=$2 RETURNING id',[id,uid]);if(!r.rowCount)throw bad('Registro não encontrado.',404);res.json({ok:true});
}));

/* Registra uma refeição específica, com quantidades efetivamente consumidas.
 * A chave única (usuario_id,data_consumo,plano_item_id) impede repetições
 * mesmo com cliques simultâneos. Nenhum registro da dieta é alterado. */
router.post('/diario/:usuarioId/registrar-refeicao',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);
 await user(uid);
 const data=day(req.body?.data),ref=meal(req.body?.refeicao),d=weekDay(data);
 const recebidos=req.body?.itens;
 if(!Array.isArray(recebidos)||!recebidos.length||recebidos.length>60)
  throw bad('Selecione de 1 a 60 alimentos da refeição.');
 const vistos=new Set();
 const itens=recebidos.map(i=>{
  const pid=requiredId(i?.plano_item_id),q=grams(i?.quantidade_g);
  if(vistos.has(pid))throw bad('A refeição contém um alimento planejado duplicado.');
  vistos.add(pid);
  return {pid,q};
 });
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const plano=await activePlan(uid,db);
  if(!plano)throw bad('Não existe uma dieta programada ativa.');
  const {rows}=await db.query(
   `SELECT i.id,i.alimento_id,a.nome AS alimento_nome,
    a.kcal_100g,a.proteinas_g_100g,a.carboidratos_g_100g,
    a.gorduras_g_100g,a.fibras_g_100g,a.micronutrientes_100g
    FROM public.avn_dieta_itens i
    JOIN public.avn_alimentos a ON a.id=i.alimento_id
    WHERE i.plano_id=$1 AND i.dia_semana=$2 AND i.refeicao=$3
      AND a.ativo AND (a.usuario_id IS NULL OR a.usuario_id=$4)
    FOR SHARE OF i,a`,[plano.id,d,ref,uid]);
  const permitidos=new Map(rows.map(row=>[String(row.id),row]));
  if(itens.some(i=>!permitidos.has(i.pid)))
   throw bad('Um dos alimentos não pertence à refeição planejada para esta data. Atualize a página.');
  let inseridos=0;
  for(const item of itens){
   const f=permitidos.get(item.pid);
   const result=await db.query(
    `INSERT INTO public.avn_diario_alimentar
      (usuario_id,data_consumo,refeicao,alimento_id,alimento_nome,quantidade_g,composicao_100g,plano_item_id)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      ON CONFLICT DO NOTHING RETURNING id`,
    [uid,data,ref,f.alimento_id,f.alimento_nome,item.q,JSON.stringify(nutritionOf(f)),item.pid]);
   inseridos+=result.rowCount;
  }
  await db.query('COMMIT');
  res.set('Cache-Control','no-store').json({
   ok:true,data,refeicao:ref,solicitados:itens.length,
   inseridos,ja_registrados:itens.length-inseridos
  });
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
 finally{db.release();}
}));

router.post('/diario/:usuarioId/copiar-dieta',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);const data=day(req.body?.data);const d=weekDay(data);const p=await activePlan(uid);
 if(!p)return res.json({ok:true,inseridos:0,mensagem:'Nenhuma dieta programada.'});
 // INSERT atômico, snapshot da composição; conflito por item/data impede cópia duplicada.
 const r=await pool.query(`INSERT INTO public.avn_diario_alimentar(usuario_id,data_consumo,refeicao,alimento_id,alimento_nome,quantidade_g,composicao_100g,plano_item_id)
 SELECT $1,$2,i.refeicao,a.id,a.nome,i.quantidade_g,
 jsonb_build_object('kcal',a.kcal_100g,'proteinas_g',a.proteinas_g_100g,'carboidratos_g',a.carboidratos_g_100g,'gorduras_g',a.gorduras_g_100g,'fibras_g',a.fibras_g_100g,'micros',a.micronutrientes_100g),i.id
 FROM public.avn_dieta_itens i JOIN public.avn_alimentos a ON a.id=i.alimento_id
 WHERE i.plano_id=$3 AND i.dia_semana=$4 AND a.ativo AND (a.usuario_id=$1 OR a.usuario_id IS NULL)
 ON CONFLICT DO NOTHING RETURNING id`,[uid,data,p.id,d]);res.json({ok:true,inseridos:r.rowCount});
}));
module.exports=router;
