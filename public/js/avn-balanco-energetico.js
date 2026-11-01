(()=>{'use strict';
const $=id=>document.getElementById(id);
const TZ='America/Sao_Paulo',NS='http://www.w3.org/2000/svg';
const fmt=(n,dec=0)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:dec});
const has=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const roundDay=d=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const part=k=>p.find(x=>x.type===k)?.value;return part('year')+'-'+part('month')+'-'+part('day');};
const hoje=()=>roundDay(new Date());
const dataBR=d=>d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):'';
const isoDay=s=>new Date(s+'T12:00:00-03:00').getTime();
const conf={
 saldo:{nome:'Balanço energético',unidade:'kcal',cor:'#71d6a5',get:d=>d.saldo?.saldo_kcal},
 ingestao:{nome:'Calorias consumidas',unidade:'kcal',cor:'#60a5fa',get:d=>d.ingestao?.valor},
 tmb:{nome:'TMB',unidade:'kcal',cor:'#fbbf24',get:d=>d.tmb?.valor},
 passos:{nome:'Passos',unidade:'passos',cor:'#a78bfa',get:d=>d.passos?.valor},
 calorias_ativas:{nome:'Calorias de treinamento',unidade:'kcal',cor:'#fb923c',get:d=>d.calorias_ativas?.valor},
 peso:{nome:'Peso',unidade:'kg',cor:'#38bdf8'},
 imc:{nome:'IMC',unidade:'kg/m²',cor:'#f472b6'},
 gordura_corporal:{nome:'Gordura corporal',unidade:'%',cor:'#e879f9'},
 massa_magra:{nome:'Massa magra',unidade:'kg',cor:'#4ade80'},
 agua_corporal:{nome:'Água corporal',unidade:'kg',cor:'#2dd4bf'},
 massa_ossea:{nome:'Massa óssea',unidade:'kg',cor:'#eab308'}
};
const metricas=['saldo','ingestao','tmb','passos','calorias_ativas'];
const fisicas=['peso','gordura_corporal','massa_magra','agua_corporal','massa_ossea'];
let seq=0,resultadoAtual=null,usuarios=[],comparacao=null,compareSeq=0,resizeHandle=null;
const svg=(root,tag,attrs={},txt)=>{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(txt!==undefined)e.textContent=String(txt);root.append(e);return e;};
function svgRoot(W,H,label){const el=document.createElementNS(NS,'svg');el.setAttribute('viewBox','0 0 '+W+' '+H);el.setAttribute('role','img');el.setAttribute('aria-label',label);return el;}
async function getJson(url){const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});if(r.redirected&&r.url.includes('/login'))throw Error('Sessão expirada. Entre novamente.');const b=await r.json().catch(()=>{throw Error('Resposta inválida do servidor.');});if(!r.ok)throw Error(b.erro||'Erro na consulta.');return b;}
function ranges(values,zero=false){
 const min=Math.min(...values),max=Math.max(...values);
 let lo=zero?Math.min(0,min):min,hi=zero?Math.max(0,max):max;
 const pad=Math.max((hi-lo)*.12,Math.abs(hi)*.02,zero?10:0.3);
 lo-=pad;hi+=pad;
 return {min:lo,max:hi};
}
function segmentos(svgEl,points,color){
 let segmento=[];
 const enviar=()=>{if(segmento.length>1)svg(svgEl,'polyline',{points:segmento.map(p=>p.x+','+p.y).join(' '),fill:'none',stroke:color,'stroke-width':2.7,'stroke-linecap':'round','stroke-linejoin':'round'});segmento=[];};
 for(const p of points){if(!p){enviar();continue;}segmento.push(p);}enviar();
}
function graficoDiario(chave,dias,selecionado){
 const alvo=$('grafico-'+chave),met=conf[chave];alvo.replaceChildren();
 const W=650,H=282,L=62,R=23,T=33,B=66;
 const validos=dias.map(d=>has(met.get(d))?Number(met.get(d)):null);
 const numeros=validos.filter(v=>v!==null);
 if(!numeros.length){alvo.textContent='Sem dados suficientes para este gráfico.';return;}
 const {min,max}=ranges(numeros,chave==='saldo');
 const px=i=>L+(dias.length===1?.5:i/(dias.length-1))*(W-L-R);
 const py=v=>T+(max-v)/(max-min)*(H-T-B);
 const root=svgRoot(W,H,met.nome+' por data');
 const painelH=H-T-B;
 for(let j=0;j<=4;j++){
  const y=T+panelH*j/4;
  svg(root,'line',{x1:L,x2:W-R,y1:y,y2:y,stroke:'#33455f','stroke-width':1});
  svg(root,'text',{x:L-7,y:y+4,'text-anchor':'end',fill:'#afbfda','font-size':11},fmt(max-(max-min)*j/4,Math.abs(max-min)<10?1:0));
 }
 if(chave==='saldo'&&min<0&&max>0){
  const zy=py(0);svg(root,'line',{x1:L,x2:W-R,y1:zy,y2:zy,stroke:'#e2e8f0','stroke-dasharray':'5 5','stroke-width':1.3});
  svg(root,'text',{x:W-R,y:zy-5,'text-anchor':'end','font-size':10,fill:'#e2e8f0'},'Zero');
 }
 svg(root,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#91a5c2'});
 svg(root,'line',{x1:L,x2:W-R,y1:H-B,y2:H-B,stroke:'#91a5c2'});
 svg(root,'text',{x:10,y:17,'font-size':12,fill:'#c1d3e9'},met.unidade);
 svg(root,'text',{x:W-R,y:H-7,'text-anchor':'end','font-size':11,fill:'#c1d3e9'},'Data');
 const pontos=dias.map((d,i)=>validos[i]===null?null:({x:px(i),y:py(validos[i]),d,i,v:validos[i]}));
 segmentos(root,pontos,met.cor);
 for(let i=0;i<dias.length;i++){
  svg(root,'text',{x:px(i),y:H-B+22,'text-anchor':'middle','font-size':12,fill:dias[i].data===selecionado.data?'#fff':'#a9b9d1','font-weight':dias[i].data===selecionado.data?700:400},dataBR(dias[i].data).slice(0,5));
  const p=pontos[i];if(!p)continue;
  const ativo=p.d.data===selecionado.data;
  const circle=svg(root,'circle',{cx:p.x,cy:p.y,r:ativo?6:4.5,fill:met.cor,stroke:ativo?'#fff':'#182437','stroke-width':ativo?2:1.5,tabindex:0,role:'button'});
  let detalhe=dataBR(p.d.data)+' — '+fmt(p.v,1)+' '+met.unidade;
  if(chave==='passos'&&has(p.d.calorias_passos?.valor))detalhe+=' · '+fmt(p.d.calorias_passos.valor,1)+' kcal estimadas';
  svg(circle,'title',{},detalhe);
  circle.setAttribute('aria-label',detalhe+'; selecionar data');
  const selecionar=()=>{if($('data').value!==p.d.data){$('data').value=p.d.data;atualizar();}};
  circle.addEventListener('click',selecionar);
  circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selecionar();}});
  if(chave==='saldo'){
   svg(root,'text',{x:p.x,y:Math.max(15,p.y-13),'text-anchor':'middle','font-size':12,'font-weight':700,fill:met.cor,'pointer-events':'none'},(p.v>0?'+':'')+fmt(p.v,0));
  } else if(chave==='passos'){
   // Exibe a energia dos passos sob cada ponto, sem criar um sexto gráfico.
   const kcal=p.d.calorias_passos?.valor;
   svg(root,'text',{x:p.x,y:Math.min(H-B+17,p.y+19),'text-anchor':'middle','font-size':11,'font-weight':700,fill:'#e1d5ff','pointer-events':'none'},has(kcal)?fmt(kcal,0)+' kcal':'— kcal');
  }
 }
 alvo.append(root);
}
function preencherResumo(d){
 const s=d.saldo,painel=$('saldo');painel.className='saldo';
 if(s.classificacao==='indisponivel'){
  $('saldo-valor').textContent='Dados insuficientes';
  $('saldo-descricao').textContent='Faltam: '+s.faltam.join(', ')+'.';
  $('saldo-formula').textContent='Não foi possível calcular um saldo confiável nesta data.';
  return;
 }
 painel.classList.add(s.classificacao);
 $('saldo-valor').textContent=(s.classificacao==='deficit'?'Déficit':s.classificacao==='superavit'?'Superávit':'Equilíbrio')+' de '+fmt(Math.abs(s.saldo_kcal))+' kcal';
 $('saldo-descricao').textContent=(s.classificacao==='deficit'?'Gasto estimado acima do consumo.':s.classificacao==='superavit'?'Consumo acima do gasto estimado.':'Gasto e consumo próximos.')+(d.data===hoje()?' Resultado provisório de hoje.':'');
 $('saldo-formula').textContent='Consumidas: '+fmt(d.ingestao.valor)+' − (TMB: '+fmt(d.tmb.valor)+' + treinamento: '+fmt(d.calorias_ativas.valor)+' + passos estimados: '+fmt(d.calorias_passos.valor)+') = '+(s.saldo_kcal>0?'+':'')+fmt(s.saldo_kcal,1)+' kcal.';
}
function pintarDiarios(dias,selecionado){
 for(const chave of metricas){
  const m=conf[chave],n=m.get(selecionado);
  $('valor-'+chave).textContent=has(n)?(chave==='saldo'&&n>0?'+':'')+fmt(n,0)+' '+m.unidade:'Sem dados';
  if(chave==='calorias_ativas'&&selecionado.calorias_ativas?.sem_registros)$('valor-'+chave).textContent+=' (sem registros)';
  graficoDiario(chave,dias,selecionado);
 }
 $('nota-tmb').textContent=selecionado.tmb?.medida_em
  ?'Última bioimpedância válida: '+new Date(selecionado.tmb.medida_em).toLocaleDateString('pt-BR',{timeZone:TZ})
  :'Sem TMB válida nos 90 dias anteriores.';
 const e=selecionado.calorias_passos;
 $('nota-passos').textContent=e?.sem_registros
  ?'Sem passos sincronizados: 0 kcal estimadas nesta parcela.'
  :!has(e?.valor)
   ?'Estimativa indisponível: registre peso recente e altura.'
   :'Kcal líquidas estimadas sob cada ponto. No dia escolhido: '+fmt(e.valor,1)+' kcal de '+fmt(e.passos_considerados)+' passos considerados, sem duplicar intervalos de treino.';
 preencherResumo(selecionado);
}
function limpar(){
 for(const chave of metricas){$('valor-'+chave).textContent='—';$('grafico-'+chave).replaceChildren();}
 $('saldo').className='saldo';$('saldo-valor').textContent='—';$('saldo-descricao').textContent='Não foi possível consultar os dados.';$('saldo-formula').textContent='';
}
async function atualizar(){
 const current=++seq,user=$('usuario').value,day=$('data').value;
 if(!user||!day){$('mensagem').textContent='Selecione usuário e data.';return;}
 $('mensagem').textContent='Carregando gráficos…';
 try{
  const r=await getJson('/avn/sistema/api/balanco-energetico/'+encodeURIComponent(user)+'?data='+day);
  if(current!==seq)return;
  const selected=r.dias.find(d=>d.data===day);
  if(!selected)throw Error('Data não encontrada.');
  resultadoAtual=r;
  pintarDiarios(r.dias,selected);
  $('mensagem').textContent='Dados de '+dataBR(day)+' · selecione os pontos para consultar outros dias.';
  if($('compare-dialog').open)await carregarComparacao();
 }catch(err){if(current===seq){resultadoAtual=null;limpar();$('mensagem').textContent=err.message;}}
}
const onDay=s=>s.slice(0,10);
function dadosFisicos(registros,inicio,fim){
 const diarios=new Map();
 for(const r of registros||[]){
  const time=new Date(r.data_medicao).getTime(),val=Number(r.valor);
  if(!Number.isFinite(time)||!Number.isFinite(val)||val<0)continue;
  const dia=roundDay(new Date(time));
  if(dia<inicio||dia>fim)continue;
  const prior=diarios.get(dia);
  if(!prior||time>prior.time)diarios.set(dia,{data:dia,value:val,time});
 }
 return [...diarios.values()].sort((a,b)=>a.data.localeCompare(b.data));
}
function compararDatas(dias,met){return dias.filter(d=>has(met.get(d))).map(d=>({data:d.data,value:Number(met.get(d))}));}
async function carregarComparacao(){
 if(!$('compare-dialog').open)return;
 const token=++compareSeq;
 const user=$('usuario').value,day=$('data').value,period=Number($('compare-dias').value);
 $('compare-status').textContent='Carregando dados do período…';
 $('compare-chart').replaceChildren();$('compare-legend').replaceChildren();
 if(!user||!day){$('compare-status').textContent='Selecione usuário e data.';return;}
 try{
  const diferenca=Math.max(0,Math.ceil((Date.now()-isoDay(day))/86400000));
  const janela=Math.min(3650,period+diferenca+8);
  const urls=fisicas.map(k=>'/api/avn/health/usuarios/'+encodeURIComponent(user)+'/historico?metrica='+k+'&dias='+janela);
  const requests=await Promise.allSettled([
   getJson('/avn/sistema/api/balanco-energetico/'+encodeURIComponent(user)+'?data='+day+'&dias='+period),
   ...urls.map(getJson)
  ]);
  if(token!==compareSeq||!$('compare-dialog').open)return;
  const energy=requests[0].status==='fulfilled'?requests[0].value:null;
  const errors={};
  if(!energy)errors.saldo=requests[0].reason?.message||'Falha ao consultar balanço.';
  const series={};
  const inicio=new Date(isoDay(day)-(period-1)*86400000).toISOString().slice(0,10);
  for(const key of metricas)series[key]=energy?compararDatas(energy.dias,conf[key]):[];
  fisicas.forEach((key,i)=>{
   if(requests[i+1].status==='fulfilled')series[key]=dadosFisicos(requests[i+1].value.registros,inicio,day);
   else {series[key]=[];errors[key]=requests[i+1].reason?.message||'Falha na consulta.';}
  });
  const u=usuarios.find(x=>String(x.id)===user),altura=Number(u?.altura_cm)/100;
  series.imc=altura>0?series.peso.map(p=>({...p,value:p.value/(altura*altura)})):[];
  if(!(altura>0))errors.imc='Cadastre a altura para calcular o IMC.';
  comparacao={user,day,period,series,errors};
  desenharComparacao();
 }catch(e){if(token===compareSeq)$('compare-status').textContent=e.message||'Falha ao carregar o comparador.';}
}
function desenharComparacao(){
 const area=$('compare-chart'),status=$('compare-status'),legend=$('compare-legend');
 area.replaceChildren();legend.replaceChildren();
 const escolhidas=[...document.querySelectorAll('input[data-compare]:checked')].map(x=>x.dataset.compare);
 if(escolhidas.length<2){status.textContent='Marque pelo menos dois indicadores.';return;}
 if(!comparacao){status.textContent='Carregando registros…';return;}
 const all=escolhidas.map(key=>({...conf[key],key,rows:comparacao.series[key]||[]}));
 for(const a of all){
  const el=document.createElement('span');el.className='legenda-item';
  const dot=document.createElement('i');dot.style.backgroundColor=a.cor;
  const name=document.createElement('span');name.textContent=a.nome+(a.rows.length?'':' (sem dados)');
  el.append(dot,name);legend.append(el);
 }
 const usable=all.filter(x=>x.rows.length>0);
 if(!usable.length){status.textContent='Nenhum dos indicadores escolhidos tem registros no período.';return;}
 const two=escolhidas.length===2&&usable.length===2;
 const relative=escolhidas.length>=3;
 const W=940,H=365,L=75,R=two?80:32,T=42,B=61;
 const inicio=isoDay(comparacao.day)-(comparacao.period-1)*86400000,fim=isoDay(comparacao.day);
 const px=d=>L+(isoDay(d)-inicio)/Math.max(1,fim-inicio)*(W-L-R);
 const Hplot=H-T-B;
 for(const a of usable){
  const values=a.rows.map(p=>p.value);
  a.range=ranges(values,a.key==='saldo');
  const low=Math.min(...values),high=Math.max(...values);
  a.points=a.rows.map(p=>({...p,valorPlot:relative?(high===low?50:100*(p.value-low)/(high-low)):p.value}));
  a.byDate=new Map(a.points.map(p=>[p.data,p]));
 }
 const minimo=relative?0:usable[0].range.min,maximo=relative?100:usable[0].range.max;
 const py=(v,range)=>T+(range.max-v)/(range.max-range.min)*Hplot;
 const eixo=a=>relative?{min:0,max:100}:a.range;
 const root=svgRoot(W,H,'Comparação de '+escolhidas.map(k=>conf[k].nome).join(', '));
 for(let i=0;i<=5;i++){
  const yy=T+Hplot*i/5;
  svg(root,'line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#33455f'});
  svg(root,'text',{x:L-8,y:yy+4,'text-anchor':'end','font-size':12,fill:relative?'#cbd5e1':usable[0].cor},fmt(maximo-(maximo-minimo)*i/5,1));
  if(two){
   const y2=usable[1].range;
   svg(root,'text',{x:W-R+8,y:yy+4,'text-anchor':'start','font-size':12,fill:usable[1].cor},fmt(y2.max-(y2.max-y2.min)*i/5,1));
  }
 }
 svg(root,'text',{x:L,y:18,'font-size':12,fill:relative?'#cbd5e1':usable[0].cor},relative?'Escala relativa 0–100':usable[0].nome+' ('+usable[0].unidade+')');
 if(two)svg(root,'text',{x:W-R,y:18,'text-anchor':'end','font-size':12,fill:usable[1].cor},usable[1].nome+' ('+usable[1].unidade+')');
 svg(root,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#91a5c2'});
 svg(root,'line',{x1:L,x2:W-R,y1:H-B,y2:H-B,stroke:'#91a5c2'});
 if(two)svg(root,'line',{x1:W-R,x2:W-R,y1:T,y2:H-B,stroke:'#91a5c2'});
 for(let i=0;i<=5;i++){
  const time=inicio+(fim-inicio)*i/5;
  svg(root,'text',{x:L+(W-L-R)*i/5,y:H-28,'text-anchor':'middle','font-size':12,fill:'#afbfda'},new Date(time).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',timeZone:'UTC'}));
 }
 const allDays=new Set();
 for(const a of usable){
  const coords=a.points.map(p=>({...p,x:px(p.data),y:py(p.valorPlot,eixo(a))}));
  a.coords=coords;
  if(coords.length>1)svg(root,'polyline',{points:coords.map(p=>p.x+','+p.y).join(' '),fill:'none',stroke:a.cor,'stroke-width':2.8,'stroke-linejoin':'round','stroke-linecap':'round'});
  for(const p of coords){
   allDays.add(p.data);
   const dot=svg(root,'circle',{cx:p.x,cy:p.y,r:4,fill:a.cor});
   svg(dot,'title',{},dataBR(p.data)+' · '+a.nome+': '+fmt(p.value,2)+' '+a.unidade);
  }
 }
 const guide=svg(root,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#e5e7eb','stroke-dasharray':'4 4',visibility:'hidden'});
 const overlay=svg(root,'rect',{x:L,y:T,width:W-L-R,height:Hplot,fill:'transparent','pointer-events':'all'});
 const tooltip=document.createElement('div');tooltip.className='compare-tooltip';tooltip.hidden=true;
 const sorted=[...allDays].sort();
 const at=event=>{
  const rect=root.getBoundingClientRect();if(!rect.width||!sorted.length)return;
  const mouseX=(event.clientX-rect.left)*W/rect.width;
  const date=sorted.reduce((best,day)=>Math.abs(px(day)-mouseX)<Math.abs(px(best)-mouseX)?day:best,sorted[0]);
  const x=px(date);guide.setAttribute('x1',x);guide.setAttribute('x2',x);guide.setAttribute('visibility','visible');
  const lines=[dataBR(date)];
  for(const a of all){
   const value=a.byDate?.get(date);
   lines.push(a.nome+': '+(value?fmt(value.value,2)+' '+a.unidade:'sem medição nesta data'));
  }
  tooltip.textContent=lines.join('\n');tooltip.hidden=false;
  const left=x/W*area.clientWidth;
  tooltip.style.left=Math.max(6,Math.min(left+14,area.clientWidth-tooltip.offsetWidth-6))+'px';
  tooltip.style.top='10px';
 };
 overlay.addEventListener('pointermove',at);
 overlay.addEventListener('pointerdown',at);
 overlay.addEventListener('pointerleave',()=>{guide.setAttribute('visibility','hidden');tooltip.hidden=true;});
 area.append(root,tooltip);
 status.textContent=(relative?'Três ou mais indicadores: cada curva em escala relativa 0–100 (mínimo e máximo próprios).':'Dois indicadores: cada curva utiliza seu eixo vertical, conforme a cor.')+' Somente datas medidas são exibidas.'+(all.some(a=>!a.rows.length)?' Sem dados: '+all.filter(a=>!a.rows.length).map(a=>a.nome).join(', ')+'.':'');
}
function initComparador(){
 const dialog=$('compare-dialog');
 $('compare-open').addEventListener('click',()=>{
  dialog.showModal();
  carregarComparacao();
 });
 $('compare-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
 dialog.addEventListener('close',()=>{compareSeq++;});
 $('compare-dias').addEventListener('change',carregarComparacao);
 document.querySelectorAll('input[data-compare]').forEach(c=>c.addEventListener('change',desenharComparacao));
}
async function iniciar(){
 $('data').value=hoje();$('data').max=hoje();
 initComparador();
 try{
  usuarios=await getJson('/api/avn/usuarios');
  $('usuario').replaceChildren();
  for(const u of usuarios){const option=document.createElement('option');option.value=u.id;option.textContent=u.nome;$('usuario').append(option);}
  const anterior=localStorage.getItem('avn_nutricao_usuario')||localStorage.getItem('avn_treinos_usuario');
  if(usuarios.some(u=>String(u.id)===anterior))$('usuario').value=anterior;
  if(!usuarios.length){$('mensagem').textContent='Cadastre um usuário no AVN.';return;}
  $('usuario').addEventListener('change',()=>{localStorage.setItem('avn_nutricao_usuario',$('usuario').value);atualizar();});
  $('data').addEventListener('change',atualizar);
  atualizar();
 }catch(e){$('mensagem').textContent=e.message||'Falha ao carregar usuários.';}
}
window.addEventListener('resize',()=>{clearTimeout(resizeHandle);resizeHandle=setTimeout(()=>{if(resultadoAtual){const d=resultadoAtual.dias.find(x=>x.data===$('data').value);if(d)pintarDiarios(resultadoAtual.dias,d);}if($('compare-dialog').open&&comparacao)desenharComparacao();},160);});
iniciar();
})();