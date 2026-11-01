(()=>{
'use strict';
const definitions=[
 {key:'peso',unit:'kg'},
 {key:'gordura_corporal',unit:'%'},
 {key:'massa_magra',unit:'kg'},
 {key:'imc',unit:'kg/m²'},
 {key:'agua_corporal',unit:'kg'}
];
const sources=['peso','gordura_corporal','massa_magra','agua_corporal'];
// Faixas de referência para adultos; IMC não mede diretamente a gordura corporal.
const imcBands=[
 {name:'Abaixo do peso',range:'Menos de 18,5',min:-Infinity,max:18.5,color:'#60a5fa'},
 {name:'Peso normal',range:'18,5 a 24,9',min:18.5,max:25,color:'#34d399'},
 {name:'Sobrepeso',range:'25 a 29,9',min:25,max:30,color:'#fbbf24'},
 {name:'Obesidade grau 1',range:'30 a 34,9',min:30,max:35,color:'#fb923c'},
 {name:'Obesidade grau 2',range:'35 a 39,9',min:35,max:40,color:'#f87171'},
 {name:'Obesidade grau 3',range:'40 ou mais',min:40,max:Infinity,color:'#c084fc'}
];
const imcLimits=[18.5,25,30,35,40];
function imcBand(value){return imcBands.find(b=>value>=b.min&&value<b.max);}
const $=id=>document.getElementById(id);
const format=n=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
const formatDate=n=>new Date(n).toLocaleString('pt-BR');
const formatShort=n=>new Date(n).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const state={users:[],data:{},errors:{},request:0,controller:null};
const namespace='http://www.w3.org/2000/svg';
function svgEl(parent,tag,attrs,text){
 const el=document.createElementNS(namespace,tag);
 for(const [key,value] of Object.entries(attrs||{}))el.setAttribute(key,String(value));
 if(text!==undefined)el.textContent=text;
 parent.append(el);return el;
}
async function getJson(url,signal){
 const res=await fetch(url,{credentials:'same-origin',cache:'no-store',signal});
 if(!res.ok)throw new Error('Falha ao consultar medições (HTTP '+res.status+').');
 return res.json();
}
function validRows(items){
 return (Array.isArray(items)?items:[]).map(row=>({
  time:new Date(row.data_medicao).getTime(),
  value:Number(row.valor),
  date:row.data_medicao
 })).filter(row=>Number.isFinite(row.time)&&Number.isFinite(row.value))
   .sort((a,b)=>a.time-b.time);
}
function renderImcReference(rows){
 const grid=$('imc-ranges'),current=$('imc-current');
 if(!grid||!current)return;
 if(!grid.childElementCount){
  for(const band of imcBands){
   const item=document.createElement('div');
   item.className='imc-reference-item';
   item.style.setProperty('--imc-color',band.color);
   const range=document.createElement('span');range.textContent=band.range;
   const name=document.createElement('strong');name.textContent=band.name;
   item.append(range,name);grid.append(item);
  }
 }
 const latest=rows.length?rows[rows.length-1]:null;
 const active=latest?imcBand(latest.value):null;
 current.textContent=active
  ?'Último IMC do período: '+format(latest.value)+' kg/m² — '+active.name+'.'
  :'Sem medição de IMC no período selecionado.';
 [...grid.children].forEach((item,i)=>item.classList.toggle('active',imcBands[i]===active));
}
function drawGraph(area,rows,unit,label){
 area.replaceChildren();
 if(!rows.length)return;
 const W=Math.max(310,Math.round(area.clientWidth||800)),H=245,L=58,R=18,T=16,B=47;
 const values=rows.map(p=>p.value),times=rows.map(p=>p.time);
 const isImc=label==='imc';
 const minValue=Math.min(...values),maxValue=Math.max(...values);
 let low=minValue,high=maxValue;
 const pad=Math.max((high-low)*.12,Math.abs(high)*.015,.2);
 low-=pad;high+=pad;
 if(isImc){
  // Mostra os limites da faixa atual sem comprimir o histórico na escala total.
  const lower=imcLimits.filter(limit=>limit<=minValue).pop();
  const upper=imcLimits.find(limit=>limit>maxValue);
  if(lower!==undefined)low=Math.min(low,lower-.35);
  if(upper!==undefined)high=Math.max(high,upper+.35);
 }
 let start=times[0],end=times[times.length-1];
 if(start===end){start-=43200000;end+=43200000;}
 const x=t=>L+(t-start)/(end-start)*(W-L-R);
 const y=v=>T+(high-v)/(high-low)*(H-T-B);
 const svg=svgEl(document.createElement('div'),'svg'); // Replaced below with a real SVG root.
 svg.setAttribute('xmlns',namespace);
 svg.setAttribute('viewBox','0 0 '+W+' '+H);
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Histórico de '+label+': toque ou passe o mouse para ver a data e o valor');
 if(isImc)for(const band of imcBands){
  const from=Math.max(low,band.min),to=Math.min(high,band.max);
  if(from<to)svgEl(svg,'rect',{x:L,y:y(to),width:W-L-R,height:y(from)-y(to),fill:band.color,opacity:.12,'pointer-events':'none'});
 }
 for(let i=0;i<=4;i++){
  const yy=T+(H-T-B)*i/4;
  svgEl(svg,'line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#34465f'});
  svgEl(svg,'text',{x:L-8,y:yy+4,'text-anchor':'end',fill:'#a9b9d1','font-size':11},format(high-(high-low)*i/4));
 }
 if(isImc)for(const limit of imcLimits){
  if(limit<=low||limit>=high)continue;
  const yy=y(limit);
  svgEl(svg,'line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#d6e3f5','stroke-width':1,'stroke-dasharray':'4 5',opacity:.72,'pointer-events':'none'});
  svgEl(svg,'text',{x:W-R-3,y:yy-5,'text-anchor':'end',fill:'#d6e3f5','font-size':10},format(limit));
 }
 const ticks=W<520?2:4;
 for(let i=0;i<=ticks;i++){
  const time=start+(end-start)*i/ticks;
  svgEl(svg,'text',{x:x(time),y:H-21,'text-anchor':'middle',fill:'#a9b9d1','font-size':11},formatShort(time));
 }
 svgEl(svg,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#64748b'});
 svgEl(svg,'line',{x1:L,x2:W-R,y1:H-B,y2:H-B,stroke:'#64748b'});
 svgEl(svg,'text',{x:L,y:11,fill:'#a9b9d1','font-size':11},unit);
 const points=rows.map(p=>({...p,px:x(p.time),py:y(p.value)}));
 const poly=points.map(p=>p.px+','+p.py).join(' ');
 svgEl(svg,'polyline',{points:poly,fill:'none',stroke:'#60a5fa','stroke-width':2.5,'stroke-linecap':'round','stroke-linejoin':'round'});
 const drawDots=points.length<=180?points:[points[0],points[points.length-1]];
 for(const p of drawDots){
  const c=svgEl(svg,'circle',{cx:p.px,cy:p.py,r:3.5,fill:'#60a5fa'});
  svgEl(c,'title',{},formatDate(p.date)+' — '+format(p.value)+' '+unit);
 }
 const guide=svgEl(svg,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#34d399','stroke-width':1.3,'stroke-dasharray':'4 4',visibility:'hidden'});
 const focus=svgEl(svg,'circle',{cx:L,cy:T,r:5.5,fill:'#182437',stroke:'#34d399','stroke-width':2.5,visibility:'hidden'});
 const hit=svgEl(svg,'rect',{x:L,y:T,width:W-L-R,height:H-T-B,fill:'transparent','pointer-events':'all'});
 const tooltip=document.createElement('div');tooltip.className='graph-tooltip';tooltip.hidden=true;
 area.append(svg,tooltip);
 const hide=()=>{tooltip.hidden=true;guide.setAttribute('visibility','hidden');focus.setAttribute('visibility','hidden');};
 const show=e=>{
  const rect=svg.getBoundingClientRect();if(!rect.width)return;
  const px=(e.clientX-rect.left)*W/rect.width;
  let left=0,right=points.length-1;
  while(left<right){const mid=(left+right)>>1;if(points[mid].px<px)left=mid+1;else right=mid;}
  const ix=left>0&&Math.abs(points[left-1].px-px)<Math.abs(points[left].px-px)?left-1:left;
  const p=points[ix];
  guide.setAttribute('x1',p.px);guide.setAttribute('x2',p.px);guide.setAttribute('visibility','visible');
  focus.setAttribute('cx',p.px);focus.setAttribute('cy',p.py);focus.setAttribute('visibility','visible');
  const band=isImc?imcBand(p.value):null;
  tooltip.textContent=formatDate(p.date)+' · '+format(p.value)+' '+unit+(band?' · '+band.name:'');
  tooltip.hidden=false;
  const xpos=p.px/W*area.clientWidth, ypos=p.py/H*area.clientHeight;
  tooltip.style.left=Math.max(4,Math.min(xpos+10,area.clientWidth-tooltip.offsetWidth-4))+'px';
  tooltip.style.top=Math.max(4,Math.min(ypos-tooltip.offsetHeight-10,area.clientHeight-tooltip.offsetHeight-4))+'px';
 };
 hit.addEventListener('pointermove',show);
 hit.addEventListener('pointerdown',show);
 hit.addEventListener('pointerleave',hide);
 area.addEventListener('mouseleave',hide,{once:true});
}

const compareDefs={
 peso:{name:'Peso',unit:'kg',color:'#60a5fa'},
 gordura_corporal:{name:'Gordura corporal',unit:'%',color:'#fb923c'},
 massa_magra:{name:'Massa magra',unit:'kg',color:'#34d399'},
 agua_corporal:{name:'Água corporal',unit:'kg',color:'#c084fc'}
};
const compareSelected=new Set();
function compareDaily(records){
 const last=new Map();
 for(const p of records){
  const date=new Date(p.time),year=date.getFullYear(),month=date.getMonth(),day=date.getDate();
  const key=year+'-'+month+'-'+day;
  last.set(key,{...p,time:new Date(year,month,day,12).getTime(),originalTime:p.time});
 }
 return [...last.values()].sort((a,b)=>a.time-b.time);
}
function compareExtent(values){
 let min=Infinity,max=-Infinity;
 for(const n of values){if(n<min)min=n;if(n>max)max=n;}
 const width=max-min,padding=width>0?Math.max(width*.15,.03):Math.max(Math.abs(max)*.015,.2);
 return {min:min-padding,max:max+padding};
}
function signed(n){return (n>0?'+':'')+format(n);}
function renderComparison(){
 const dialog=$('compare-dialog');
 if(!dialog||!dialog.open)return;
 const chart=$('compare-chart'),status=$('compare-status'),legend=$('compare-legend'),stats=$('compare-stats');
 chart.replaceChildren();chart.hidden=true;legend.replaceChildren();stats.replaceChildren();
 const keys=Object.keys(compareDefs).filter(key=>compareSelected.has(key));
 if(keys.length<2){
  status.textContent='Marque pelo menos dois indicadores para cruzar informações.';
  return;
 }
 const selected=keys.map(key=>({
  key,...compareDefs[key],rows:compareDaily(state.data[key]||[]),error:state.errors[key]
 }));
 const missing=selected.filter(s=>!s.rows.length);
 for(const s of selected){
  const entry=document.createElement('span');
  entry.className='compare-legend-item';
  const dot=document.createElement('i');dot.style.background=s.color;
  const name=document.createElement('span');name.textContent=s.name+(s.rows.length?'':' (sem dados)');
  entry.append(dot,name);legend.append(entry);
 }
 const percentMode=keys.length>=3;
 const usable=selected.filter(s=>s.rows.length && (!percentMode || s.rows[0].value!==0));
 if(!usable.length){
  status.textContent='Não há medições disponíveis para os indicadores escolhidos neste período.';
  return;
 }
 const firstDay=Math.min(...usable.map(s=>s.rows[0].time));
 const lastDay=Math.max(...usable.map(s=>s.rows[s.rows.length-1].time));
 const start=firstDay===lastDay?firstDay-43200000:firstDay;
 const end=firstDay===lastDay?lastDay+43200000:lastDay;
 const twoAxes=!percentMode && usable.length===2;
 status.textContent=percentMode
  ? 'Comparação pela variação percentual desde a primeira medição de cada indicador. O eixo horizontal mostra as datas reais.'
  : twoAxes
   ? 'Cada indicador utiliza seu próprio eixo vertical. Cruzamentos entre linhas não significam igualdade de valores.'
   : 'Exibindo os registros disponíveis. Selecione indicadores com histórico para comparar.';
 if(missing.length)status.textContent+=' Sem registros: '+missing.map(s=>s.name).join(', ')+'.';
 for(const s of selected){
  if(!s.rows.length)continue;
  const first=s.rows[0],last=s.rows[s.rows.length-1];
  const item=document.createElement('div');item.className='compare-stat';
  item.style.borderLeftColor=s.color;
  const title=document.createElement('strong');title.textContent=s.name;
  const value=document.createElement('span');
  if(s.rows.length===1)value.textContent=format(first.value)+' '+s.unit+' (uma medição em '+new Date(first.time).toLocaleDateString('pt-BR')+')';
  else{
   const delta=last.value-first.value,pct=first.value!==0?(' ('+signed(100*delta/first.value)+'%)'):'';
   value.textContent=format(first.value)+' → '+format(last.value)+' '+s.unit+' · '+signed(delta)+' '+s.unit+pct;
  }
  const dates=document.createElement('small');
  dates.textContent='De '+new Date(first.time).toLocaleDateString('pt-BR')+' a '+new Date(last.time).toLocaleDateString('pt-BR');
  item.append(title,value,dates);stats.append(item);
 }
 chart.hidden=false;
 const W=Math.max(360,Math.round(chart.clientWidth||820)),H=318,L=78,R=twoAxes?79:20,T=26,B=56;
 const plotWidth=W-L-R,plotHeight=H-T-B;
 const x=t=>L+(t-start)/(end-start)*plotWidth;
 let sharedRange;
 if(percentMode){
  for(const s of usable)s.rows=s.rows.map(p=>({...p,plotValue:(p.value-s.rows[0].value)/s.rows[0].value*100}));
  sharedRange=compareExtent(usable.flatMap(s=>s.rows.map(p=>p.plotValue)));
 }else{
  for(const s of usable){
   s.rows=s.rows.map(p=>({...p,plotValue:p.value}));
   s.range=compareExtent(s.rows.map(p=>p.plotValue));
  }
 }
 const scaleY=(s,v)=>{
  const range=percentMode?sharedRange:(twoAxes?s.range:usable[0].range);
  return T+(range.max-v)/(range.max-range.min)*plotHeight;
 };
 const svg=document.createElementNS(namespace,'svg');
 svg.setAttribute('viewBox','0 0 '+W+' '+H);
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Comparação entre '+keys.map(k=>compareDefs[k].name).join(', '));
 for(let i=0;i<=4;i++){
  const yy=T+i*plotHeight/4;
  svgEl(svg,'line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#34465f'});
  const leftRange=percentMode?sharedRange:usable[0].range;
  const leftValue=leftRange.max-i*(leftRange.max-leftRange.min)/4;
  svgEl(svg,'text',{x:L-10,y:yy+4,'text-anchor':'end',fill:percentMode?'#a9b9d1':usable[0].color,'font-size':11},format(leftValue));
  if(twoAxes){
   const rightRange=usable[1].range;
   const rightValue=rightRange.max-i*(rightRange.max-rightRange.min)/4;
   svgEl(svg,'text',{x:W-R+10,y:yy+4,'text-anchor':'start',fill:usable[1].color,'font-size':11},format(rightValue));
  }
 }
 svgEl(svg,'text',{x:L,y:13,fill:percentMode?'#a9b9d1':usable[0].color,'font-size':11},percentMode?'Variação (%)':usable[0].name+' ('+usable[0].unit+')');
 if(twoAxes)svgEl(svg,'text',{x:W-R,y:13,'text-anchor':'end',fill:usable[1].color,'font-size':11},usable[1].name+' ('+usable[1].unit+')');
 svgEl(svg,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#64748b'});
 svgEl(svg,'line',{x1:L,x2:W-R,y1:H-B,y2:H-B,stroke:'#64748b'});
 if(twoAxes)svgEl(svg,'line',{x1:W-R,x2:W-R,y1:T,y2:H-B,stroke:'#64748b'});
 const ticks=W<570?2:4;
 for(let i=0;i<=ticks;i++){
  const t=start+(end-start)*i/ticks;
  svgEl(svg,'text',{x:x(t),y:H-20,'text-anchor':'middle',fill:'#a9b9d1','font-size':11},formatShort(t));
 }
 const days=new Set();
 for(const s of usable){
  const pts=s.rows.map(p=>({...p,px:x(p.time),py:scaleY(s,p.plotValue)}));
  s.points=pts;
  s.byDay=new Map(pts.map(p=>[p.time,p]));
  for(const p of pts)days.add(p.time);
  if(pts.length>1){
   svgEl(svg,'polyline',{points:pts.map(p=>p.px+','+p.py).join(' '),fill:'none',stroke:s.color,'stroke-width':2.7,'stroke-linecap':'round','stroke-linejoin':'round'});
  }
  if(pts.length<=150)for(const p of pts){
   const circle=svgEl(svg,'circle',{cx:p.px,cy:p.py,r:3.5,fill:s.color});
   svgEl(circle,'title',{},formatDate(p.date)+' · '+s.name+': '+format(p.value)+' '+s.unit);
  }
 }
 const orderedDays=[...days].sort((a,b)=>a-b);
 const guide=svgEl(svg,'line',{x1:L,x2:L,y1:T,y2:H-B,stroke:'#cbd5e1','stroke-width':1,'stroke-dasharray':'5 5',visibility:'hidden'});
 const markers=usable.map(s=>svgEl(svg,'circle',{r:6,fill:'#182437',stroke:s.color,'stroke-width':2.5,visibility:'hidden'}));
 const hit=svgEl(svg,'rect',{x:L,y:T,width:plotWidth,height:plotHeight,fill:'transparent','pointer-events':'all'});
 const tooltip=document.createElement('div');tooltip.className='graph-tooltip compare-tooltip';tooltip.hidden=true;
 chart.append(svg,tooltip);
 function hide(){
  guide.setAttribute('visibility','hidden');
  markers.forEach(marker=>marker.setAttribute('visibility','hidden'));
  tooltip.hidden=true;
 }
 function show(event){
  const rect=svg.getBoundingClientRect();if(!rect.width)return;
  const px=Math.max(L,Math.min(W-R,(event.clientX-rect.left)*W/rect.width));
  const target=start+(px-L)/plotWidth*(end-start);
  let lo=0,hi=orderedDays.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(orderedDays[mid]<target)lo=mid+1;else hi=mid;}
  const day=lo>0&&Math.abs(orderedDays[lo-1]-target)<Math.abs(orderedDays[lo]-target)?orderedDays[lo-1]:orderedDays[lo];
  const xpos=x(day);
  guide.setAttribute('x1',xpos);guide.setAttribute('x2',xpos);guide.setAttribute('visibility','visible');
  const lines=[new Date(day).toLocaleDateString('pt-BR')];
  usable.forEach((s,i)=>{
   const p=s.byDay.get(day),marker=markers[i];
   if(!p){marker.setAttribute('visibility','hidden');return;}
   marker.setAttribute('cx',p.px);marker.setAttribute('cy',p.py);marker.setAttribute('visibility','visible');
   lines.push(s.name+': '+format(p.value)+' '+s.unit+(percentMode?' ('+signed(p.plotValue)+'%)':''));
  });
  tooltip.textContent=lines.join('\n');
  tooltip.hidden=false;
  const pos=xpos/W*chart.clientWidth;
  tooltip.style.left=Math.max(4,Math.min(pos+12,chart.clientWidth-tooltip.offsetWidth-4))+'px';
  tooltip.style.top='6px';
 }
 hit.addEventListener('pointermove',show);
 hit.addEventListener('pointerdown',show);
 hit.addEventListener('pointerleave',hide);
}
function initComparison(){
 const dialog=$('compare-dialog');
 if(!dialog)return;
 dialog.querySelectorAll('input[data-compare]').forEach(input=>{
  input.addEventListener('change',()=>{
   if(input.checked)compareSelected.add(input.value);else compareSelected.delete(input.value);
   renderComparison();
  });
 });
 $('compare-open').addEventListener('click',()=>{
  dialog.showModal();
  renderComparison();
 });
 $('compare-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
}

function render(){
 for(const m of definitions){
  const status=$('status-'+m.key),area=$('chart-'+m.key);
  const error=state.errors[m.key],rows=state.data[m.key]||[];
  if(m.key==='imc')renderImcReference(rows);
  if(error||!rows.length){
   status.hidden=false;status.textContent=error||'Nenhuma medição disponível neste período.';
   area.replaceChildren();continue;
  }
  status.hidden=true;
  drawGraph(area,rows,m.unit,m.key.replaceAll('_',' '));
 }
 if($('compare-dialog')?.open)renderComparison();
}
async function refresh(){
 const id=$('usuario').value,dias=$('dias').value,token=++state.request;
 if(state.controller)state.controller.abort();
 state.controller=new AbortController();
 state.data={};state.errors={};
 for(const m of definitions){
  $('status-'+m.key).hidden=false;
  $('status-'+m.key).textContent=id?'Carregando medições…':'Selecione um usuário.';
  $('chart-'+m.key).replaceChildren();
 }
 if(!id)return;
 const responses=await Promise.allSettled(sources.map(key=>
  getJson('/api/avn/health/usuarios/'+encodeURIComponent(id)+'/historico?metrica='+key+'&dias='+dias,state.controller.signal)));
 if(token!==state.request)return;
 sources.forEach((key,index)=>{
  if(responses[index].status==='fulfilled')state.data[key]=validRows(responses[index].value.registros);
  else state.errors[key]=responses[index].reason?.message||'Não foi possível consultar esta métrica.';
 });
 const user=state.users.find(u=>String(u.id)===String(id));
 const height=Number(user?.altura_cm)/100;
 if(state.errors.peso)state.errors.imc='Não foi possível consultar o peso para calcular o IMC.';
 else if(!Number.isFinite(height)||height<=0)state.errors.imc='Cadastre uma altura válida para calcular o IMC.';
 else state.data.imc=(state.data.peso||[]).map(p=>({...p,value:p.value/(height*height)}));
 render();
}
async function init(){
 try{
  state.users=await getJson('/api/avn/usuarios');
  const select=$('usuario');
  for(const u of state.users){
   const option=document.createElement('option');
   option.value=u.id;option.textContent=u.nome;select.append(option);
  }
  if(!state.users.length){refresh();return;}
  select.addEventListener('change',refresh);
  $('dias').addEventListener('change',refresh);
  await refresh();
 }catch(error){
  for(const m of definitions){
   $('status-'+m.key).textContent=error.message||'Não foi possível listar usuários.';
  }
 }
}
let resizeTimer;
window.addEventListener('resize',()=>{
 clearTimeout(resizeTimer);
 resizeTimer=setTimeout(render,120);
});
initComparison();
init();
})();