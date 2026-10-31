'use strict';
const express = require('express');
const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const V = require('../../services/avn/avn-treinos-validacao');
const ensureCarga=require('../../services/avn/avn-treinos-carga.service');
const router=express.Router();
const catalogo = require('../../services/avn/avn-treinos-catalogo.service');
const compat = require('../../services/avn/avn-treinos-equipamentos.service');
router.use('/config',require('./avn-treino-config.routes'));
router.use('/mobile',require('./avn-treino-mobile.routes').admin);
const grupos=async()=> (await pool.query('SELECT id,slug,nome,ordem FROM public.avn_exercicio_grupos ORDER BY ordem,nome')).rows;
const listaSQL=`SELECT e.id,e.slug,e.nome,e.grupo_id,g.nome AS grupo,e.equipamento,e.instrucoes,e.midia_url,e.midia_tipo,e.ativo
  FROM public.avn_exercicios e JOIN public.avn_exercicio_grupos g ON g.id=e.grupo_id`;
const handle=(res,e)=>{console.error('[AVN treinos]',e);return res.status(e.status|| (e.code==='23503'?409:e.code==='23505'?409:500)).json({erro:e.status?e.message:e.code==='23503'?'Registro vinculado a outros dados.':e.code==='23505'?'Registro duplicado.':'Falha ao processar. Confira a migração AVN.'});};
const route=(fn)=>async(req,res)=>{try{await fn(req,res);}catch(e){handle(res,e);}};

async function contextoNutricionalAVN(usuario){
 const [metas,plano,previsto,consumido]=await Promise.all([
  pool.query('SELECT kcal,proteinas_g,carboidratos_g,gorduras_g,fibras_g,atualizado_em FROM public.avn_metas_nutricionais WHERE usuario_id=$1',[usuario]),
  pool.query('SELECT id,nome,atualizado_em FROM public.avn_dieta_planos WHERE usuario_id=$1 AND ativo=TRUE ORDER BY atualizado_em DESC LIMIT 1',[usuario]),
  pool.query(`SELECT COUNT(*)::int AS itens,
    ROUND(SUM(i.quantidade_g*COALESCE(a.kcal_100g,0)/100),1) AS kcal,
    ROUND(SUM(i.quantidade_g*COALESCE(a.proteinas_g_100g,0)/100),1) AS proteinas_g,
    ROUND(SUM(i.quantidade_g*COALESCE(a.carboidratos_g_100g,0)/100),1) AS carboidratos_g,
    ROUND(SUM(i.quantidade_g*COALESCE(a.gorduras_g_100g,0)/100),1) AS gorduras_g,
    ROUND(SUM(i.quantidade_g*COALESCE(a.fibras_g_100g,0)/100),1) AS fibras_g
    FROM public.avn_dieta_itens i JOIN public.avn_dieta_planos p ON p.id=i.plano_id
    JOIN public.avn_alimentos a ON a.id=i.alimento_id
    JOIN public.avn_dieta_refeicao_perfis pf ON pf.id=i.perfil_id AND pf.ativo=TRUE
    WHERE p.usuario_id=$1 AND p.ativo=TRUE AND i.dia_semana=
      (SELECT MIN(di.dia_semana) FROM public.avn_dieta_itens di WHERE di.plano_id=p.id)`,[usuario]),
  pool.query(`SELECT data_consumo,COUNT(*)::int AS itens,
    ROUND(SUM(quantidade_g*COALESCE(NULLIF(composicao_100g->>'kcal','')::numeric,0)/100),1) AS kcal,
    ROUND(SUM(quantidade_g*COALESCE(NULLIF(composicao_100g->>'proteinas_g','')::numeric,0)/100),1) AS proteinas_g,
    ROUND(SUM(quantidade_g*COALESCE(NULLIF(composicao_100g->>'carboidratos_g','')::numeric,0)/100),1) AS carboidratos_g,
    ROUND(SUM(quantidade_g*COALESCE(NULLIF(composicao_100g->>'gorduras_g','')::numeric,0)/100),1) AS gorduras_g
    FROM public.avn_diario_alimentar WHERE usuario_id=$1 AND data_consumo >= CURRENT_DATE-INTERVAL '14 days'
    GROUP BY data_consumo ORDER BY data_consumo DESC LIMIT 14`,[usuario])
 ]);
 return {metas:metas.rows[0]||null,dieta_ativa:plano.rows[0]||null,dieta_programada:previsto.rows[0]?.itens?previsto.rows[0]:null,consumo_real_recente:consumido.rows};
}

