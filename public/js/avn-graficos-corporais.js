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
function drawGraph(area,rows,unit,label){
 area.replaceChildren();
 if(!rows.length)return;
 const W=Math.max(310,Math.round(area.clientWidth||800)),H=245,L=58,R=18,T=16,B=47;
 const values=rows.map(p=>p.value),times=rows.map(p=>p.time);
 let low=Math.min(...values),high=Math.max(...values);
 const pad=Math.max((high-low)*.12,Math.abs(high)*.015,.2);
 low-=pad;high+=pad;
 let start=times[0],end=times[times.length-1];
 if(start===end){start-=43200000;end+=43200000;}
 const x=t=>L+(t-start)/(end-start)*(W-L-R);
 const y=v=>T+(high-v)/(high-low)*(H-T-B);
 const svg=svgEl(document.createElement('div'),'svg'); // Replaced below with a real SVG root.
 svg.setAttribute('xmlns',namespace);
 svg.setAttribute('viewBox','0 0 '+W+' '+H);
 svg.setAttribute('role','img');
 svg.setAttribute('aria-label','Histórico de '+label+': toque ou passe o mouse para ver a data e o valor');
 for(let i=0;i<=4;i++){
  const yy=T+(H-T-B)*i/4;
  svgEl(svg,'line',{x1:L,x2:W-R,y1:yy,y2:yy,stroke:'#34465f'});
  svgEl(svg,'text',{x:L-8,y:yy+4,'text-anchor':'end',fill:'#a9b9d1','font-size':11},format(high-(high-low)*i/4));
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
  tooltip.textContent=formatDate(p.date)+' · '+format(p.value)+' '+unit;
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
function render(){
 for(const m of definitions){
  const status=$('status-'+m.key),area=$('chart-'+m.key);
  const error=state.errors[m.key],rows=state.data[m.key]||[];
  if(error||!rows.length){
   status.hidden=false;status.textContent=error||'Nenhuma medição disponível neste período.';
   area.replaceChildren();continue;
  }
  status.hidden=true;
  drawGraph(area,rows,m.unit,m.key.replaceAll('_',' '));
 }
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
init();
})();