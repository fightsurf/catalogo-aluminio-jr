(()=>{'use strict';
const $=id=>document.getElementById(id), section=document.body.dataset.section;
const defs={peso:['Peso','kg','corporal'],imc:['IMC','kg/m²','corporal'],gordura_corporal:['Gordura corporal','%','corporal'],massa_magra:['Massa magra','kg','corporal'],agua_corporal:['Água corporal','kg','corporal'],massa_ossea:['Massa óssea','kg','corporal'],tmb:['Metabolismo basal (TMB)','kcal/dia','gastos'],passos:['Passos','passos','gastos'],calorias_ativas:['Calorias ativas','kcal','gastos'],calorias_totais:['Calorias totais','kcal','gastos'],atividades:['Exercícios físicos','sessões','gastos']};
const fixed=document.body.dataset.fixedMetric;const keys=Object.keys(defs).filter(k=>defs[k][2]===section&&(!fixed||k===fixed));let selected=keys[0],users=[];
const fmt=(n,dp=2)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:dp});
const fmtDate=d=>new Date(d).toLocaleString('pt-BR');
async function json(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Falha ao consultar dados (HTTP '+r.status+').');return r.json();}
function createCards(){if(fixed){$('cards').hidden=true;return;}for(const k of keys){const b=document.createElement('button');b.className='metric';b.dataset.metric=k;const t=document.createElement('strong');t.textContent=defs[k][0];const sub=document.createElement('small');sub.textContent=defs[k][1];b.append(t,sub);b.onclick=()=>{selected=k;refresh()};$('cards').append(b);}}
function draw(rows,unit){
 const area=$('graph');area.replaceChildren();
 if(!rows.length)return;
 const W=860,H=260,L=68,R=24,T=20,B=57;
 const clean=rows.map(row=>({row,time:new Date(row.data_medicao).getTime(),value:Number(row.valor)}))
   .filter(p=>Number.isFinite(p.time)&&Number.isFinite(p.value)).sort((a,b)=>a.time-b.time);
 if(!clean.length)return;
 const vals=clean.map(p=>p.value),times=clean.map(p=>p.time);
 let lo=Math.min(...vals),hi=Math.max(...vals);
 const pad=Math.max((hi-lo)*0.12,Math.abs(hi)*0.02,0.5);lo-=pad;hi+=pad;
 let t0=times[0],t1=times[times.length-1];
 if(t0===t1){t0-=43200000;t1+=43200000;}
 const x=t=>L+(t-t0)/(t1-t0)*(W-L-R);
 const y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
 svg.setAttribute('preserveAspectRatio','none');
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Gráfico histórico: passe o mouse sobre a linha para consultar data e valor');
 function elem(tag,attrs={},text){
  const e=document.createElementNS(ns,tag);
  for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);
  if(text!==undefined)e.textContent=text;
  svg.append(e);return e;
 }
 for(let i=0;i<=4;i++){
  const yy=T+i*(H-T-B)/4;
  elem('line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#e2e8f0'});
  elem('text',{x:L-10,y:yy+4,'text-anchor':'end','font-size':11,fill:'#64748b'},fmt(hi-i*(hi-lo)/4));
 }
 for(let i=0;i<=5;i++){
  const tt=t0+(t1-t0)*i/5,xx=x(tt);
  elem('text',{x:xx,y:H-30,'text-anchor':'middle','font-size':10,fill:'#64748b'},new Date(tt).toLocaleDateString('pt-BR'));
 }
 elem('line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#64748b'});
 elem('line',{x1:L,x2:W-R,y1:H-B,y2:H-B,stroke:'#64748b'});
 const points=clean.map(p=>({...p,px:x(p.time),py:y(p.value)}));
 elem('polyline',{
  points:points.map(p=>`${p.px},${p.py}`).join(' '),
  fill:'none',stroke:'#2563eb','stroke-width':2.4,'stroke-linejoin':'round','stroke-linecap':'round'
 });
 for(const p of points){
  const c=elem('circle',{cx:p.px,cy:p.py,r:3.4,fill:'#2563eb'});
  const title=document.createElementNS(ns,'title');
  title.textContent=fmtDate(p.row.data_medicao)+' — '+fmt(p.value)+' '+unit;
  c.append(title);
 }
 elem('text',{x:W/2,y:H-5,'text-anchor':'middle','font-size':11,fill:'#475569'},'Data');
 elem('text',{x:14,y:H/2,'text-anchor':'middle','font-size':11,fill:'#475569',transform:`rotate(-90 14 ${H/2})`},unit);
 // Elementos de destaque não são medições adicionais; apenas seguem o ponto real mais próximo.
 const guide=elem('line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#0f766e','stroke-width':1.2,'stroke-dasharray':'4 4',visibility:'hidden'});
 const focus=elem('circle',{cx:L,cy:T,r:6,fill:'#fff',stroke:'#0f766e','stroke-width':2.5,visibility:'hidden'});
 const hit=elem('rect',{x:L,y:T,width:W-L-R,height:H-T-B,fill:'transparent','pointer-events':'all'});
 const tip=document.createElement('div');tip.className='graph-tooltip';tip.hidden=true;
 area.append(svg,tip);
 let last=-1;
 const hide=()=>{last=-1;tip.hidden=true;guide.setAttribute('visibility','hidden');focus.setAttribute('visibility','hidden');};
 const show=(index)=>{
  if(index<0||index>=points.length){hide();return;}
  const p=points[index];
  guide.setAttribute('x1',p.px);guide.setAttribute('x2',p.px);
  guide.setAttribute('visibility','visible');
  focus.setAttribute('cx',p.px);focus.setAttribute('cy',p.py);focus.setAttribute('visibility','visible');
  if(index!==last){tip.textContent=`${fmtDate(p.row.data_medicao)} · ${fmt(p.value)} ${unit}`;last=index;}
  tip.hidden=false;
  const rect=area.getBoundingClientRect();
  const px=p.px/W*rect.width,py=p.py/H*rect.height;
  // Mantém o tooltip dentro do gráfico inclusive quando o ponto está nas bordas.
  tip.style.left=Math.max(4,Math.min(px,rect.width-tip.offsetWidth-4))+'px';
  tip.style.top=(py<62?py+12:py-tip.offsetHeight-12)+'px';
 };
 const move=(e)=>{
  const rect=svg.getBoundingClientRect();
  if(rect.width<=0)return;
  const px=(e.clientX-rect.left)/rect.width*W;
  // Busca binária: eficiente mesmo com centenas de medições no histórico.
  let a=0,b=points.length-1;
  while(a<b){const m=(a+b)>>1;if(points[m].px<px)a=m+1;else b=m;}
  const idx=a>0&&Math.abs(points[a-1].px-px)<Math.abs(points[a].px-px)?a-1:a;
  show(idx);
 };
 hit.addEventListener('pointermove',move);
 hit.addEventListener('pointerdown',move);
 hit.addEventListener('pointerleave',hide);
 area.addEventListener('mouseleave',hide);
}
function display(rows,k){const unit=defs[k][1];$('graph').replaceChildren();$('stats').replaceChildren();$('history').replaceChildren();if(!rows.length){$('message').textContent='Nenhuma medição disponível neste período.';return;}
$('message').textContent=rows.length+' registro(s). Pontos mostram medições reais; linhas apenas conectam medições existentes.';
const first=rows[0],last=rows[rows.length-1];for(const [name,value] of [['Inicial',fmt(first.valor)+' '+unit],['Última',fmt(last.valor)+' '+unit],['Variação',fmt(Number(last.valor)-Number(first.valor))+' '+unit]]){const span=document.createElement('span');span.textContent=name+': '+value;$('stats').append(span);}
draw(rows,unit);
for(const row of [...rows].reverse().slice(0,250)){const tr=document.createElement('tr');for(const val of [fmtDate(row.data_medicao),fmt(row.valor)+' '+unit,row.origem]){const td=document.createElement('td');td.textContent=val;tr.append(td);}$('history').append(tr);}}
async function refresh(){document.querySelectorAll('.metric').forEach(b=>b.classList.toggle('active',b.dataset.metric===selected));$('metric-title').textContent=defs[selected][0];$('message').textContent='Carregando…';$('graph').replaceChildren();$('history').replaceChildren();$('stats').replaceChildren();const user=$('usuario').value;if(!user){$('message').textContent='Cadastre primeiro um usuário no AVN.';return;}
try{const days=$('dias').value;if(selected==='atividades'){const rows=await json(`/api/avn/health/usuarios/${user}/atividades?dias=${days}`);$('message').textContent=rows.length+' sessão(ões) de exercícios neste período. As calorias da sessão não são somadas ao total para evitar duplicidade.';const daily=new Map();for(const a of rows){const key=new Date(a.inicio).toISOString().slice(0,10);daily.set(key,(daily.get(key)||0)+1);}const graphRows=[...daily].map(([d,v])=>({data_medicao:d+'T12:00:00Z',valor:v,origem:'health_connect'})).sort((a,b)=>a.data_medicao.localeCompare(b.data_medicao));draw(graphRows,'sessões/dia');for(const a of rows.slice(0,250)){const tr=document.createElement('tr');for(const val of [fmtDate(a.inicio),(a.tipo_atividade||a.titulo||'Exercício')+' — '+Math.round((new Date(a.fim)-new Date(a.inicio))/60000)+' min',a.origem]){const td=document.createElement('td');td.textContent=val;tr.append(td);}$('history').append(tr);}return;}
let rows;if(selected==='imc'){const r=await json(`/api/avn/health/usuarios/${user}/historico?metrica=peso&dias=${days}`);const u=users.find(u=>String(u.id)===String(user));const h=Number(u?.altura_cm)/100;rows=h>0?r.registros.map(item=>({...item,valor:Number(item.valor)/(h*h),origem:'calculado (peso + altura atual)'})):[];}else{const r=await json(`/api/avn/health/usuarios/${user}/historico?metrica=${selected}&dias=${days}`);rows=r.registros;}
if(selected==='passos'){const daily=new Map();for(const r of rows){const d=new Date(r.data_medicao).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});const item=daily.get(d)||{data_medicao:d+'T12:00:00-03:00',valor:0,origem:'health_connect'};item.valor+=Number(r.valor);daily.set(d,item);}rows=[...daily.values()].sort((a,b)=>a.data_medicao.localeCompare(b.data_medicao));$('message').textContent='Passos agregados por dia (verifique possíveis intervalos sobrepostos na origem).';}
display(rows,selected);
}catch(e){$('message').textContent=e.message;}}
async function init(){createCards();try{users=await json('/api/avn/usuarios');for(const u of users){const o=document.createElement('option');o.value=u.id;o.textContent=u.nome;$('usuario').append(o);}if(!users.length){$('message').textContent='Nenhum usuário cadastrado.';return;}$('usuario').onchange=refresh;$('dias').onchange=refresh;refresh();}catch(e){$('message').textContent=e.message;}}
init();})();