// Sugestão por IA: usa apenas medições existentes do usuário e exercícios ativos do catálogo.
router.post('/ia/sugerir',route(async(req,res)=>{
 const usuario=String(req.body?.usuario_id||'');
 if(!V.id(usuario))throw V.erro('Selecione um usuário válido.',400);
 const ok=await pool.query('SELECT id FROM public.avn_usuario WHERE id=$1',[usuario]);
 if(!ok.rowCount)throw V.erro('Usuário não encontrado.',404);
 const key=process.env.OPENAI_API_KEY;
 if(!key)throw V.erro('Configure OPENAI_API_KEY no Render para usar a IA.',503);
 const medicoes=(await pool.query(`SELECT DISTINCT ON (m.codigo) m.codigo,x.valor,x.data_medicao,x.origem,x.qualidade
  FROM public.avn_medicoes x JOIN public.avn_metricas m ON m.id=x.metrica_id
  WHERE x.usuario_id=$1 ORDER BY m.codigo,x.data_medicao DESC,x.id DESC`,[usuario])).rows;
 const atividades=(await pool.query(`SELECT inicio,tipo_atividade,calorias_kcal FROM public.avn_atividades
  WHERE usuario_id=$1 AND inicio>=NOW()-INTERVAL '30 days' ORDER BY inicio DESC LIMIT 60`,[usuario])).rows;
 const nutricao=await contextoNutricionalAVN(usuario);
 const perfilResult=await pool.query('SELECT nivel,anos_experiencia,regularidade,dias_semana,duracao_min,objetivo,limitacoes,preferencias,atualizado_em FROM public.avn_treino_perfil WHERE usuario_id=$1',[usuario]);
 const perfil=perfilResult.rows[0];
 if(!perfil||perfil.nivel==='nao_informado'||perfil.regularidade==='nao_informada'||perfil.objetivo==='nao_informado'||!perfil.dias_semana||!perfil.duracao_min)throw V.erro('Preencha o Perfil de Treinamento (experiência, regularidade, objetivo, dias e duração) antes de usar a IA.',409);
 const inventario=await compat.dadosCompatibilidade(usuario);
 if(!inventario.selecionados.length)throw V.erro('Cadastre os equipamentos disponíveis em Minha Academia antes de gerar o treino.',409);
 const disponiveis=inventario.exercicios.filter(e=>e.compativel).map(e=>({id:e.id,nome:e.nome,grupo:e.grupo,equipamento:e.equipamento}));
 if(!disponiveis.length)throw V.erro('Nenhum exercício compatível. Revise os equipamentos da academia e classifique os exercícios ainda pendentes.',409);
 const diagnostico={equipamentos_selecionados:inventario.selecionados.length,exercicios_compativeis:disponiveis.length,exercicios_pendentes:inventario.exercicios.filter(e=>e.modo==='pendente').length};
 const schema={type:'object',additionalProperties:false,required:['avaliacao','programa'],properties:{
  avaliacao:{type:'object',additionalProperties:false,required:['resumo','limitacoes'],properties:{resumo:{type:'string'},limitacoes:{type:'string'}}},
  programa:{type:'object',additionalProperties:false,required:['nome','descricao','dias'],properties:{nome:{type:'string'},descricao:{type:'string'},dias:{type:'array',items:{type:'object',additionalProperties:false,required:['dia_semana','objetivo','exercicios'],properties:{dia_semana:{type:'integer'},objetivo:{type:'string'},exercicios:{type:'array',items:{type:'object',additionalProperties:false,required:['exercicio_id','series','repeticoes','descanso_seg','observacoes'],properties:{exercicio_id:{type:'integer'},series:{type:'integer'},repeticoes:{type:'string'},descanso_seg:{type:'integer'},observacoes:{type:'string'}}}}}}}}}
 }};
 const resposta=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(55000),body:JSON.stringify({model:process.env.AVN_TREINO_IA_MODEL||'gpt-4.1-mini',store:false,max_output_tokens:7500,text:{format:{type:'json_schema',name:'avn_programa_treino',strict:true,schema}},instructions:'Você é assistente de planejamento físico. Redija em português brasileiro, com avaliação factual, respeitosa e sincera, nunca como diagnóstico médico. Diga quando não houver dados suficientes e quando os dados forem antigos. Peso, IMC e bioimpedância não revelam lesões, capacidade cardiovascular, treino prévio ou contraindicações. Não suponha que há sono medido se não houver. Diferencie EXPRESSAMENTE a experiência técnica (perfil declarado) da composição corporal (bioimpedância): gordura corporal elevada NÃO determina iniciante e experiência avançada não comprova capacidade atual. Respeite o nível informado, a regularidade recente, objetivos, duração e dias disponíveis; se retornando de pausa ou existirem limitações, adapte carga de trabalho sem desconsiderar experiência. Relate fatos com datas e origens, hipóteses e informações ausentes; não diagnostique. Use progressão individualizada por esforço percebido (RPE/RIR) sem inventar cargas e sem assumir máquinas não cadastradas. A lista de exercícios já foi filtrada pelo servidor segundo o inventário; não sugira itens ausentes. Intercale estímulos e recuperação. Sem prescrição de cargas específicas. 7 dias únicos de 0 a 6; distribua NO MÁXIMO a quantidade de dias de treino disponível no perfil e deixe os demais para recuperação, inclusive quando a experiência for avançada. Para experiência avançada E treinamento regular, não prescreva automaticamente um plano de iniciante: escolha divisão e volume apropriados à experiência declarada, usando progressão e recuperação. Inclua recuperação. Utilize APENAS IDs de exercícios listados. Máximo 7 exercícios por dia, 1 a 5 séries por exercício, 0 a 3600 segundos de descanso. Descreva risco de overtraining com cautela. Considere as metas nutricionais, dieta programada e consumo real recente para ponderar recuperação e disponibilidade energética. Diferencie dieta planejada de ingestão real e sinalize dados ausentes ou insuficientes. Nenhum dado armazenado será alterado por sua resposta.',input:JSON.stringify({perfil_treinamento:perfil,medicoes,atividades,nutricao,equipamentos_cadastrados:inventario.equipamentos.filter(e=>inventario.selecionados.includes(Number(e.id))).map(e=>e.nome),diagnostico_equipamentos:diagnostico,exercicios_disponiveis:disponiveis})})});
 if(!resposta.ok)throw V.erro('Serviço de IA indisponível ou sem saldo ('+resposta.status+').',502);
 const dados=await resposta.json();const raw=(dados.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 let parsed;try{parsed=JSON.parse(raw);}catch{throw V.erro('Resposta inválida da IA.',502);}
 const p=parsed.programa,ids=new Set(disponiveis.map(x=>Number(x.id)));
 const diasAtivos=Array.isArray(p?.dias)?p.dias.filter(d=>Array.isArray(d.exercicios)&&d.exercicios.length>0).length:0;
 if(!p||!Array.isArray(p.dias)||diasAtivos<1||diasAtivos>perfil.dias_semana||p.dias.length!==7||new Set(p.dias.map(d=>d.dia_semana)).size!==7||p.dias.some(d=>!Number.isInteger(d.dia_semana)||d.dia_semana<0||d.dia_semana>6||!Array.isArray(d.exercicios)||d.exercicios.length>7||d.exercicios.some(e=>!ids.has(e.exercicio_id)||!Number.isInteger(e.series)||e.series<1||e.series>5||!Number.isInteger(e.descanso_seg)||e.descanso_seg<0||e.descanso_seg>3600)))throw V.erro('A IA retornou um treino inconsistente. Gere novamente.',502);
 res.set('Cache-Control','no-store').json({avaliacao:parsed.avaliacao,programa:p,dados:medicoes,perfil,nutricao,diagnostico_equipamentos:diagnostico});
}));

