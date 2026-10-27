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
 const uid=requiredId(req.query.usuarioId),id=requiredId(req.params.id);await user(uid);
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  // Bloqueia a linha para impedir inserções simultâneas com FK enquanto verificamos referências.
  const f=await db.query('SELECT id,fonte FROM public.avn_alimentos WHERE id=$1 AND usuario_id=$2 AND ativo FOR UPDATE',[id,uid]);
  if(!f.rowCount)throw bad('Alimento pessoal não encontrado.',404);
  if(f.rows[0].fonte==='receita')throw bad('Receitas devem ser gerenciadas pelo módulo Receitas.',409);
  const usos=await db.query(`SELECT
   EXISTS(SELECT 1 FROM public.avn_diario_alimentar WHERE alimento_id=$1) AS diario,
   EXISTS(SELECT 1 FROM public.avn_dieta_itens WHERE alimento_id=$1) AS dieta,
   EXISTS(SELECT 1 FROM public.avn_receita_ingredientes WHERE alimento_id=$1) AS ingrediente,
   EXISTS(SELECT 1 FROM public.avn_receitas WHERE alimento_id=$1) AS receita`,[id]);
  const u=usos.rows[0];
  if(u.diario||u.dieta||u.ingrediente||u.receita){
   const lugares=[u.diario&&'diário alimentar',u.dieta&&'dieta programada',u.ingrediente&&'ingredientes de receitas',u.receita&&'receitas'].filter(Boolean);
   throw bad('Este alimento já está em uso em: '+lugares.join(', ')+'. Remova os vínculos antes de excluir.',409);
  }
  await db.query('UPDATE public.avn_alimentos SET ativo=FALSE,atualizado_em=NOW() WHERE id=$1 AND usuario_id=$2',[id,uid]);
  await db.query('COMMIT');res.json({ok:true});
 }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}));
router.get('/metas/:usuarioId',wrap(async(req,res)=>{
 await user(req.params.usuarioId);const r=await pool.query('SELECT * FROM public.avn_metas_nutricionais WHERE usuario_id=$1',[req.params.usuarioId]);res.json(r.rows[0]||{usuario_id:req.params.usuarioId,kcal:null,proteinas_g:null,carboidratos_g:null,gorduras_g:null,fibras_g:null,micros:{}});
}));
router.put('/metas/:usuarioId',wrap(async(req,res)=>{
 await user(req.params.usuarioId);const b=req.body||{},v=MACROS.map(k=>num(b[k],k==='kcal'?12000:1000));
 const m=await micros(b.micros);const r=await pool.query(`INSERT INTO public.avn_metas_nutricionais(usuario_id,kcal,proteinas_g,carboidratos_g,gorduras_g,fibras_g,micros) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
 ON CONFLICT(usuario_id) DO UPDATE SET kcal=EXCLUDED.kcal,proteinas_g=EXCLUDED.proteinas_g,carboidratos_g=EXCLUDED.carboidratos_g,gorduras_g=EXCLUDED.gorduras_g,fibras_g=EXCLUDED.fibras_g,micros=EXCLUDED.micros,atualizado_em=NOW() RETURNING *`,[req.params.usuarioId,...v,JSON.stringify(m)]);res.json(r.rows[0]);
}));

