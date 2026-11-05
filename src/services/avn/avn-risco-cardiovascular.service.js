'use strict';
// AVN · Perfil cardiovascular: regras objetivas de classificação mínima SBC 2025.
// Não substitui o PREVENT e não presume respostas "não" em dados ausentes.
const pool=require('../../../db/connection');
const fields=['pressao_sistolica','pressao_diastolica','usa_antihipertensivo','usa_estatina','fuma',
 'diabetes_diagnosticado','historico_familiar_precoce','evento_cardiovascular_previo',
 'obstrucao_arterial_50','placa_subclinica','escore_calcio_coronariano'];
const numeric=new Set(['pressao_sistolica','pressao_diastolica','escore_calcio_coronariano']);
const tri=new Set(['sim','nao','nao_informado']);
const bad=message=>Object.assign(new Error(message),{status:400});
function payload(body){
 const p={};
 for(const key of fields){
  if(numeric.has(key)){
   const v=body[key];
   if(v==null||v===''){p[key]=null;continue;}
   if(typeof v==='boolean'||! /^\d+(?:[.,]\d+)?$/.test(String(v).trim()))throw bad('Valor inválido: '+key);
   const n=Number(String(v).replace(',','.'));
   const range=key==='pressao_sistolica'?[70,260]:key==='pressao_diastolica'?[35,160]:[0,100000];
   if(n<range[0]||n>range[1]||(key!=='escore_calcio_coronariano'&&!Number.isInteger(n)))
    throw bad('Fora do intervalo: '+key);
   p[key]=n;
  }else{
   p[key]=body[key]??'nao_informado';
   if(!tri.has(p[key]))throw bad('Resposta inválida: '+key);
  }
 }
 if(p.pressao_sistolica!=null&&p.pressao_diastolica!=null&&p.pressao_sistolica<=p.pressao_diastolica)
  throw bad('Pressão sistólica precisa ser maior que a diastólica.');
 return p;
}
async function avaliar(uid){
 const ur=await pool.query('SELECT u.data_nascimento,u.sexo_referencia_calculo, EXTRACT(YEAR FROM AGE(CURRENT_DATE,u.data_nascimento))::int idade,p.* FROM public.avn_usuario u LEFT JOIN public.avn_risco_cardiovascular_perfil p ON p.usuario_id=u.id WHERE u.id=$1',[uid]);
 if(!ur.rowCount)throw Object.assign(new Error('Usuário não encontrado.'),{status:404});
 const u=ur.rows[0];
 const ex=(await pool.query("SELECT DISTINCT ON (c.codigo) c.codigo,r.valor::float8 AS valor,r.unidade,r.data_coleta FROM public.avn_exames_resultados r JOIN public.avn_exames_catalogo c ON c.id=r.exame_id WHERE r.usuario_id=$1 AND c.codigo=ANY($2::text[]) AND r.valor IS NOT NULL ORDER BY c.codigo,r.data_coleta DESC,r.id DESC",
 [uid,['ldl','colesterol_nao_hdl','colesterol_total','hdl','tfg_estimada','hba1c']])).rows;
 const exames=Object.fromEntries(ex.map(x=>[x.codigo,{valor:x.valor,unidade:x.unidade,data_coleta:x.data_coleta}]));
 let nivel=0;const criterios=[],faltantes=[];
 const elevar=(n,why)=>{nivel=Math.max(nivel,n);criterios.push(why);};
 const ldl=exames.ldl?.unidade==='mg/dL'?exames.ldl.valor:null;
 if(ldl==null)faltantes.push('LDL em mg/dL');
 else if(ldl>=190)elevar(2,'LDL a partir de 190 mg/dL.');
 else if(ldl>=160)elevar(1,'LDL de 160 a 189 mg/dL.');
 if(u.evento_cardiovascular_previo==='sim')elevar(3,'Evento cardiovascular aterosclerótico prévio informado.');
 if(u.obstrucao_arterial_50==='sim')elevar(3,'Obstrução arterial de 50% ou mais informada.');
 if(u.placa_subclinica==='sim')elevar(2,'Placa aterosclerótica subclínica informada.');
 if(u.escore_calcio_coronariano!=null){
  if(Number(u.escore_calcio_coronariano)>300)elevar(3,'Escore de cálcio coronariano acima de 300.');
  else if(Number(u.escore_calcio_coronariano)>100)elevar(2,'Escore de cálcio coronariano acima de 100.');
 }
 if(u.diabetes_diagnosticado==='sim'){
  const alto=(u.sexo_referencia_calculo==='masculino'&&u.idade>=50)||(u.sexo_referencia_calculo==='feminino'&&u.idade>=56);
  elevar(alto?2:1,alto?'Diabetes informado e critério etário de risco alto.':'Diabetes informado, que requer estratificação específica.');
 }
 if(u.historico_familiar_precoce==='sim'){
  if(nivel===1)elevar(2,'Histórico familiar precoce como agravante de risco intermediário.');
  else criterios.push('Histórico familiar precoce informado: agravante a considerar.');
 }
 for(const [k,label] of [['pressao_sistolica','pressão arterial sistólica'],['usa_antihipertensivo','uso de remédio para pressão'],
 ['usa_estatina','uso de estatina'],['fuma','tabagismo'],['diabetes_diagnosticado','diabetes diagnosticado'],
 ['historico_familiar_precoce','histórico familiar precoce'],['evento_cardiovascular_previo','eventos cardiovasculares prévios'],
 ['obstrucao_arterial_50','obstrução arterial significativa'],['placa_subclinica','placas arteriais']]){
  if(u[k]==null||u[k]==='nao_informado')faltantes.push(label);
 }
 for(const [k,label] of [['colesterol_total','colesterol total'],['hdl','HDL'],['tfg_estimada','função renal (eTFG)']]){
  if(!exames[k])faltantes.push(label);
 }
 const labels=[null,'Intermediário','Alto','Muito alto'],codes=[null,'intermediario','alto','muito_alto'];
 return {perfil:Object.fromEntries(fields.map(k=>[k,u[k]??(numeric.has(k)?null:'nao_informado')])),
  idade:u.idade,sexo_referencia_calculo:u.sexo_referencia_calculo,exames,
  categoria_minima:codes[nivel],rotulo:labels[nivel],criterios,dados_pendentes:faltantes,
  aviso:'Classificação mínima provisória por critérios explícitos da SBC 2025. Não equivale a risco definitivo nem ao cálculo PREVENT. Validar com o médico.'};
}
async function salvar(uid,body){
 const p=payload(body),params=[uid,...fields.map(k=>p[k])];
 const qs=params.map((_,i)=>'$'+(i+1)).join(',');
 await pool.query('INSERT INTO public.avn_risco_cardiovascular_perfil(usuario_id,'+fields.join(',')+') VALUES ('+qs+') ON CONFLICT(usuario_id) DO UPDATE SET '+fields.map(k=>k+'=EXCLUDED.'+k).join(',')+',atualizado_em=NOW()',params);
 return avaliar(uid);
}
module.exports={avaliar,salvar};