async function avaliarTreinoIA(req,res){
 const usuario=String(req.body?.usuario_id||'');
 if(!V.id(usuario))throw V.erro('Usuário inválido.',400);
 const plano=V.plano(req.body?.plano||{});
 if(String(plano.usuario_id)!==usuario)throw V.erro('Usuário do plano incompatível.',403);
 const key=process.env.OPENAI_API_KEY;
 if(!key)throw V.erro('Configure OPENAI_API_KEY no Render.',503);
 const [check,medicoesResult,atividadesResult,perfilResult,nutricao,inventario]=await Promise.all([
  pool.query('SELECT id FROM public.avn_usuario WHERE id=$1',[usuario]),
  pool.query(`SELECT DISTINCT ON(m.codigo) m.codigo,x.valor,x.data_medicao,x.origem FROM public.avn_medicoes x JOIN public.avn_metricas m ON m.id=x.metrica_id WHERE x.usuario_id=$1 ORDER BY m.codigo,x.data_medicao DESC,x.id DESC`,[usuario]),
  pool.query("SELECT inicio,tipo_atividade,calorias_kcal FROM public.avn_atividades WHERE usuario_id=$1 AND inicio>=NOW()-INTERVAL '30 days' ORDER BY inicio DESC LIMIT 40",[usuario]),
  pool.query('SELECT nivel,anos_experiencia,regularidade,dias_semana,duracao_min,objetivo,limitacoes,preferencias FROM public.avn_treino_perfil WHERE usuario_id=$1',[usuario]),
  contextoNutricionalAVN(usuario),compat.dadosCompatibilidade(usuario)
 ]);
 if(!check.rowCount)throw V.erro('Usuário não encontrado.',404);
 const disponiveis=inventario.exercicios.filter(e=>e.compativel).map(e=>({id:Number(e.id),nome:e.nome,grupo:e.grupo,equipamento:e.equipamento}));
 const recomendacoes={type:'object',additionalProperties:false,required:['veredito','analise','nutricao_e_recuperacao','pontos_criticos','sugestoes'],properties:{
  veredito:{type:'string',enum:['ruim','regular','bom','excelente']},
  analise:{type:'string'},nutricao_e_recuperacao:{type:'string'},
  pontos_criticos:{type:'array',items:{type:'string'}},
  sugestoes:{type:'array',items:{type:'object',additionalProperties:false,required:['acao','dia_semana','posicao','exercicio_id','series','repeticoes','descanso_seg','descricao','justificativa'],properties:{
    acao:{type:'string',enum:['adicionar','remover','trocar','ajustar']},dia_semana:{type:'integer'},posicao:{type:'integer'},
    exercicio_id:{type:['integer','null']},series:{type:['integer','null']},repeticoes:{type:['string','null']},descanso_seg:{type:['integer','null']},
    descricao:{type:'string'},justificativa:{type:'string'}
  }}}
 }};
 const resposta=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(55000),body:JSON.stringify({
   model:process.env.AVN_TREINO_IA_MODEL||'gpt-4.1-mini',store:false,max_output_tokens:6000,
   text:{format:{type:'json_schema',name:'avn_critica_treino',strict:true,schema:recomendacoes}},
   instructions:'Seja revisor técnico rigoroso, em português brasileiro. Julgue o treino aberto sem elogios automáticos. Avalie divisão semanal, frequência por músculo, volume, grupos combinados, redundâncias, ordem, descanso, recuperação, objetivo e capacidade funcional. Combinar músculos diferentes NÃO é por si só um erro. Relacione perfil de treinamento, bioimpedância, atividades e nutrição; não confunda dieta planejada com consumo realizado, nem bioimpedância com nível técnico. Reconheça dados ausentes e antigos. Não faça diagnósticos. Faça sugestões concretas por dia com posições de índice zero. Para adicionar/trocar use exclusivamente IDs disponíveis; sugira apenas equipamentos cadastrados. Para ajuste de séries/repetições/descanso sugira valores dentro de limites. Não invente cargas específicas. Seja criterioso, no máximo 12 sugestões prioritárias. Não faça alterações na base de dados. Se treino é bom, não crie sugestões desnecessárias.',
   input:JSON.stringify({plano:{nome:plano.nome,descricao:plano.descricao,dias:plano.dias},perfil:perfilResult.rows[0]||null,medicoes:medicoesResult.rows,atividades:atividadesResult.rows,nutricao,exercicios_disponiveis:disponiveis})
 })});
 if(!resposta.ok)throw V.erro('IA indisponível ('+resposta.status+').',502);
 const raw=(await resposta.json()).output?.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('')||'';
 let parsed;try{parsed=JSON.parse(raw)}catch{throw V.erro('Resposta da IA inválida.',502);}
 const ids=new Set(disponiveis.map(e=>e.id));
 const dicas=(parsed.sugestoes||[]).filter(s=>['adicionar','remover','trocar','ajustar'].includes(s.acao)&&Number.isInteger(s.dia_semana)&&s.dia_semana>=0&&s.dia_semana<7&&Number.isInteger(s.posicao)&&s.posicao>=0&&s.posicao<=50&&(!['adicionar','trocar'].includes(s.acao)||ids.has(s.exercicio_id))&&(s.series==null||(Number.isInteger(s.series)&&s.series>=1&&s.series<=30))&&(s.descanso_seg==null||(Number.isInteger(s.descanso_seg)&&s.descanso_seg>=0&&s.descanso_seg<=3600))).slice(0,12);
 res.set('Cache-Control','no-store').json({...parsed,sugestoes:dicas,nutricao});
}
router.post('/ia/avaliar',route(avaliarTreinoIA));