/* Sugestão de metas: lê apenas as últimas medidas do usuário autenticado e jamais salva automaticamente. */
router.post('/metas/:usuarioId/sugerir-ia',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);
 const objetivo=String(req.body?.objetivo||''),atividade=String(req.body?.atividade||'');
 if(!['reduzir_gordura','manter','ganhar_massa'].includes(objetivo)||
    !['sedentaria','leve','moderada','alta'].includes(atividade))throw bad('Informe objetivo e nível de atividade.');
 if(!process.env.OPENAI_API_KEY)throw bad('Configure OPENAI_API_KEY para ativar as sugestões de IA.',503);
 const ur=await pool.query(`SELECT id,altura_cm,sexo_referencia_calculo,
  EXTRACT(YEAR FROM AGE(CURRENT_DATE,data_nascimento))::int AS idade
  FROM public.avn_usuario WHERE id=$1`,[uid]);
 const u=ur.rows[0];
 const mr=await pool.query(`SELECT DISTINCT ON (m.codigo) m.codigo,d.valor,d.data_medicao
  FROM public.avn_medicoes d JOIN public.avn_metricas m ON m.id=d.metrica_id
  WHERE d.usuario_id=$1 AND m.codigo=ANY($2::text[])
  ORDER BY m.codigo,d.data_medicao DESC,d.id DESC`,[uid,['peso','gordura_corporal','massa_magra','tmb']]);
 const medidas=Object.fromEntries(mr.rows.map(x=>[x.codigo,{valor:Number(x.valor),data:x.data_medicao}]));
 const peso=medidas.peso?.valor,idade=Number(u.idade),altura=Number(u.altura_cm);
 if(!Number.isFinite(peso)||peso<25||peso>350)throw bad('Registre uma pesagem válida na bioimpedância antes de sugerir metas.');
 const bmrMedido=medidas.tmb?.valor;
 const bmrCalculado=(u.sexo_referencia_calculo==='masculino'?10*peso+6.25*altura-5*idade+5:
    u.sexo_referencia_calculo==='feminino'?10*peso+6.25*altura-5*idade-161:null);
 const basal=(bmrMedido>=600&&bmrMedido<=4000)?bmrMedido:bmrCalculado;
 if(!Number.isFinite(basal)||basal<=0)throw bad('Informe sexo de referência e dados pessoais válidos, ou uma TMB registrada.');
 const fatores={sedentaria:1.2,leve:1.375,moderada:1.55,alta:1.725};
 const multiplicadores={reduzir_gordura:.85,manter:1,ganhar_massa:1.08};
 const kcal=Math.round(basal*fatores[atividade]*multiplicadores[objetivo]);
 const prot=Math.round(peso*(objetivo==='reduzir_gordura'?1.8:objetivo==='ganhar_massa'?1.8:1.6));
 const gord=Math.round(Math.min(peso*.85,kcal*.32/9));
 const carb=Math.round(Math.max(0,(kcal-prot*4-gord*9)/4));
 const fibras=Math.round(Math.max(25,Math.min(40,kcal*.014)));
 const base={kcal,proteinas_g:prot,carboidratos_g:carb,gorduras_g:gord,fibras_g:fibras};
 if(kcal<1000||kcal>6000||carb<25)throw bad('Os dados disponíveis geraram uma estimativa fora de uma faixa segura. Revise as medições.',422);
 const prompt={objetivo,atividade,usuario:{idade,altura_cm:altura,sexo_referencia_calculo:u.sexo_referencia_calculo},
  bioimpedancia:medidas,metas_calculadas:base,tmb_usada:basal};
 const controlador=new AbortController();
 const timer=setTimeout(()=>controlador.abort(),18000);
 let descricao='';
 try{
  const resposta=await fetch('https://api.openai.com/v1/chat/completions',{
   method:'POST',signal:controlador.signal,
   headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({model:process.env.AVN_NUTRICAO_AI_MODEL||'gpt-4o-mini',temperature:0.2,
    response_format:{type:'json_object'},
    messages:[
     {role:'system',content:'Você é um assistente de nutrição. Responda somente JSON com propriedade explicacao (até 450 caracteres). Interprete as últimas medidas corporais e as metas já calculadas. Explique objetivamente o motivo das metas e eventuais limitações dos dados. Não diagnostique, não prescreva tratamentos e não afirme precisão clínica. Escreva em português do Brasil.'},
     {role:'user',content:JSON.stringify(prompt)}
    ]})
  });
  if(!resposta.ok)throw bad('Serviço de IA indisponível no momento.',502);
  const json=await resposta.json();
  const texto=json.choices?.[0]?.message?.content||'';
  descricao=String(JSON.parse(texto).explicacao||'').slice(0,700);
 }catch(e){if(e.status)throw e;throw bad('Não foi possível consultar a IA agora. Tente novamente.',502);}
 finally{clearTimeout(timer);}
 res.set('Cache-Control','no-store').json({
  metas:base,explicacao:descricao||'Estimativa preliminar calculada a partir das medições.',
  origem:'bioimpedancia_e_ia',medicoes:medidas,
  aviso:'Sugestão estimada, não substitui orientação clínica. Nenhuma meta foi alterada automaticamente.'
 });
}));

