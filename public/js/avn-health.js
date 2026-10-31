(()=>{'use strict';
const $=id=>document.getElementById(id), section=document.body.dataset.section;
const defs={peso:['Peso','kg','corporal'],imc:['IMC','kg/m²','corporal'],gordura_corporal:['Gordura corporal','%','corporal'],massa_magra:['Massa magra','kg','corporal'],agua_corporal:['Água corporal','kg','corporal'],massa_ossea:['Massa óssea','kg','corporal'],tmb:['Metabolismo basal (TMB)','kcal/dia','gastos'],passos:['Passos','passos','gastos'],calorias_ativas:['Calorias ativas','kcal','gastos'],calorias_totais:['Calorias totais','kcal','gastos'],atividades:['Exercícios físicos','sessões','gastos']};
const fixed=document.body.dataset.fixedMetric;const keys=Object.keys(defs).filter(k=>defs[k][2]===section&&(!fixed||k===fixed));let selected=keys[0],users=[];
const fmt=(n,dp=2)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:dp});
const fmtDate=d=>new Date(d).toLocaleString('pt-BR');
async function json(url,signal){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});if(!r.ok)throw Error('Falha ao consultar dados (HTTP '+r.status+').');return r.json();}
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

/* Comparação entre dois indicadores nos cinco aplicativos individuais de avaliação física. */
function initCrossing(){
 const enabled=new Set(['peso','imc','gordura_corporal','massa_magra','massa_ossea']);
 if(!enabled.has(fixed)||section!=='corporal')return;
 const available=Object.keys(defs).filter(k=>defs[k][2]==='corporal'&&k!==fixed);
 const main=defs[fixed],toolbar=document.querySelector('.toolbar');
 if(!toolbar||!$('usuario')||!$('dias'))return;
 const button=document.createElement('button');
 button.id='avn-cross-open';button.type='button';button.className='avn-cross-open';
 button.textContent='🔀 Cruzar informações';
 toolbar.append(button);
 const dialog=document.createElement('dialog');
 dialog.className='avn-cross-dialog';dialog.setAttribute('aria-labelledby','avn-cross-title');
 dialog.innerHTML=`
 <div class="avn-cross-head"><h2 id="avn-cross-title">🔀 Cruzar informações</h2>
  <button type="button" class="avn-cross-close" aria-label="Fechar comparação">✕</button></div>
 <p class="avn-cross-help">Indicador principal: <strong id="avn-cross-primary"></strong>. Escolha outro indicador para exibir as duas linhas no mesmo gráfico.</p>
 <div class="avn-cross-choices" role="group" aria-label="Indicador para cruzamento"></div>
 <p class="avn-cross-help" id="avn-cross-status" role="status">Selecione um indicador para comparar.</p>
 <div class="avn-cross-legend" aria-label="Legenda das linhas"></div>
 <div class="avn-cross-graph" role="img" aria-label="Gráfico comparativo de evolução" hidden></div>
 <div class="avn-cross-stats" aria-label="Resumo das medições"></div>
 <p class="avn-cross-help">Cada indicador tem seu próprio eixo vertical e sua unidade. As linhas usam as datas reais, sem inventar medições nos dias vazios; o cruzamento visual não significa igualdade de valores.</p>`;
 document.querySelector('.shell').append(dialog);
 dialog.querySelector('#avn-cross-primary').textContent=main[0]+' ('+main[1]+')';
 const choices=dialog.querySelector('.avn-cross-choices');
 const status=dialog.querySelector('#avn-cross-status');
 const chart=dialog.querySelector('.avn-cross-graph');
 const legend=dialog.querySelector('.avn-cross-legend');
 const stats=dialog.querySelector('.avn-cross-stats');
 const close=dialog.querySelector('.avn-cross-close');
 const palette={peso:'#60a5fa',imc:'#fbbf24',gordura_corporal:'#fb923c',massa_magra:'#34d399',agua_corporal:'#c084fc',massa_ossea:'#f472b6'};
 let picked='',request=0,controller=null;
 for(const k of available){
  const option=document.createElement('label');option.className='avn-cross-option';
  const radio=document.createElement('input');
  radio.type='radio';radio.name='avn-cross-secondary';radio.value=k;
  const dot=document.createElement('i');dot.style.background=palette[k];
  const name=document.createElement('span');name.textContent=defs[k][0]+' ('+defs[k][1]+')';
  option.append(radio,dot,name);choices.append(option);
  radio.addEventListener('change',()=>{picked=k;load();});
 }
 const shortDate=t=>new Date(t).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'});
 const svgNS='http://www.w3.org/2000/svg';
 const svgElement=(parent,tag,attr={},value)=>{
  const el=document.createElementNS(svgNS,tag);
  for(const [k,v] of Object.entries(attr))el.setAttribute(k,String(v));
  if(value!==undefined)el.textContent=value;
  parent.append(el);return el;
 };
 function series(rows){
  const byDay=new Map();
  for(const row of rows){
   const t=new Date(row.data_medicao).getTime(),v=Number(row.valor);
   if(!Number.isFinite(t)||!Number.isFinite(v))continue;
   const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
   const anchor=Date.parse(date+'T12:00:00-03:00');
   const old=byDay.get(date);
   if(!old||t>old.recorded)byDay.set(date,{time:anchor,recorded:t,value:v,original:row.data_medicao});
  }
  return [...byDay.values()].sort((a,b)=>a.time-b.time);
 }
 function extent(rows){
  const values=rows.map(r=>r.value),min=Math.min(...values),max=Math.max(...values);
  const gap=max-min,margin=gap>0?Math.max(gap*.15,.03):Math.max(Math.abs(max)*.015,.2);
  return {min:min-margin,max:max+margin};
 }
 function writeStats(s){
  const box=document.createElement('div');box.className='avn-cross-stat';
  box.style.borderLeftColor=s.color;
  const title=document.createElement('strong');title.textContent=s.name;
  const description=document.createElement('span'),from=s.rows[0],to=s.rows[s.rows.length-1];
  const delta=to.value-from.value;
  description.textContent=fmt(from.value)+' → '+fmt(to.value)+' '+s.unit+' · '+(delta>0?'+':'')+fmt(delta)+' '+s.unit;
  const dates=document.createElement('small');dates.textContent=shortDate(from.time)+' a '+shortDate(to.time)+' · '+s.rows.length+' dia(s) com medição';
  box.append(title,description,dates);stats.append(box);
 }
 function plot(items){
  chart.replaceChildren();chart.hidden=false;
  const W=Math.max(350,Math.round(chart.clientWidth||820)),H=320,L=80,R=80,T=30,B=55;
  const w=W-L-R,h=H-T-B;
  const earliest=Math.min(...items.map(s=>s.rows[0].time)),latest=Math.max(...items.map(s=>s.rows[s.rows.length-1].time));
  const start=earliest===latest?earliest-43200000:earliest,end=earliest===latest?latest+43200000:latest;
  const x=t=>L+(t-start)/(end-start)*w;
  for(const s of items){s.bounds=extent(s.rows);s.y=v=>T+(s.bounds.max-v)/(s.bounds.max-s.bounds.min)*h;}
  const svg=document.createElementNS(svgNS,'svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.setAttribute('aria-label','Evolução de '+items.map(s=>s.name).join(' e '));
  svg.setAttribute('role','img');
  const dayValues=new Set();
  for(let i=0;i<=4;i++){
   const yy=T+h*i/4;
   svgElement(svg,'line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#34465f'});
   for(let j=0;j<2;j++){
    const s=items[j],tick=s.bounds.max-(s.bounds.max-s.bounds.min)*i/4;
    svgElement(svg,'text',{x:j?W-R+9:L-9,y:yy+4,'text-anchor':j?'start':'end',fill:s.color,'font-size':11},fmt(tick));
   }
  }
  items.forEach((s,i)=>svgElement(svg,'text',{x:i?W-R:L,y:15,'text-anchor':i?'end':'start',fill:s.color,'font-size':11},s.name+' ('+s.unit+')'));
  svgElement(svg,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#64748b'});
  svgElement(svg,'line',{x1:W-R,x2:W-R,y1:T,y2:H-B,stroke:'#64748b'});
  svgElement(svg,'line',{x1:L,x2:W-R,y1:H-B,y2:H-B,stroke:'#64748b'});
  for(let i=0;i<=4;i++){
   const time=start+(end-start)*i/4;
   svgElement(svg,'text',{x:x(time),y:H-23,'text-anchor':'middle',fill:'#a9b9d1','font-size':11},shortDate(time));
  }
  for(const s of items){
   s.points=s.rows.map(r=>({...r,px:x(r.time),py:s.y(r.value)}));
   s.lookup=new Map(s.points.map(p=>[p.time,p]));
   s.points.forEach(p=>dayValues.add(p.time));
   if(s.points.length>1)svgElement(svg,'polyline',{points:s.points.map(p=>p.px+','+p.py).join(' '),fill:'none',stroke:s.color,'stroke-width':2.7,'stroke-linecap':'round','stroke-linejoin':'round'});
   for(const p of s.points.length<=160?s.points:[]){
    const dot=svgElement(svg,'circle',{cx:p.px,cy:p.py,r:3.6,fill:s.color});
    svgElement(dot,'title',{},fmtDate(p.original)+' · '+s.name+': '+fmt(p.value)+' '+s.unit);
   }
  }
  const days=[...dayValues].sort((a,b)=>a-b);
  const guide=svgElement(svg,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#d5e4f9','stroke-width':1.2,'stroke-dasharray':'4 4',visibility:'hidden'});
  const markers=items.map(s=>svgElement(svg,'circle',{r:5.7,stroke:s.color,fill:'#182437','stroke-width':2.4,visibility:'hidden'}));
  const hit=svgElement(svg,'rect',{x:L,y:T,width:w,height:h,fill:'transparent','pointer-events':'all'});
  const tip=document.createElement('div');tip.className='graph-tooltip avn-cross-tooltip';tip.hidden=true;
  chart.append(svg,tip);
  const hide=()=>{tip.hidden=true;guide.setAttribute('visibility','hidden');markers.forEach(m=>m.setAttribute('visibility','hidden'));};
  const show=e=>{
   const rect=svg.getBoundingClientRect();if(!rect.width)return;
   const px=Math.max(L,Math.min(W-R,(e.clientX-rect.left)*W/rect.width));
   const target=start+(px-L)/w*(end-start);
   let a=0,b=days.length-1;
   while(a<b){const m=(a+b)>>1;if(days[m]<target)a=m+1;else b=m;}
   const day=a>0&&Math.abs(days[a-1]-target)<Math.abs(days[a]-target)?days[a-1]:days[a];
   const pxDay=x(day),lines=[shortDate(day)];
   guide.setAttribute('x1',pxDay);guide.setAttribute('x2',pxDay);guide.setAttribute('visibility','visible');
   items.forEach((s,i)=>{
    const p=s.lookup.get(day);
    if(!p){markers[i].setAttribute('visibility','hidden');return;}
    markers[i].setAttribute('cx',p.px);markers[i].setAttribute('cy',p.py);markers[i].setAttribute('visibility','visible');
    lines.push(s.name+': '+fmt(p.value)+' '+s.unit);
   });
   tip.textContent=lines.join('\n');tip.hidden=false;
   tip.style.left=Math.max(4,Math.min(pxDay/W*chart.clientWidth+12,chart.clientWidth-tip.offsetWidth-4))+'px';
   tip.style.top='5px';
  };
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerdown',show);hit.addEventListener('pointerleave',hide);
 }
 async function history(metric,user,days,signal){
  const source=metric==='imc'?'peso':metric;
  const r=await json('/api/avn/health/usuarios/'+encodeURIComponent(user)+'/historico?metrica='+source+'&dias='+encodeURIComponent(days),signal);
  const records=Array.isArray(r.registros)?r.registros:[];
  if(metric!=='imc')return series(records);
  const profile=users.find(u=>String(u.id)===String(user)),height=Number(profile?.altura_cm)/100;
  if(!(height>0))throw Error('Cadastre a altura do usuário para calcular o IMC.');
  return series(records.map(row=>({...row,valor:Number(row.valor)/(height*height)})));
 }
 async function load(){
  const token=++request;
  if(controller)controller.abort();
  controller=new AbortController();
  const user=$('usuario').value,days=$('dias').value;
  chart.replaceChildren();chart.hidden=true;legend.replaceChildren();stats.replaceChildren();
  if(!dialog.open)return;
  if(!picked){status.textContent='Selecione um dos outros indicadores para cruzar informações.';return;}
  if(!user){status.textContent='Selecione um usuário para consultar as medições.';return;}
  status.textContent='Carregando medições…';
  const keys=[fixed,picked];
  try{
   const rows=await Promise.all(keys.map(k=>history(k,user,days,controller.signal)));
   if(token!==request||!dialog.open)return;
   const items=keys.map((k,i)=>({key:k,name:defs[k][0],unit:defs[k][1],color:palette[k],rows:rows[i]}));
   for(const s of items){
    const line=document.createElement('span');line.className='avn-cross-legend-item';
    const dot=document.createElement('i');dot.style.background=s.color;
    const name=document.createElement('span');name.textContent=s.name+(s.rows.length?'':' (sem dados)');
    line.append(dot,name);legend.append(line);
    if(s.rows.length)writeStats(s);
   }
   const missing=items.filter(s=>!s.rows.length);
   if(missing.length){status.textContent='Sem medições no período para: '+missing.map(s=>s.name).join(', ')+'. Selecione outro período ou indicador.';return;}
   status.textContent='Duas linhas por data, com escalas independentes (esquerda e direita). Mostrando a última medição de cada dia.';
   plot(items);
  }catch(error){
   if(token!==request||error.name==='AbortError')return;
   status.textContent=error.message||'Não foi possível carregar as medições.';
  }
 }
 button.addEventListener('click',()=>{dialog.showModal();load();});
 close.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
 dialog.addEventListener('close',()=>{++request;if(controller)controller.abort();});
 $('usuario').addEventListener('change',()=>{if(dialog.open)load();});
 $('dias').addEventListener('change',()=>{if(dialog.open)load();});
}

initCrossing();init();})();
