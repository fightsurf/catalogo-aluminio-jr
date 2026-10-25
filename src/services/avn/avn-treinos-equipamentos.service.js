'use strict';
// Regra conservadora: se não conseguirmos identificar o equipamento necessário,
// o exercício ficará pendente de classificação e NÃO será sugerido pela IA.
const pool = require('../../../db/connection');
const normalize = text => String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const has = (s,re) => re.test(s);
function inferir(ex){
 const s=normalize([ex.nome,ex.slug].join(' '));
 const e=normalize(ex.equipamento);
 const req=[];
 const add=(...ids)=>{for(const id of ids)if(!req.includes(id))req.push(id);};
 // Máquinas específicas: distinguir por NOME, nunca concluir que toda máquina serve.
 if(has(s,/leg.?press/))add('leg-press-45');
 else if(has(s,/hack.?squat/))add('hack-squat');
 else if(has(s,/smith/))add('smith');
 else if(has(s,/extensora|leg.?extension/))add('cadeira-extensora');
 else if(has(s,/mesa.?flexora|lying.?leg.?curl/))add('mesa-flexora');
 else if(has(s,/cadeira.?flexora|seated.?leg.?curl/))add('cadeira-flexora');
 else if(has(s,/cadeira.?abdutora|hip.?abduction.?machine/))add('cadeira-abdutora');
 else if(has(s,/cadeira.?adutora|hip.?adduction.?machine/))add('cadeira-adutora');
 else if(has(s,/panturrilha.?sentado|seated.?calf/))add('panturrilha-sentado');
 else if(has(s,/panturrilha.?em.?pe.?na.?maquina|standing.?calf.?machine/))add('panturrilha-em-pe');
 else if(has(s,/peck.?deck|pec.?deck|voador/))add('peck-deck');
 else if(has(s,/crucifixo.?inverso.?na.?maquina|reverse.?pec.?deck/))add('crucifixo-inverso');
 else if(has(s,/supino.?inclinado.?maquina|incline.?chest.?press.?machine/))add('supino-inclinado-maquina');
 else if(has(s,/supino.?na.?maquina|machine.?chest.?press/))add('maquina-supino');
 else if(has(s,/desenvolvimento.?maquina|machine.?shoulder.?press/))add('desenvolvimento-maquina');
 else if(has(s,/elevacao.?lateral.?maquina/))add('elevacao-lateral-maquina');
 else if(has(s,/puxada.?alta|lat.?pulldown/))add('puxada-alta');
 else if(has(s,/remada.?baixa|seated.?row/))add('remada-baixa');
 else if(has(s,/remada.?articulada|machine.?row/))add('remada-articulada');
 else if(has(s,/remada.?cavalinho|t.bar.?row/))add('remada-cavalinho');
 else if(has(s,/rosca.?scott.?maquina/))add('rosca-scott-maquina');
 else if(has(s,/mergulho.?assistid|assisted.?dip/))add('paralela-assistida');
 else if(has(s,/barra.?fixa.?assistid|assisted.?pull.up/))add('barra-assistida');
 else if(has(s,/maquina.?abdominal/))add('abdominal-maquina');
 else if(has(s,/ab.?wheel|rolinho/))add('ab-wheel');
 else if(has(s,/elevacao.?de.?joelhos.?na.?paralela|captain.s.?chair/))add('estacao-paralelas');
 else if(has(s,/mergulho.?nas.?paralelas|(^|[^a-z])dip([^a-z]|$)/))add('estacao-paralelas');
 else if(has(s,/barra.?fixa|pull.?up|chin.?up/))add('barra-fixa');
 else if(has(s,/panturrilha.?no.?leg.?press/))add('leg-press-45');
 else if(has(s,/esteira|walking|running|treadmill/))add('esteira');
 else if(has(s,/bicicleta.?ergometrica|stationary.?bike|cycling/))add('bicicleta-ergometrica');
 else if(has(s,/eliptic|elliptical/))add('eliptico');
 else if(has(s,/remo.?ergometrico|rowing.?machine/))add('remo-ergometro');
 else if(has(s,/simulador.?de.?escada|stair.?climber/))add('escada-ergometrica');
 else if(has(s,/corda.?de.?pular|jump.?rope/))add('corda-pular');
 else if(has(s,/barra.?na.?polia|crossover|cable|polia|face.?pull|pulldown.?com.?bracos/))add('polia-ajustavel');
 else if(has(s,/kettlebell/))add('kettlebell');
 else if(has(s,/faixa.?elastica|resistance.?band/))add('faixa-elastica');
 else if(has(s,/bola.?suica|stability.?ball/))add('bola-suica');
 else if(has(s,/banco.?lombar|back.?extension/))add('banco-lombar');
 else if(has(s,/step.?up|subida.?no.?banco|box.?jump/))add('step');
 else if(has(s,/triceps.?testa|skull.?crusher/))add('barra-w');
 else if(has(s,/rosca.?scott|preacher.?curl/))add('banco-scott');
 // Nomes genéricos de aparelhos NÃO são suficientes para garantir compatibilidade.
 if(!req.length){
  if(has(e,/maquina|machine|cardiorrespiratorio/))return {modo:'pendente',slugs:[],origem:'automatico'};
  if(has(e,/polia|cable/))add('polia-ajustavel');
  else if(has(e,/halter|dumbbell/))add('halteres');
  else if(has(e,/barra|barbell/))add('barra-olimpica');
  else if(has(e,/anilha|plate/))add('anilhas');
  else if(has(e,/banco|bench/))add('banco-regulavel');
  else if(has(e,/faixa|band/))add('faixa-elastica');
  else if(has(e,/kettlebell/))add('kettlebell');
  else if(has(e,/bola|ball/))add('bola-suica');
  else if(has(e,/corda/))add('corda-pular');
  else if(has(e,/parede|wall/))add('parede');
  else if(has(e,/cadeira|chair/))add('cadeira');
  else if(has(e,/porta|doorway/))add('porta');
  else if(has(e,/toalha|towel/))add('toalha');
  else if(has(e,/caixa|step/))add('step');
  else if(has(e,/peso corporal|bodyweight|livre|nenhum/) && !has(s,/puxada|remada|agachamento.?com.?barra|supino|halter|rosca|triceps.?polia/))return {modo:'livre',slugs:[],origem:'automatico'};
  else return {modo:'pendente',slugs:[],origem:'automatico'};
 }
 // Exercícios com barra ou halteres e apoio: requisitos cumulativos (AND).
 if(has(s,/supino|bench.?press/)&&has(e,/halter|dumbbell/))add('halteres','banco-regulavel');
 else if(has(s,/supino|bench.?press/)&&has(e,/barra|barbell/))add('barra-olimpica','banco-regulavel');
 if(has(s,/rosca.?scott|preacher.?curl/)&&!req.includes('rosca-scott-maquina'))add('banco-scott');
 if(has(e,/halter|dumbbell/)&&!req.some(k=>k==='halteres')&&!has(s,/maquina|machine/))add('halteres');
 if(has(e,/barra|barbell/)&&!has(s,/barra.?fixa|pull.?up|chin.?up/)&&!req.includes('barra-olimpica')&&!has(s,/maquina|machine|smith/))add('barra-olimpica');
 return {modo:'equipamentos',slugs:req,origem:'automatico'};
}
function resolver(ex,overrides,equipIds){
 const manual=overrides.get(String(ex.id));if(manual)return {...manual,origem:'manual'};
 const auto=inferir(ex);return {...auto,ids:auto.slugs.map(s=>equipIds.get(s)).filter(Boolean)};
}
async function dadosCompatibilidade(usuarioId,client=pool){
 const [e,eq,have,over,links]=await Promise.all([
  client.query(`SELECT e.id,e.slug,e.nome,e.equipamento,g.nome AS grupo FROM public.avn_exercicios e JOIN public.avn_exercicio_grupos g ON g.id=e.grupo_id WHERE e.ativo=TRUE ORDER BY g.ordem,e.nome LIMIT 800`),
  client.query('SELECT id,slug,nome,categoria FROM public.avn_equipamentos WHERE ativo=TRUE ORDER BY categoria,nome'),
  client.query('SELECT equipamento_id FROM public.avn_usuario_equipamentos WHERE usuario_id=$1',[usuarioId]),
  client.query('SELECT exercicio_id,modo FROM public.avn_exercicio_requisitos'),
  client.query('SELECT exercicio_id,equipamento_id FROM public.avn_exercicio_equipamentos')
 ]);
 const equipIds=new Map(eq.rows.map(x=>[x.slug,Number(x.id)]));const owned=new Set(have.rows.map(x=>Number(x.equipamento_id)));
 const keyed=new Map();for(const r of links.rows){const k=String(r.exercicio_id);if(!keyed.has(k))keyed.set(k,[]);keyed.get(k).push(Number(r.equipamento_id));}
 const overrides=new Map(over.rows.map(r=>[String(r.exercicio_id),{modo:r.modo,ids:keyed.get(String(r.exercicio_id))||[]} ]));
 const exercicios=e.rows.map(ex=>{const req=resolver(ex,overrides,equipIds);const compativel=req.modo==='livre'||(req.modo==='equipamentos'&&req.ids.length>0&&req.ids.every(id=>owned.has(id))&&(!req.slugs||req.ids.length===req.slugs.length));return {...ex,modo:req.modo,requisitos:req.ids,origem:req.origem,compativel};});
 return {exercicios,equipamentos:eq.rows,selecionados:[...owned]};
}
module.exports={inferir,resolver,dadosCompatibilidade};