async function activePlan(uid,db=pool){const r=await db.query('SELECT * FROM public.avn_dieta_planos WHERE usuario_id=$1 AND ativo ORDER BY id DESC LIMIT 1',[uid]);return r.rows[0]||null;}
router.get('/dieta/:usuarioId',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);const plan=await activePlan(uid);
 if(!plan)return res.json({plano:null,itens:[]});
 const r=await pool.query(`SELECT i.*,a.nome AS alimento_nome,a.kcal_100g,a.proteinas_g_100g,a.carboidratos_g_100g,a.gorduras_g_100g,a.fibras_g_100g,a.micronutrientes_100g
 FROM public.avn_dieta_itens i JOIN public.avn_alimentos a ON a.id=i.alimento_id WHERE i.plano_id=$1 AND i.dia_semana=(SELECT MIN(dia_semana) FROM public.avn_dieta_itens WHERE plano_id=$1) ORDER BY ordem,i.id`,[plan.id]);
 res.json({plano:plan,itens:r.rows});
}));
router.post('/dieta/:usuarioId/itens',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId);await user(uid);
 const {refeicao,alimento_id,quantidade_g}=req.body||{};
 meal(refeicao);const q=grams(quantidade_g);await food(alimento_id,uid);
 const client=await pool.connect();try{
  await client.query('BEGIN');let plan=await activePlan(uid,client);
  if(!plan){const p=await client.query(`INSERT INTO public.avn_dieta_planos(usuario_id,nome,ativo) VALUES ($1,'Dieta padrão',TRUE) RETURNING *`,[uid]);plan=p.rows[0];}
  const r=await client.query(`INSERT INTO public.avn_dieta_itens(plano_id,dia_semana,refeicao,alimento_id,quantidade_g,ordem)
 VALUES ($1,(SELECT COALESCE(MIN(dia_semana),0) FROM public.avn_dieta_itens WHERE plano_id=$1),$2,$3,$4,COALESCE((SELECT MAX(ordem)+1 FROM public.avn_dieta_itens WHERE plano_id=$1),0)) RETURNING *`,[plan.id,refeicao,alimento_id,q]);
  await client.query('COMMIT');res.status(201).json(r.rows[0]);
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
/* Insere todos os ingredientes confirmados em uma única transação. */
async function salvarItensDietaLote(req,res){
 const uid=requiredId(req.params.usuarioId);
 await user(uid);
 const body=req.body||{};
 const refeicao=meal(body.refeicao);
 if(!Array.isArray(body.itens)||!body.itens.length||body.itens.length>60)throw bad('Envie de 1 a 60 ingredientes.');
 const ids=[],pesos=[];
 for(const item of body.itens){
  if(!item||typeof item!=='object'||Array.isArray(item))throw bad('Ingrediente inválido.');
  ids.push(requiredId(item.alimento_id));
  pesos.push(grams(item.quantidade_g));
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Nunca aceitar IDs que pertençam exclusivamente a outro usuário.
  const validos=await client.query(`SELECT id FROM public.avn_alimentos
    WHERE ativo AND (usuario_id IS NULL OR usuario_id=$1) AND id=ANY($2::bigint[])`,[uid,ids]);
  const disponiveis=new Set(validos.rows.map(r=>String(r.id)));
  if(ids.some(id=>!disponiveis.has(id)))throw bad('Um ou mais alimentos não estão disponíveis neste cadastro.');
  let plano=await activePlan(uid,client);
  if(!plano){
   const novo=await client.query(`INSERT INTO public.avn_dieta_planos(usuario_id,nome,ativo)
    VALUES ($1,'Dieta padrão',TRUE) RETURNING *`,[uid]);
   plano=novo.rows[0];
  }else{
   await client.query('SELECT id FROM public.avn_dieta_planos WHERE id=$1 FOR UPDATE',[plano.id]);
  }
  const prox=await client.query(`SELECT COALESCE(MAX(ordem)+1,0) AS proxima
    FROM public.avn_dieta_itens WHERE plano_id=$1 AND dia_semana=(SELECT MIN(dia_semana) FROM public.avn_dieta_itens WHERE plano_id=$1)`,[plano.id]);
  const insercao=await client.query(`INSERT INTO public.avn_dieta_itens
    (plano_id,dia_semana,refeicao,alimento_id,quantidade_g,ordem)
    SELECT $1,(SELECT COALESCE(MIN(dia_semana),0) FROM public.avn_dieta_itens WHERE plano_id=$1),$2,i.alimento_id,i.quantidade_g,$5::integer + i.posicao::integer - 1
    FROM unnest($4::bigint[],$5::numeric[]) WITH ORDINALITY AS i(alimento_id,quantidade_g,posicao)
    ORDER BY i.posicao RETURNING id`,[plano.id,refeicao,ids,pesos,Number(prox.rows[0].proxima)]);
  await client.query('COMMIT');
  res.status(201).json({ok:true,inseridos:insercao.rowCount});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
router.post('/dieta/:usuarioId/itens/lote',wrap(salvarItensDietaLote));
// Edita somente o item programado: não altera os nutrientes do cadastro nem o diário alimentar.
router.put('/dieta/:usuarioId/itens/:itemId',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId),iid=requiredId(req.params.itemId);
 await user(uid);
 const {refeicao,alimento_id,quantidade_g}=req.body||{};
 const ref=meal(refeicao),q=grams(quantidade_g),f=await food(alimento_id,uid);
 const updated=await pool.query(`UPDATE public.avn_dieta_itens i
 SET refeicao=$3,alimento_id=$4,quantidade_g=$5
 FROM public.avn_dieta_planos p
 WHERE i.plano_id=p.id AND p.usuario_id=$1 AND p.ativo AND i.id=$2
 RETURNING i.id,i.refeicao,i.alimento_id,i.quantidade_g`,[uid,iid,ref,f.id,q]);
 if(!updated.rowCount)throw bad('Item da dieta não encontrado.',404);
 res.json({ok:true,item:updated.rows[0]});
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
// Corrige o consumo real, preservando a composição histórica e a dieta programada.
router.put('/diario/:usuarioId/:id',wrap(async(req,res)=>{
 const uid=requiredId(req.params.usuarioId),id=requiredId(req.params.id);await user(uid);
 const q=grams(req.body?.quantidade_g);
 const r=await pool.query('UPDATE public.avn_diario_alimentar SET quantidade_g=$3 WHERE id=$1 AND usuario_id=$2 RETURNING *',[id,uid,q]);
 if(!r.rowCount)throw bad('Registro não encontrado.',404);
 res.json(r.rows[0]);
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
 const data=day(req.body?.data),ref=meal(req.body?.refeicao);
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
    WHERE i.plano_id=$1 AND i.dia_semana=(SELECT MIN(dia_semana) FROM public.avn_dieta_itens WHERE plano_id=$1) AND i.refeicao=$2
      AND a.ativo AND (a.usuario_id IS NULL OR a.usuario_id=$3)
    FOR SHARE OF i,a`,[plano.id,ref,uid]);
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
 const uid=requiredId(req.params.usuarioId);await user(uid);const data=day(req.body?.data);const p=await activePlan(uid);
 if(!p)return res.json({ok:true,inseridos:0,mensagem:'Nenhuma dieta programada.'});
 // INSERT atômico, snapshot da composição; conflito por item/data impede cópia duplicada.
 const r=await pool.query(`INSERT INTO public.avn_diario_alimentar(usuario_id,data_consumo,refeicao,alimento_id,alimento_nome,quantidade_g,composicao_100g,plano_item_id)
 SELECT $1,$2,i.refeicao,a.id,a.nome,i.quantidade_g,
 jsonb_build_object('kcal',a.kcal_100g,'proteinas_g',a.proteinas_g_100g,'carboidratos_g',a.carboidratos_g_100g,'gorduras_g',a.gorduras_g_100g,'fibras_g',a.fibras_g_100g,'micros',a.micronutrientes_100g),i.id
 FROM public.avn_dieta_itens i JOIN public.avn_alimentos a ON a.id=i.alimento_id
 WHERE i.plano_id=$3 AND i.dia_semana=(SELECT MIN(dia_semana) FROM public.avn_dieta_itens WHERE plano_id=$3) AND a.ativo AND (a.usuario_id=$1 OR a.usuario_id IS NULL)
 ON CONFLICT DO NOTHING RETURNING id`,[uid,data,p.id]);res.json({ok:true,inseridos:r.rowCount});
}));
module.exports=router;
