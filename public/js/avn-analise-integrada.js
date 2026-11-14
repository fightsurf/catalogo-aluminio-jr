(()=>{'use strict';
const $=id=>document.getElementById(id);
const TZ='America/Sao_Paulo';
const MACROS=[
 ['kcal','Calorias','kcal'],['proteinas_g','Proteínas','g'],['carboidratos_g','Carboidratos','g'],
 ['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g']
];
const FISICAS=[
 ['peso','Peso corporal','kg'],['gordura_corporal','Gordura corporal','%'],
 ['massa_magra','Massa magra','kg'],['imc','IMC','kg/m²'],['agua_corporal','Água corporal','kg'],
 ['massa_ossea','Massa óssea','kg'],['gordura_visceral','Gordura visceral','índice'],
 ['tmb','TMB da bioimpedância','kcal/dia']
];
const numero=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const fmt=(x,casas=2)=>numero(x)===null?'sem dado':Number(x).toLocaleString('pt-BR',{maximumFractionDigits:casas});
const dBR=d=>d?d.split('-').reverse().join('/'):'—';
function diaLocal(value) {
 const d=new Date(value);
 if(!Number.isFinite(+d))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
 const p=k=>parts.find(x=>x.type===k)?.value;
 return p('year')+'-'+p('month')+'-'+p('day');
}
const hoje=()=>diaLocal(new Date());
function mudarDia(date,offset) {
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);
}
function diasDoPeriodo(inicio,fim) {
 const out=[];for(let d=inicio;d<=fim;d=mudarDia(d,1))out.push(d);return out;
}
function dataHora(t) {
 const d=new Date(t);return Number.isFinite(+d)?d.toLocaleString('pt-BR',{timeZone:TZ,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'sem horário';
}
function duracao(min){return numero(min)===null?'sem dado':fmt(min/60,2)+' h';}
function mapaPorDia(rows,getData) {
 const map=new Map();
 for(const row of rows||[]){const day=getData(row);if(!day)continue;if(!map.has(day))map.set(day,[]);map.get(day).push(row);}
 return map;
}
function valorNutriente(comp,chave,micro=false) {
 return numero(micro?comp?.micros?.[chave]:comp?.[chave]);
}
function extrairTotal(itens,chave,micro=false) {
 if(!itens?.length)return {valor:null,conhecido:0,ausentes:0,itens:0};
 let soma=0,ausentes=0,conhecido=0;
 for(const item of itens){
  const v=valorNutriente(item.composicao_100g,chave,micro),q=numero(item.quantidade_g);
  if(v===null||q===null){ausentes++;continue;}
  soma+=v*q/100;conhecido++;
 }
 return {valor:ausentes===0&&conhecido>0?soma:null,conhecido:soma,ausentes,itens:itens.length};
}
function rotuloTotal(a,unidade) {
 if(a.itens===0)return 'sem registro';
 if(a.valor!==null)return fmt(a.valor)+' '+unidade;
 return (a.ausentes===a.itens?'sem composição':'mínimo conhecido '+fmt(a.conhecido)+' '+unidade+' (incompleto: '+a.ausentes+'/'+a.itens+' itens)');
}
function estatisticaDiaria(datas,porDia,fn) {
 const validos=[];
 for(const d of datas){const v=fn(porDia.get(d)||[],d);if(numero(v)!==null)validos.push(Number(v));}
 const soma=validos.reduce((a,b)=>a+b,0);
 return {media:validos.length?soma/validos.length:null,soma:validos.length?soma:null,cobertura:validos.length,total:datas.length,menor:validos.length?Math.min(...validos):null,maior:validos.length?Math.max(...validos):null};
}
function estatTexto(st,unidade) {
 if(!st.cobertura)return 'sem dias com valores completos';
 return 'média '+fmt(st.media)+' '+unidade+'/dia; '+(st.cobertura===st.total?'total do período: ':'soma dos dias válidos: ')+fmt(st.soma)+' '+unidade+'; cobertura '+st.cobertura+'/'+st.total+' dias; mínimo '+fmt(st.menor)+', máximo '+fmt(st.maior);
}
function sessaoSono(rows) {
 const out=new Map();
 for(const x of rows||[]){
  const id=String(x.id);
  if(!out.has(id))out.set(id,{id,inicio:x.inicio,fim:x.fim,duracao_min:numero(x.duracao_min),pontuacao:numero(x.pontuacao),fases:{LIGHT:0,DEEP:0,REM:0,AWAKE:0},comFases:false});
  const s=out.get(id);
  if(!['LIGHT','DEEP','REM','AWAKE'].includes(x.fase_tipo))continue;
  const a=Math.max(+new Date(x.fase_inicio),+new Date(s.inicio)),b=Math.min(+new Date(x.fase_fim),+new Date(s.fim));
  if(Number.isFinite(a)&&Number.isFinite(b)&&b>a){s.fases[x.fase_tipo]+=(b-a)/60000;s.comFases=true;}
 }
 return [...out.values()].sort((a,b)=>+new Date(a.fim)-+new Date(b.fim));
}
function sessaoTreino(rows) {
 const out=new Map();
 for(const x of rows||[]){
  const id=String(x.sessao_id);
  if(!out.has(id))out.set(id,{id,realizado_em:x.realizado_em,plano_nome:x.plano_nome,observacoes:x.sessao_observacoes,exercicios:[]});
  if(x.item_id!=null)out.get(id).exercicios.push(x);
 }
 return [...out.values()].sort((a,b)=>+new Date(a.realizado_em)-+new Date(b.realizado_em));
}
function receitasDoUsuario(rows) {
 const porAlimento=new Map(),porId=new Map();
 for(const x of rows||[]){
  const id=String(x.receita_id);
  if(!porId.has(id))porId.set(id,{id,alimento_id:String(x.alimento_id),nome:x.nome,rendimento_g:numero(x.rendimento_g),ingredientes:[]});
  if(x.ingrediente_id!==null)porId.get(id).ingredientes.push({alimento_id:String(x.ingrediente_alimento_id),nome:x.ingrediente_nome,quantidade_g:numero(x.ingrediente_quantidade_g)});
 }
 for(const r of porId.values())porAlimento.set(r.alimento_id,r);
 return porAlimento;
}
function detalharReceita(receita,gramas,porAlimento,prefixo,visitados,linhas,profundidade) {
 if(!receita?.rendimento_g||receita.rendimento_g<=0){linhas.push(prefixo+'Composição da receita indisponível.');return;}
 if(profundidade>8||visitados.has(receita.id)){linhas.push(prefixo+'Receita aninhada não expandida (limite de profundidade/ciclo).');return;}
 const proximos=new Set(visitados);proximos.add(receita.id);
 for(const i of receita.ingredientes){
  const g=i.quantidade_g*gramas/receita.rendimento_g;
  linhas.push(prefixo+'- '+i.nome+': '+fmt(g,1)+' g');
  const sub=porAlimento.get(i.alimento_id);
  if(sub)detalharReceita(sub,g,porAlimento,prefixo+'   ',proximos,linhas,profundidade+1);
 }
}
function dadosBalanco(balanco) {
 const m=new Map();for(const item of balanco?.dias||[])m.set(item.data,item);return m;
}
function saldoTotal(dates,map){
 const vals=dates.map(d=>numero(map.get(d)?.saldo?.saldo_kcal)).filter(v=>v!==null);
 return {dias:vals.length,soma:vals.reduce((a,b)=>a+b,0),media:vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null};
}
function montarRelatorio(info,balanco,erroBalanco) {
 const atual=diasDoPeriodo(info.periodo.inicio,info.periodo.fim);
 const anterior=diasDoPeriodo(info.periodo.anterior_inicio,info.periodo.anterior_fim);
 const todos=[...anterior,...atual];
 const diario=mapaPorDia(info.diario,x=>x.data);
 const agua=mapaPorDia(info.agua,x=>x.data);
 const sono=sessaoSono(info.sono);
 const sonoDia=mapaPorDia(sono,x=>diaLocal(x.fim));
 const treinos=sessaoTreino(info.treinos);
 const treinoDia=mapaPorDia(treinos,x=>diaLocal(x.realizado_em));
 const medicoes=mapaPorDia(info.medicoes,x=>diaLocal(x.data_medicao));
 const bal=dadosBalanco(balanco);
 const meta=info.metas_atuais||{};
 const receitas=receitasDoUsuario(info.receitas);
 const L=[];
 const add=(...v)=>L.push(...v);
 const separar=()=>add('','='.repeat(78),'');
 const mediaMicro=(dates,key)=>estatisticaDiaria(dates,diario,itens=>extrairTotal(itens,key,true).valor);
 const cobertura=datas=>datas.filter(d=>(diario.get(d)||[]).length>0).length;
 add('AVN — ANÁLISE INTEGRADA DE SAÚDE','RELATÓRIO PARA ANÁLISE POR INTELIGÊNCIA ARTIFICIAL',
     'Gerado em: '+dataHora(info.gerado_em),'Usuário: '+(info.usuario?.nome||'Não informado'),
     'Período principal: '+dBR(info.periodo.inicio)+' a '+dBR(info.periodo.fim)+' (30 dias)',
     'Período de comparação: '+dBR(info.periodo.anterior_inicio)+' a '+dBR(info.periodo.anterior_fim)+' (30 dias)',
     'Fonte: registros reais do AVN; este relatório NÃO contém avaliação de IA.');
 separar();
 add('1. OBJETIVOS, PERFIL E METAS ATUAIS');
 const p=info.perfil_treinamento;
 add('Perfil de treino: '+(p?'nível '+p.nivel+', regularidade '+p.regularidade+', objetivo '+p.objetivo+', dias por semana '+(p.dias_semana??'não informado'):'não cadastrado'));
 add('Limitações físicas: '+(p?.limitacoes?.trim()||'não cadastradas no perfil de treinamento'));
 add('Preferências de treinamento: '+(p?.preferencias?.trim()||'não cadastradas'));
 add('Meta geral informada para a análise: reduzir gordura corporal, preservar ou ganhar massa muscular, melhorar sono e condicionamento.');
 for(const [chave,nome,unidade] of MACROS)add('Meta nutricional atual — '+nome+': '+(numero(meta[chave])===null?'não definida':fmt(meta[chave])+' '+unidade+'/dia'));
 add('Metas atuais de micronutrientes:');
 const listaMicro=info.nutrientes||[];
 for(const n of listaMicro){const v=numero(meta.micros?.[n.codigo]);if(v!==null)add('  '+n.nome+': '+fmt(v)+' '+n.unidade+'/dia');}
 if(!Object.keys(meta.micros||{}).length)add('  Nenhuma meta de micronutrientes cadastrada.');
 add('ATENÇÃO: metas atuais são referência para a IA propor alterações; NÃO são prova de adequação passada e não devem ser modificadas automaticamente.');
 separar();
 add('2. ALIMENTAÇÃO REAL — RESUMO DOS 30 DIAS');
 add('Origem exclusiva: Diário Alimentar, nunca a dieta programada.');
 add('Dias com alimentos registrados: '+cobertura(atual)+'/30; período anterior: '+cobertura(anterior)+'/30.');
 for(const [key,nome,unidade] of MACROS){
  const cur=estatisticaDiaria(atual,diario,itens=>extrairTotal(itens,key).valor);
  const prev=estatisticaDiaria(anterior,diario,itens=>extrairTotal(itens,key).valor);
  add(nome+': '+estatTexto(cur,unidade)+'. Anterior: '+(prev.cobertura?fmt(prev.media)+' '+unidade+'/dia ('+prev.cobertura+'/30 dias válidos)':'sem média confiável')+'.');
 }
 add('Valores por dia (um alimento sem composição torna o total daquele nutriente incompleto):');
 for(const d of atual){
  const itens=diario.get(d)||[];
  add(dBR(d)+': '+(itens.length?MACROS.map(([k,n,u])=>n+' '+rotuloTotal(extrairTotal(itens,k),u)).join('; '):'SEM REGISTROS NO DIÁRIO'));
 }
 separar();
 add('3. ALIMENTOS CONSUMIDOS — DIA A DIA E ACUMULADO');
 const somaAlimentos=new Map();
 for(const d of atual){
  const itens=diario.get(d)||[];
  add('Dia '+dBR(d)+':');
  if(!itens.length){add('  Nenhum alimento registrado.');continue;}
  const grupos=new Map();
  for(const i of itens){
   const chave=(i.alimento_id!=null?'id:'+String(i.alimento_id):'nome:'+i.alimento_nome);
   if(!grupos.has(chave))grupos.set(chave,{nome:i.alimento_nome,id:i.alimento_id==null?null:String(i.alimento_id),gramas:0,refeicoes:new Set()});
   const g=grupos.get(chave);g.gramas+=Number(i.quantidade_g)||0;g.refeicoes.add(i.refeicao||'não informada');
   if(!somaAlimentos.has(chave))somaAlimentos.set(chave,{nome:i.alimento_nome,id:g.id,gramas:0,dias:new Map()});
   const all=somaAlimentos.get(chave);all.gramas+=Number(i.quantidade_g)||0;
   all.dias.set(d,(all.dias.get(d)||0)+(Number(i.quantidade_g)||0));
  }
  for(const g of grupos.values())add('  '+g.nome+': '+fmt(g.gramas,1)+' g ('+fmt(g.gramas/1000,3)+' kg); refeições: '+[...g.refeicoes].join(', '));
 }
 add('','ACUMULADO DOS 30 DIAS POR ALIMENTO (com distribuição diária):');
 for(const f of [...somaAlimentos.values()].sort((a,b)=>b.gramas-a.gramas||a.nome.localeCompare(b.nome,'pt-BR'))){
  add('- '+f.nome+': '+fmt(f.gramas,1)+' g ('+fmt(f.gramas/1000,3)+' kg); dias: '+[...f.dias].map(([d,g])=>dBR(d)+' '+fmt(g,1)+' g').join('; '));
  const rec=receitas.get(f.id);
  if(rec){
   add('  Ingredientes proporcionais à porção total consumida (receita atualmente cadastrada; rendimento '+fmt(rec.rendimento_g)+' g):');
   detalharReceita(rec,f.gramas,receitas,'  ',new Set(),L,0);
  }
 }
 if(!somaAlimentos.size)add('Nenhum alimento registrado.');
 add('NOTA: nutrientes das receitas já integram a composição dos alimentos no Diário. NÃO somar novamente os nutrientes dos ingredientes. Ingredientes são detalhamento qualitativo/quantitativo, conforme a receita atual e seu rendimento.');
 separar();
 add('4. MICRONUTRIENTES — MÉDIAS, COBERTURA E EVOLUÇÃO');
 add('Médias calculadas somente com dias em que TODOS os alimentos possuem valor do micronutriente. Dias incompletos NÃO equivalem a consumo zero.');
 for(const n of listaMicro){
  const cur=mediaMicro(atual,n.codigo),prev=mediaMicro(anterior,n.codigo),alvo=numero(meta.micros?.[n.codigo]);
  const razao=alvo!==null&&alvo>0&&cur.media!==null?fmt(cur.media/alvo*100,1)+'%':'indeterminado';
  add(n.nome+' ('+n.unidade+'): '+estatTexto(cur,n.unidade)+'; meta atual '+(alvo===null?'não definida':fmt(alvo)+' '+n.unidade+'/dia')+'; percentual da meta '+razao+'; média anterior '+(prev.media===null?'indisponível':fmt(prev.media)+' '+n.unidade+'/dia, '+prev.cobertura+'/30 dias válidos')+'.');
 }
 add('','Histórico de micronutrientes por dia (somente dados válidos; os demais são n/d ou parciais):');
 for(const d of atual){
  const itens=diario.get(d)||[];
  const presentes=[],faltando=[];
  for(const n of listaMicro){
   const v=extrairTotal(itens,n.codigo,true);
   if(v.valor!==null)presentes.push(n.nome+' '+fmt(v.valor)+' '+n.unidade);
   else if(v.itens)faltando.push(n.nome+(v.conhecido>0?' (parcial '+fmt(v.conhecido)+' '+n.unidade+')':''));
  }
  add(dBR(d)+': '+(itens.length?presentes.join('; ')||'nenhum micronutriente completo':'SEM DIÁRIO'));
  if(faltando.length)add('  Composição incompleta/ausente: '+faltando.join(', '));
 }
 separar();
 add('5. HIDRATAÇÃO — ÁGUA INGERIDA');
 const aguaValor=itens=>itens.length?itens.reduce((a,x)=>a+Number(x.quantidade_ml||0),0):null;
 add('Média atual: '+estatTexto(estatisticaDiaria(atual,agua,aguaValor),'ml')+'.');
 add('Média anterior: '+estatTexto(estatisticaDiaria(anterior,agua,aguaValor),'ml')+'.');
 add('Meta de água: não consta nas metas nutricionais consultadas. Não presumir meta.');
 for(const d of atual)add(dBR(d)+': '+(agua.get(d)?.length?fmt(aguaValor(agua.get(d)))+' ml':'sem registro'));
 separar();
 add('6. SONO — SAMSUNG HEALTH');
 const sonoAtual=atual.flatMap(d=>sonoDia.get(d)||[]),sonoAnterior=anterior.flatMap(d=>sonoDia.get(d)||[]);
 const mediaSono=(arr,fn)=>{const valid=arr.map(fn).filter(v=>numero(v)!==null);return valid.length?valid.reduce((a,b)=>a+Number(b),0)/valid.length:null;};
 const totalSonoNoite=arr=>arr.some(s=>s.duracao_min!==null)?arr.reduce((a,s)=>a+(s.duracao_min||0),0):null;
 const noitePontos=arr=>arr.map(s=>s.pontuacao).filter(v=>v!==null);
 add('Sessões no período: '+sonoAtual.length+'; noites com registros: '+atual.filter(d=>sonoDia.has(d)).length+'/30.');
 add('Duração média por sessão: '+duracao(mediaSono(sonoAtual,s=>s.duracao_min))+'; anterior: '+duracao(mediaSono(sonoAnterior,s=>s.duracao_min))+'.');
 add('Pontuação Samsung Health média das sessões válidas: '+fmt(mediaSono(sonoAtual,s=>s.pontuacao),1)+'; anterior: '+fmt(mediaSono(sonoAnterior,s=>s.pontuacao),1)+'.');
 for(const fase of [['LIGHT','leve'],['DEEP','profundo'],['REM','REM'],['AWAKE','acordado']]){
  add('Sono '+fase[1]+' médio por sessão com estágios: '+duracao(mediaSono(sonoAtual.filter(s=>s.comFases),s=>s.fases[fase[0]]))+'.');
 }
 for(const d of atual){
  const arr=sonoDia.get(d)||[];
  if(!arr.length){add(dBR(d)+': sem registro de sono.');continue;}
  add(dBR(d)+' (data do despertar): '+arr.map(s=>{
   const fases=s.comFases?'leve '+duracao(s.fases.LIGHT)+', profundo '+duracao(s.fases.DEEP)+', REM '+duracao(s.fases.REM)+', acordado '+duracao(s.fases.AWAKE):'fases sem registro';
   const conhecido=s.fases.LIGHT+s.fases.DEEP+s.fases.REM;
   const pct=s.comFases&&conhecido>0?' (profundo '+fmt(s.fases.DEEP/conhecido*100,1)+'%, REM '+fmt(s.fases.REM/conhecido*100,1)+'% das fases dormidas registradas)':'';
   return 'dormiu '+dataHora(s.inicio)+', acordou '+dataHora(s.fim)+', duração informada '+duracao(s.duracao_min)+', '+fases+pct+', pontuação Samsung Health '+fmt(s.pontuacao,0);
  }).join(' | '));
 }
 add('NOTA: estágios de sono do wearable são estimativas. Sono é associado à data do despertar, e não da hora de deitar. Fases ausentes não são zero.');
 separar();
 add('7. AVALIAÇÃO FÍSICA E METABOLISMO BASAL');
 for(const [codigo,nome,unidade] of FISICAS){
  const rows=(info.medicoes||[]).filter(m=>m.codigo===codigo).sort((a,b)=>+new Date(a.data_medicao)-+new Date(b.data_medicao));
  const cur=rows.filter(x=>atual.includes(diaLocal(x.data_medicao))),ant=rows.filter(x=>anterior.includes(diaLocal(x.data_medicao)));
  if(!cur.length){add(nome+': sem medições nos últimos 30 dias; período anterior: '+ant.length+' registros.');continue;}
  const primeiro=cur[0],ultimo=cur[cur.length-1],delta=Number(ultimo.valor)-Number(primeiro.valor);
  add(nome+': '+cur.length+' medições; primeiro '+fmt(primeiro.valor)+' '+unidade+' em '+dataHora(primeiro.data_medicao)+', último '+fmt(ultimo.valor)+' '+unidade+' em '+dataHora(ultimo.data_medicao)+', variação '+fmt(delta)+' '+unidade+(numero(primeiro.valor)&&Number(primeiro.valor)!==0?' ('+fmt(delta/Number(primeiro.valor)*100,2)+'%)':'')+'.');
  add('  Registros: '+cur.map(x=>dataHora(x.data_medicao)+' '+fmt(x.valor)+' '+unidade+' ['+x.origem+', '+x.qualidade+']').join('; '));
  if(ant.length)add('  Último registro do período anterior: '+dataHora(ant[ant.length-1].data_medicao)+' '+fmt(ant[ant.length-1].valor)+' '+unidade+'.');
 }
 add('Massa de gordura estimada em kg:');
 let massaCalculada=0;
 for(const d of atual){
  const registros=medicoes.get(d)||[];
  const peso=[...registros].reverse().find(x=>x.codigo==='peso');
  const pct=[...registros].reverse().find(x=>x.codigo==='gordura_corporal');
  if(peso&&pct&&numero(pct.valor)!==null){add('  '+dBR(d)+': '+fmt(Number(peso.valor)*Number(pct.valor)/100)+' kg, derivada de peso e % gordura medidos na mesma data.');massaCalculada++;}
 }
 if(!massaCalculada)add('  Sem par de peso e gordura corporal medidos na mesma data.');
 add('Massa muscular: só apresentar caso haja métrica própria; massa magra NÃO é equivalente à massa muscular.');
 add('Gordura visceral: valor do Zepp é um ÍNDICE, não porcentagem. Sem medições cadastradas no AVN, informar ausência, não inserir automaticamente o número 14.');
 add('Limitação: diferenças de hidratação, aparelho e horário podem alterar estimativas de composição corporal.');
 separar();
 add('8. TREINOS EFETIVAMENTE REALIZADOS');
 const treinosAtual=atual.flatMap(d=>treinoDia.get(d)||[]),treinosAnterior=anterior.flatMap(d=>treinoDia.get(d)||[]);
 const grupos=new Map(),exercicios=new Map();
 for(const s of treinosAtual)for(const e of s.exercicios){
  const grupo=e.grupo_muscular||'não definido',series=numero(e.series_realizadas)||0;
  grupos.set(grupo,(grupos.get(grupo)||0)+series);
  const nome=e.exercicio||'Exercício não informado';
  if(!exercicios.has(nome))exercicios.set(nome,[]);
  exercicios.get(nome).push({dia:diaLocal(s.realizado_em),carga:numero(e.carga_kg),series,repeticoes:e.repeticoes_realizadas});
 }
 add('Sessões realizadas: '+treinosAtual.length+' nos últimos 30 dias; '+treinosAnterior.length+' nos 30 anteriores.');
 add('Dias com treino: '+atual.filter(d=>treinoDia.has(d)).length+'/30.');
 add('Séries por grupo muscular: '+([ ...grupos].map(([g,v])=>g+' '+v).join('; ')||'sem séries registradas')+'.');
 for(const [ex,rows] of exercicios){
  const valid=rows.filter(x=>x.carga!==null);
  add('Progressão '+ex+': '+(valid.length>=2?'primeira carga '+fmt(valid[0].carga)+' kg, última '+fmt(valid[valid.length-1].carga)+' kg':'cargas insuficientes para comparar')+'.');
 }
 for(const d of atual){
  const arr=treinoDia.get(d)||[];
  if(!arr.length){add(dBR(d)+': nenhum treino executado registrado.');continue;}
  for(const s of arr){
   add(dBR(d)+' — '+dataHora(s.realizado_em)+' — '+(s.plano_nome||'Treino')+(s.observacoes?' (observações: '+s.observacoes+')':''));
   for(const ex of s.exercicios)add('  '+ex.exercicio+' ['+(ex.grupo_muscular||'grupo indefinido')+']: '+(ex.series_realizadas??'?')+' séries, repetições '+(ex.repeticoes_realizadas||'não registradas')+', carga '+(numero(ex.carga_kg)===null?'não informada':fmt(ex.carga_kg)+' kg')+(ex.carga_unidade?' ('+ex.carga_unidade+')':'')+(ex.carga_placas?' / placas '+ex.carga_placas:'')+'.');
  }
 }
 add('Volume de carga total só pode ser calculado com repetições e cargas inequivocamente registradas. Calorias de treinamento são obtidas do Health Connect por meio do balanço energético; NÃO somar novamente calorias destas sessões.');
 separar();
 add('9. BALANÇO ENERGÉTICO — CÁLCULO ATUAL DO AVN');
 add('Saldo = calorias consumidas - [TMB + calorias ativas registradas + gasto líquido estimado dos passos sem sobreposição]. Saldos negativos representam déficit estimado.');
 if(erroBalanco)add('ALERTA: API do balanço energético indisponível: '+erroBalanco+'. Não estimar valores ausentes.');
 const atualSaldo=saldoTotal(atual,bal),prevSaldo=saldoTotal(anterior,bal);
 add('Período atual: '+(atualSaldo.dias?'soma dos '+atualSaldo.dias+' dias calculáveis '+fmt(atualSaldo.soma)+' kcal; média '+fmt(atualSaldo.media)+' kcal/dia':'sem saldos calculáveis')+'.');
 add('Período anterior: '+(prevSaldo.dias?'soma dos '+prevSaldo.dias+' dias calculáveis '+fmt(prevSaldo.soma)+' kcal; média '+fmt(prevSaldo.media)+' kcal/dia':'sem saldos calculáveis')+'.');
 for(const d of atual){
  const s=bal.get(d);
  if(!s){add(dBR(d)+': balanço indisponível.');continue;}
  add(dBR(d)+': ingeridas '+fmt(s.ingestao?.valor)+' kcal; TMB '+fmt(s.tmb?.valor)+' kcal/dia; passos '+fmt(s.passos?.valor,0)+'; gasto líquido estimado passos '+fmt(s.calorias_passos?.valor)+' kcal; calorias ativas '+fmt(s.calorias_ativas?.valor)+' kcal'+(s.calorias_ativas?.sem_registros?' (sem registros)':'')+'; saldo '+fmt(s.saldo?.saldo_kcal)+' kcal'+(s.saldo?.faltam?.length?' (faltam: '+s.saldo.faltam.join('; ')+')':'')+'.');
 }
 add('A TMB não equivale ao gasto total diário. Atividades cotidianas não registradas, erros de estimativa e dados ausentes podem distorcer o saldo. O acumulado de dias válidos NÃO é o saldo comprovado do mês inteiro.');
 separar();
 add('10. EXAMES LABORATORIAIS — RESULTADOS MAIS RECENTES');
 const labs=new Map();
 for(const e of info.exames||[]){
  const k=e.codigo||e.exame_nome;
  if(!labs.has(k))labs.set(k,[]);
  labs.get(k).push(e);
 }
 for(const arr of labs.values()){
  const latest=arr.find(x=>Number(x.ordem)===1)||arr[0];
  const past=arr.find(x=>Number(x.ordem)===2);
  const label=e=>dBR(e.data_coleta)+': '+(e.valor_texto||fmt(e.valor))+' '+(e.unidade||'')+
    (numero(e.limite_inferior)!==null||numero(e.limite_superior)!==null?' [referência '+fmt(e.limite_inferior)+'–'+fmt(e.limite_superior)+' '+(e.unidade||'')+']':'')+
    (e.referencia_texto?' ['+e.referencia_texto+']':'');
  add(latest.exame_nome+': atual '+label(latest)+(past?'; anterior '+label(past):''));
 }
 if(!labs.size)add('Nenhum exame laboratorial registrado.');
 add('As datas dos exames podem ser anteriores aos 30 dias. Referências dependem de laboratório, método e contexto clínico.');
 separar();
 add('11. CONFIABILIDADE, COBERTURA E LIMITAÇÕES');
 add('Diário: '+cobertura(atual)+'/30 dias; sono: '+atual.filter(d=>sonoDia.has(d)).length+'/30 noites com registros; água: '+atual.filter(d=>agua.has(d)).length+'/30 dias; treinos: '+atual.filter(d=>treinoDia.has(d)).length+'/30 dias com sessão.');
 add('Balanço energético: '+atualSaldo.dias+'/30 dias calculáveis; medições físicas: '+atual.filter(d=>medicoes.has(d)).length+'/30 dias com ao menos uma medição.');
 add('Não é possível saber se um dia sem Diário corresponde a jejum ou falha de lançamento. Dias sem treino registrado não comprovam repouso.');
 add('Receitas aninhadas exibem ingredientes proporcionais ao rendimento cadastrado, mas mudanças históricas na fórmula podem não ser recuperáveis.');
 for(const aviso of info.avisos||[])add('- '+aviso);
 separar();
 add('12. INSTRUÇÕES FINAIS PARA A INTELIGÊNCIA ARTIFICIAL');
 add('Analise integralmente os dados acima, sem inventar registros nem tratar lacunas como zero. O objetivo é reduzir gordura corporal, preservar ou aumentar massa muscular, melhorar a qualidade do sono e o condicionamento físico.');
 add('Entregue os seguintes resultados:');
 add('1) Diagnóstico situacional dos últimos 30 dias e comparação crítica com os 30 anteriores, diferenciando fatos, estimativas, hipóteses e ausência de dados.');
 add('2) Análise do balanço energético e da evolução do peso, gordura corporal, massa magra e TMB; investigue inconsistências e não converta saldo estimado em perda de gordura garantida.');
 add('3) Avaliação de alimentos reais, quantidades, receitas, calorias, macronutrientes, fibras, vitaminas e minerais. Identifique possíveis excessos e insuficiências apenas quando a cobertura sustentar a inferência.');
 add('4) Avalie as metas nutricionais atuais e proponha mudanças quantitativas justificadas, quando houver evidência suficiente. NÃO altere automaticamente qualquer meta do AVN.');
 add('5) Avalie treinos executados, frequência, volume, progressão, recuperação e distribuição dos grupos musculares. Relacione possíveis padrões com nutrição e sono sem confundir correlação com causalidade.');
 add('6) Avalie duração, horários, fases e pontuação Samsung Health, identificando padrões e limitações das medidas do wearable.');
 add('7) Interprete os exames laboratoriais com datas e referências e indique quando uma questão precisa de médico ou nutricionista. Não recomende ajustes de medicamentos por conta própria.');
 add('8) Proponha um plano priorizado com as CINCO mudanças mais importantes para os próximos 30 dias, valores e justificativas quando cabíveis, metas de acompanhamento e critérios para reavaliar.');
 add('9) Diga explicitamente quais dados adicionais seriam necessários e o grau de confiança de cada conclusão. Considere as limitações físicas cadastradas.');
 add('10) Separe sugestões práticas de hipóteses ainda não confirmadas. Não faça diagnóstico médico definitivo.');
 add('FIM DO RELATÓRIO');
 return {texto:L.join('\n'),cobertura:cobertura(atual),sonoNoites:atual.filter(d=>sonoDia.has(d)).length,treinos:treinosAtual.length};
}
async function get(url){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
 if(r.redirected&&r.url.includes('/login'))throw Error('Sessão expirada; entre novamente.');
 const b=await r.json().catch(()=>{throw Error('Resposta inválida do AVN.');});
 if(!r.ok)throw Error(b.erro||'Falha na consulta.');
 return b;
}
let textoAtual='';
function setLoading(sim){
 $('gerar').disabled=sim;$('usuario').disabled=sim;$('data').disabled=sim;
 $('copiar').disabled=sim||!textoAtual;$('baixar').disabled=sim||!textoAtual;
}
async function gerar(){
 const id=$('usuario').value,data=$('data').value;
 if(!/^[1-9]\d*$/.test(id)||!data){$('status').textContent='Selecione um usuário e uma data válida.';return;}
 textoAtual='';$('relatorio').value='';setLoading(true);$('status').classList.remove('error');
 $('status').textContent='Consultando registros do AVN e preparando o relatório…';
 try{
  const base='/avn/sistema/api/';
  const results=await Promise.allSettled([
   get(base+'analise-integrada/'+encodeURIComponent(id)+'?data='+encodeURIComponent(data)),
   get(base+'balanco-energetico/'+encodeURIComponent(id)+'?data='+encodeURIComponent(data)+'&dias=60')
  ]);
  if(results[0].status!=='fulfilled')throw results[0].reason;
  const info=results[0].value;
  const erro=results[1].status==='rejected'?String(results[1].reason?.message||'Falha na consulta'):null;
  const obj=montarRelatorio(info,results[1].status==='fulfilled'?results[1].value:null,erro);
  textoAtual=obj.texto;$('relatorio').value=textoAtual;
  $('periodo').textContent=dBR(info.periodo.inicio)+' a '+dBR(info.periodo.fim);
  $('diario-dias').textContent=obj.cobertura+'/30';
  $('sono-noites').textContent=obj.sonoNoites+'/30';
  $('treinos-sessoes').textContent=String(obj.treinos);
  $('status').textContent='Relatório gerado: '+textoAtual.length.toLocaleString('pt-BR')+' caracteres.'+(erro?' Atenção: balanço energético indisponível.':'')+' Nenhuma informação foi enviada à IA.';
 }catch(e){
  $('status').classList.add('error');$('status').textContent=e.message||'Falha ao gerar o relatório.';
 }finally{setLoading(false);}
}
async function copiar(){
 if(!textoAtual)return;
 try{
  await navigator.clipboard.writeText(textoAtual);
  $('status').textContent='Relatório completo copiado, incluindo as instruções finais para a IA.';
 }catch(e){
  $('relatorio').focus();$('relatorio').select();
  $('status').textContent='Cópia automática indisponível. Selecione e copie o texto do campo.';
 }
}
function baixar(){
 if(!textoAtual)return;
 const blob=new Blob([textoAtual],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='AVN-analise-integrada-'+$('data').value+'.txt';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function iniciar(){
 $('data').value=hoje();$('data').max=hoje();
 $('gerar').addEventListener('click',gerar);
 $('copiar').addEventListener('click',copiar);
 $('baixar').addEventListener('click',baixar);
 $('usuario').addEventListener('change',()=>{localStorage.setItem('avn_nutricao_usuario',$('usuario').value);});
 try{
  const usuarios=await get('/api/avn/usuarios');$('usuario').replaceChildren();
  for(const u of usuarios){const option=document.createElement('option');option.value=u.id;option.textContent=u.nome;$('usuario').append(option);}
  const salvo=localStorage.getItem('avn_nutricao_usuario')||localStorage.getItem('avn_treinos_usuario');
  if(usuarios.some(u=>String(u.id)===salvo))$('usuario').value=salvo;
  if(usuarios.length)await gerar();else $('status').textContent='Cadastre um usuário no AVN.';
 }catch(e){$('status').classList.add('error');$('status').textContent=e.message||'Falha ao carregar usuários.';}
}
iniciar();
})();