router.post('/catalogo/sincronizar',route(async(_req,res)=>res.json(await catalogo.importarCatalogo())));
router.get('/grupos',route(async(_req,res)=>res.json(await grupos())));
router.get('/exercicios',route(async(req,res)=>{
  const busca=V.texto(req.query.busca,120),grupo=String(req.query.grupo||'');
  const params=[busca,grupo];
  const r=await pool.query(`${listaSQL}
    WHERE e.ativo=TRUE AND ($1='' OR translate(lower(e.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') LIKE '%'||translate(lower($1),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc')||'%')
    AND ($2='' OR g.slug=$2) ORDER BY g.ordem,e.nome LIMIT 500`,params);
  res.set('Cache-Control','no-store').json(r.rows.map(row=>({...row,midia_url:catalogo.normalizarMidia(row.midia_url)})));
}));
router.post('/exercicios',route(async(req,res)=>{
  const v=V.exercicio(req.body||{});
  // Criado manualmente: slug reservado evita colisão com o catálogo inicial.
  const r=await pool.query(`INSERT INTO public.avn_exercicios(slug,nome,grupo_id,equipamento,instrucoes,midia_url,midia_tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,['custom-'+crypto.randomUUID(),v.nome,v.grupo_id,v.equipamento,v.instrucoes,v.midia_url,v.midia_tipo]);
  res.status(201).json({ok:true,id:r.rows[0].id});
}));
router.put('/exercicios/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Exercício inválido.');const v=V.exercicio(req.body||{});
  const r=await pool.query(`UPDATE public.avn_exercicios SET nome=$2,grupo_id=$3,equipamento=$4,instrucoes=$5,midia_url=$6,midia_tipo=$7,atualizado_em=NOW() WHERE id=$1 RETURNING id`,[req.params.id,v.nome,v.grupo_id,v.equipamento,v.instrucoes,v.midia_url,v.midia_tipo]);
  if(!r.rowCount)throw V.erro('Exercício não encontrado.',404);res.json({ok:true,id:r.rows[0].id});
}));
router.delete('/exercicios/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Exercício inválido.');
  const r=await pool.query('UPDATE public.avn_exercicios SET ativo=FALSE,atualizado_em=NOW() WHERE id=$1 RETURNING id',[req.params.id]);
  if(!r.rowCount)throw V.erro('Exercício não encontrado.',404);res.json({ok:true});
}));
router.get('/planos',route(async(req,res)=>{
  if(!V.id(req.query.usuario_id))throw V.erro('Selecione um usuário.');
  const r=await pool.query(`SELECT id,usuario_id,nome,descricao,criado_em,atualizado_em FROM public.avn_planos_treino WHERE usuario_id=$1 AND ativo=TRUE ORDER BY atualizado_em DESC LIMIT 100`,[req.query.usuario_id]);
  res.json(r.rows);
}));
async function consultarPlano(id,client=pool){
 await ensureCarga();
  const r=await client.query('SELECT id,usuario_id,nome,descricao,criado_em,atualizado_em FROM public.avn_planos_treino WHERE id=$1 AND ativo=TRUE',[id]);
  if(!r.rowCount)throw V.erro('Plano não encontrado.',404);
  const d=await client.query(`SELECT d.id,d.dia_semana,i.exercicio_id,i.posicao,i.series,i.repeticoes,i.carga_kg,i.carga_unidade,i.carga_placas,i.descanso_seg,i.observacoes,e.nome AS exercicio_nome,e.midia_url,e.midia_tipo
    FROM public.avn_plano_dias d LEFT JOIN public.avn_plano_itens i ON i.plano_dia_id=d.id
    LEFT JOIN public.avn_exercicios e ON e.id=i.exercicio_id WHERE d.plano_id=$1 ORDER BY d.dia_semana,i.posicao`,[id]);
  const days=new Map();for(const row of d.rows){if(!days.has(row.dia_semana))days.set(row.dia_semana,{dia_semana:row.dia_semana,exercicios:[]});if(row.exercicio_id!==null)days.get(row.dia_semana).exercicios.push({...row,midia_url:catalogo.normalizarMidia(row.midia_url)});}
  return {...r.rows[0],dias:[...days.values()]};
}
router.get('/planos/:id',route(async(req,res)=>{if(!V.id(req.params.id))throw V.erro('Plano inválido.');res.json(await consultarPlano(req.params.id));}));
async function salvarPlano(req,res,atualizar=false){
 await ensureCarga();
  const v=V.plano(req.body||{});
  if(atualizar&&!V.id(req.params.id))throw V.erro('Plano inválido.');
  const client=await pool.connect();let committed=false;
  try{
    await client.query('BEGIN');
    const u=await client.query('SELECT 1 FROM public.avn_usuario WHERE id=$1 FOR KEY SHARE',[v.usuario_id]);
    if(!u.rowCount)throw V.erro('Usuário inexistente.',404);
    const ids=[...new Set(v.dias.flatMap(d=>d.itens.map(i=>i.exercicio_id)))];
    if(ids.length){const e=await client.query('SELECT id FROM public.avn_exercicios WHERE id = ANY($1::bigint[]) AND ativo=TRUE',[ids]);if(e.rowCount!==ids.length)throw V.erro('Há exercícios inexistentes ou desativados.');}
    let planoId;
    if(atualizar){
      const r=await client.query('UPDATE public.avn_planos_treino SET nome=$2,descricao=$3,atualizado_em=NOW() WHERE id=$1 AND usuario_id=$4 AND ativo=TRUE RETURNING id',[req.params.id,v.nome,v.descricao,v.usuario_id]);
      if(!r.rowCount)throw V.erro('Plano não encontrado para este usuário.',404);
      planoId=r.rows[0].id;
      await client.query('DELETE FROM public.avn_plano_dias WHERE plano_id=$1',[planoId]);
    }else{
      const r=await client.query('INSERT INTO public.avn_planos_treino(usuario_id,nome,descricao) VALUES($1,$2,$3) RETURNING id',[v.usuario_id,v.nome,v.descricao]);planoId=r.rows[0].id;
    }
    for(const d of v.dias){
      const created=await client.query('INSERT INTO public.avn_plano_dias(plano_id,dia_semana) VALUES($1,$2) RETURNING id',[planoId,d.dia_semana]);
      const diaId=created.rows[0].id;
      for(const i of d.itens){await client.query(`INSERT INTO public.avn_plano_itens(plano_dia_id,exercicio_id,posicao,series,repeticoes,carga_kg,carga_unidade,carga_placas,descanso_seg,observacoes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[diaId,i.exercicio_id,i.posicao,i.series,i.repeticoes,i.carga_kg,i.carga_unidade,i.carga_placas,i.descanso_seg,i.observacoes]);}
    }
    await client.query('COMMIT');committed=true;res.status(atualizar?200:201).json({ok:true,id:planoId});
  }catch(e){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
router.post('/planos',route((req,res)=>salvarPlano(req,res,false)));
router.put('/planos/:id',route((req,res)=>salvarPlano(req,res,true)));
router.delete('/planos/:id',route(async(req,res)=>{
  if(!V.id(req.params.id))throw V.erro('Plano inválido.');
  const usuario=req.body?.usuario_id;if(!V.id(usuario))throw V.erro('Usuário inválido.',400);
  const r=await pool.query('UPDATE public.avn_planos_treino SET ativo=FALSE,atualizado_em=NOW() WHERE id=$1 AND usuario_id=$2 AND ativo=TRUE RETURNING id',[req.params.id,usuario]);
  if(!r.rowCount)throw V.erro('Plano não encontrado.',404);res.json({ok:true});
}));
router.get('/sessoes',route(async(req,res)=>{
  if(!V.id(req.query.usuario_id))throw V.erro('Selecione um usuário.');
  const r=await pool.query(`SELECT s.id,s.plano_id,p.nome AS plano_nome,s.dia_semana,s.realizado_em,s.observacoes,
    (SELECT COUNT(*)::int FROM public.avn_treino_sessao_itens i WHERE i.sessao_id=s.id) AS total_exercicios
    FROM public.avn_treino_sessoes s JOIN public.avn_planos_treino p ON p.id=s.plano_id
    WHERE s.usuario_id=$1 ORDER BY s.realizado_em DESC LIMIT 100`,[req.query.usuario_id]);res.json(r.rows);
}));
router.get('/sessoes/:id',route(async(req,res)=>{
 await ensureCarga();
  if(!V.id(req.params.id))throw V.erro('Sessão inválida.');
  const r=await pool.query(`SELECT s.id,s.usuario_id,s.plano_id,s.dia_semana,s.realizado_em,s.observacoes,p.nome AS plano_nome
    FROM public.avn_treino_sessoes s JOIN public.avn_planos_treino p ON p.id=s.plano_id WHERE s.id=$1`,[req.params.id]);
  if(!r.rowCount)throw V.erro('Sessão não encontrada.',404);
  const i=await pool.query(`SELECT e.nome,i.series_realizadas,i.repeticoes_realizadas,i.carga_kg,i.carga_unidade,i.carga_placas,i.observacoes
    FROM public.avn_treino_sessao_itens i JOIN public.avn_exercicios e ON e.id=i.exercicio_id
    WHERE i.sessao_id=$1 ORDER BY i.posicao`,[req.params.id]);
  res.json({...r.rows[0],exercicios:i.rows});
}));
router.delete('/sessoes/:id',route(async(req,res)=>{
 if(!V.id(req.params.id)||!V.id(req.body?.usuario_id))throw V.erro('Identificadores inválidos.',400);
 const client=await pool.connect();
 try{await client.query('BEGIN');
  const r=await client.query('DELETE FROM public.avn_treino_sessoes WHERE id=$1 AND usuario_id=$2 RETURNING id',[req.params.id,req.body.usuario_id]);
  if(!r.rowCount)throw V.erro('Treino registrado não encontrado.',404);
  await client.query('COMMIT');res.json({ok:true});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
router.post('/sessoes',route(async(req,res)=>{
 await ensureCarga();
  const v=V.sessao(req.body||{});if(!v.realizados.length)throw V.erro('Informe ao menos um exercício realizado.');
  const client=await pool.connect();let committed=false;
  try{
    await client.query('BEGIN');
    const p=await client.query('SELECT usuario_id FROM public.avn_planos_treino WHERE id=$1 FOR KEY SHARE',[v.plano_id]);
    if(!p.rowCount||Number(p.rows[0].usuario_id)!==v.usuario_id)throw V.erro('Plano não pertence ao usuário.',403);
    const r=await client.query(`SELECT i.exercicio_id FROM public.avn_plano_itens i JOIN public.avn_plano_dias d ON d.id=i.plano_dia_id WHERE d.plano_id=$1 AND d.dia_semana=$2`,[v.plano_id,v.dia_semana]);
    const validos=new Set(r.rows.map(x=>String(x.exercicio_id)));
    if(v.realizados.some(x=>!validos.has(String(x.exercicio_id))))throw V.erro('Há exercícios que não pertencem a este dia do plano.');
    const sessao=await client.query('INSERT INTO public.avn_treino_sessoes(usuario_id,plano_id,dia_semana,observacoes) VALUES($1,$2,$3,$4) RETURNING id',[v.usuario_id,v.plano_id,v.dia_semana,v.observacoes]);
    const sessaoId=sessao.rows[0].id;
    for(const x of v.realizados)await client.query(`INSERT INTO public.avn_treino_sessao_itens(sessao_id,exercicio_id,posicao,series_realizadas,repeticoes_realizadas,carga_kg,carga_unidade,carga_placas,observacoes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[sessaoId,x.exercicio_id,x.posicao,x.series_realizadas,x.repeticoes_realizadas,x.carga_kg,x.carga_unidade,x.carga_placas,x.observacoes]);
    await client.query('COMMIT');committed=true;res.status(201).json({ok:true,id:sessaoId});
  }catch(e){if(!committed)await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}));
module.exports=router;
