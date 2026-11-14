(()=>{'use strict';
const $=id=>document.getElementById(id);
const timezone='America/Sao_Paulo';
const displayDate=new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,dateStyle:'short',timeStyle:'short'});
const displayDay=new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,day:'2-digit',month:'2-digit'});
const isoLocal=value=>{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const p=type=>parts.find(x=>x.type===type)?.value;
  return p('year')+'-'+p('month')+'-'+p('day');
};
const stages={
  AWAKE:{name:'Acordado',css:'awake'},
  LIGHT:{name:'Leve',css:'light'},
  DEEP:{name:'Profundo',css:'deep'},
  REM:{name:'REM',css:'rem'}
};
const toNumber=value => value===null||value===undefined||value===''?null:(Number.isFinite(Number(value))?Number(value):null);
const minutesFormat=value => value==null?'Não informado':Math.floor(Math.round(value)/60)+'h '+String(Math.round(value)%60).padStart(2,'0')+'min';
const datetime=value => {const date=new Date(value);return Number.isFinite(date.getTime())?displayDate.format(date):'Data indisponível';};
const day=value => {const date=new Date(value);return Number.isFinite(date.getTime())?displayDay.format(date):'—';};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const elapsed=(start,end)=>{const a=new Date(start).getTime(),b=new Date(end).getTime();return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.max(0,(b-a)/60000):null;};
const element=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
let controller=null;
let sequence=0;
let currentNights=[];

async function getJSON(url,signal){
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('Falha ao consultar o AVN (HTTP '+response.status+').');
  return response.json();
}
function prepare(raw){
  if(!raw||typeof raw!=='object')return null;
  const start=new Date(raw.inicio).getTime(),end=new Date(raw.fim).getTime();
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  const segments=Array.isArray(raw.estagios)?raw.estagios.map(s=>{
    const code=String(s?.tipo||'').toUpperCase();
    const minutes=elapsed(s?.inicio,s?.fim);
    return stages[code]&&minutes!==null?{code,minutes}:null;
  }).filter(Boolean):[];
  const totals={AWAKE:0,LIGHT:0,DEEP:0,REM:0};
  for(const segment of segments)totals[segment.code]+=segment.minutes;
  return {
    start:raw.inicio,end:raw.fim,
    duration:toNumber(raw.duracao_min),
    score:toNumber(raw.pontuacao),
    origin:String(raw.origem||'samsung_health'),
    totals,
    segments:Array.isArray(raw.estagios)?raw.estagios.map(s=>{
      const code=String(s?.tipo||'').toUpperCase();
      const begin=new Date(s?.inicio).getTime(),finish=new Date(s?.fim).getTime();
      if(!stages[code]||!Number.isFinite(begin)||!Number.isFinite(finish)||finish<=begin)return null;
      const a=Math.max(begin,start),b=Math.min(finish,end);
      return b>a?{code,start:a,end:b}:null;
    }).filter(Boolean).sort((a,b)=>a.start-b.start):[],
    hasStages:segments.length>0,
    asleep:segments.some(s=>s.code==='LIGHT'||s.code==='DEEP'||s.code==='REM') ? totals.LIGHT+totals.DEEP+totals.REM : null
  };
}
function setStats(nights){
  // Médias reais do período, agregadas por dia de despertar (não confundir com a noite selecionada).
  const groups=new Map();
  for(const n of nights){
    const key=isoLocal(n.end);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(n);
  }
  const days=[...groups.values()].map(group=>{
    const total=fn=>{
      const values=group.map(fn).filter(v=>v!==null&&Number.isFinite(v));
      return values.length?values.reduce((a,b)=>a+b,0):null;
    };
    return {
      duration:total(n=>n.duration),
      asleep:total(n=>n.asleep),
      awake:total(n=>n.hasStages?n.totals.AWAKE:null),
      light:total(n=>n.hasStages?n.totals.LIGHT:null),
      deep:total(n=>n.hasStages?n.totals.DEEP:null),
      rem:total(n=>n.hasStages?n.totals.REM:null),
      score:group.find(n=>n.score!==null)?.score??null
    };
  });
  const avg=key=>{
    const values=days.map(d=>d[key]).filter(v=>v!==null&&Number.isFinite(v));
    return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  };
  for(const [id,key] of [['media-real','asleep'],['duracao','duration'],['acordado','awake'],['leve','light'],['profundo','deep'],['rem','rem']]){
    const value=avg(key);
    $(id).textContent=value===null?'—':minutesFormat(value);
  }
  const score=avg('score');
  $('pontuacao').textContent=score===null?'—':score.toLocaleString('pt-BR',{maximumFractionDigits:1});
  const valid=days.filter(d=>d.asleep!==null).length;
  $('average-coverage').textContent=days.length
    ?valid+' de '+days.length+' noite(s) com fases suficientes para estimar o tempo real de sono.'
    :'Nenhuma noite sincronizada no período.';
}

function latestNight(nights){
  const host=$('latest-content');host.replaceChildren();
  const night=nights[0];
  if(!night){host.append(element('p','hint','Ainda não há noites sincronizadas para apresentar.'));return;}
  const hero=element('div','latest-hero');
  const rating=element('div','latest-rating');
  rating.append(element('div','latest-caption','Pontuação Samsung Health'));
  rating.append(element('strong','',night.score===null?'—':String(night.score)));
  rating.append(element('div','latest-label',night.score===null?'Não informada':'Escala de 0 a 100'));
  const times=element('div','latest-times');
  times.append(element('span','',datetime(night.start)+' → '+datetime(night.end)));
  times.append(element('strong','',night.asleep===null?'Tempo real dormido indisponível':minutesFormat(night.asleep)+' · Tempo real dormido'));
  times.append(element('span','',night.duration===null?'Duração total não informada':minutesFormat(night.duration)+' · Duração total informada'));
  if(night.hasStages)times.append(element('span','',minutesFormat(night.totals.AWAKE)+' · Tempo acordado detectado'));
  hero.append(rating,times);
  host.append(hero);
  if(!night.segments.length){host.append(element('p','hint','Não há fases com horários disponíveis para montar a linha do tempo.'));return;}
  const total=new Date(night.end).getTime()-new Date(night.start).getTime();
  if(total<=0)return;
  const timeline=element('div','sleep-timeline');
  timeline.setAttribute('role','img');
  timeline.setAttribute('aria-label','Linha do tempo das fases do sono, do início ao fim da noite');
  for(const s of night.segments){
    const block=element('span','timeline-segment '+stages[s.code].css);
    block.style.left=((s.start-new Date(night.start).getTime())/total*100)+'%';
    block.style.width=(Math.max(0,s.end-s.start)/total*100)+'%';
    block.title=stages[s.code].name+' · '+datetime(s.start)+' → '+datetime(s.end);
    timeline.append(block);
  }
  host.append(timeline);
  const labels=element('div','timeline-labels');
  labels.append(element('span','',datetime(night.start)),element('span','',datetime(night.end)));
  host.append(labels);
  const phases=element('div','latest-phases');
  const reported=Object.values(night.totals).reduce((a,b)=>a+b,0);
  for(const [type,meta] of Object.entries(stages)){
    const tile=element('div','latest-phase');
    const key=element('span','');
    key.append(element('i',meta.css),document.createTextNode(meta.name));
    tile.append(key,element('strong','',minutesFormat(night.totals[type])));
    if(reported>0)tile.append(element('small','',Math.round(night.totals[type]/reported*100)+'% dos estágios registrados'));
    if(['LIGHT','DEEP','REM'].includes(type)){
      tile.classList.add('is-clickable');
      tile.tabIndex=0;tile.setAttribute('role','button');
      tile.setAttribute('aria-label','Abrir histórico de sono '+meta.name);
      tile.addEventListener('click',()=>openStage(type));
      tile.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();openStage(type);}
      });
    }
    phases.append(tile);
  }
  host.append(phases);
}

function drawChart(target,rows,field){
  const host=$(target);host.replaceChildren();
  // Mantém a data do despertar no eixo horizontal. Não inventa pontos quando faltam fases.
  const data=rows.filter(n=>field==='score'?n.score!==null:n.asleep!==null).slice(0,45).reverse();
  if(!data.length){
    host.append(element('div','empty','Sem registros com '+(field==='score'?'pontuação':'fases do sono')+' neste período.'));
    return;
  }
  const ns='http://www.w3.org/2000/svg',W=900,H=270,L=55,R=26,T=38,B=48;
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',field==='score'?'Evolução da pontuação por noite':'Evolução do tempo real dormido por noite');
  const add=(tag,attrs,label)=>{
    const node=document.createElementNS(ns,tag);
    for(const [key,val] of Object.entries(attrs||{}))node.setAttribute(key,String(val));
    if(label!==undefined)node.textContent=label;
    svg.append(node);
    return node;
  };
  const values=data.map(n=>field==='score'?n.score:n.asleep/60);
  const max=field==='score'?100:Math.max(9,Math.ceil(Math.max(...values)+1));
  const bottom=H-B,plotHeight=bottom-T;
  const y=v=>bottom-v/max*plotHeight;
  const x=i=>data.length===1?(L+W-R)/2:L+(W-L-R)*i/(data.length-1);
  const color=field==='score'?'#2dd4bf':'#60a5fa';
  for(let tick=0;tick<=4;tick++){
    const val=max*tick/4,yy=y(val);
    add('line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:'#34465f','stroke-width':1});
    add('text',{x:L-8,y:yy+4,fill:'#b5c6dc','font-size':12,'text-anchor':'end'},val.toLocaleString('pt-BR',{maximumFractionDigits:1}));
  }
  const path=values.map((v,i)=>(i===0?'M':'L')+x(i).toFixed(1)+' '+y(v).toFixed(1)).join(' ');
  add('path',{d:path,fill:'none',stroke:color,'stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'});
  const step=Math.max(1,Math.ceil(data.length/7));
  data.forEach((n,i)=>{
    const value=values[i],xx=x(i),yy=y(value);
    const circle=add('circle',{cx:xx,cy:yy,r:5,fill:color,stroke:'#101c2e','stroke-width':2});
    const tooltip=document.createElementNS(ns,'title');
    tooltip.textContent=day(n.end)+' · '+(field==='score'?String(n.score)+' pontos':minutesFormat(n.asleep));
    circle.append(tooltip);
    if(data.length<=12||i%step===0||i===data.length-1){
      const label=field==='score'?String(Math.round(value)):minutesFormat(n.asleep).replace('min','');
      add('text',{x:xx,y:Math.max(15,yy-12),fill:'#e5eefb','font-size':11,'text-anchor':'middle'},label);
    }
    if(i%step===0||i===data.length-1){
      add('text',{x:xx,y:H-13,fill:'#a9b9d1','font-size':11,'text-anchor':'middle'},day(n.end));
    }
  });
  host.append(svg);
}

function makeNight(n){
  const card=element('article','night');
  const top=element('div','night-top');
  const titleBox=element('div');
  titleBox.append(
    element('div','night-title','Noite de '+day(n.start)),
    element('div','night-sub',datetime(n.start)+' → '+datetime(n.end))
  );
  top.append(titleBox,element('div','night-sub','Origem: '+(n.origin==='samsung_health'?'Samsung Health':n.origin)));
  card.append(top);
  const metrics=element('div','night-metrics');
  for(const [key,value] of [
    ['Tempo real dormido',n.asleep===null?'Não informado':minutesFormat(n.asleep)],
    ['Duração total',minutesFormat(n.duration)],
    ['Pontuação',n.score===null?'Não informada':String(n.score)+' / 100'],
    ['Sono leve',n.hasStages?minutesFormat(n.totals.LIGHT):'—'],
    ['Sono profundo',n.hasStages?minutesFormat(n.totals.DEEP):'—'],
    ['REM',n.hasStages?minutesFormat(n.totals.REM):'—'],
    ['Acordado',n.hasStages?minutesFormat(n.totals.AWAKE):'—']
  ]){
    const span=element('span');
    span.append(element('strong','',key+': '),document.createTextNode(value));
    metrics.append(span);
  }
  card.append(metrics);
  if(n.hasStages){
    const sum=Object.values(n.totals).reduce((a,b)=>a+b,0);
    if(sum>0){
      const bar=element('div','stage-bar');
      bar.setAttribute('role','img');bar.setAttribute('aria-label','Distribuição relativa dos estágios registrados');
      for(const [type,stage] of Object.entries(stages)){
        if(n.totals[type]<=0)continue;
        const block=element('span',stage.css);
        block.style.width=(n.totals[type]/sum*100)+'%';
        block.title=stage.name+': '+minutesFormat(n.totals[type]);
        bar.append(block);
      }
      card.append(bar);
    }
    card.append(element('div','stage-text','Distribuição dos estágios informados pelo Samsung Health.'));
  }else{
    card.append(element('div','stage-text','Fases não disponíveis para esta noite.'));
  }
  return card;
}

/* Históricos independentes por fase e comparação com hábitos do dia anterior. */
const stageColors={LIGHT:'#7456f4',DEEP:'#6967dc',REM:'#2dd4bf'};
const compareMetrics={
 LIGHT:{name:'Sono leve',unit:'min',color:'#7456f4',sleep:true},
 DEEP:{name:'Sono profundo',unit:'min',color:'#6967dc',sleep:true},
 REM:{name:'Sono REM',unit:'min',color:'#2dd4bf',sleep:true},
 ASLEEP:{name:'Tempo real dormido',unit:'min',color:'#38bdf8',sleep:true},
 AWAKE:{name:'Tempo acordado',unit:'min',color:'#fb7185',sleep:true},
 calorias:{name:'Calorias consumidas',unit:'kcal',color:'#f9a8d4'},
 proteinas:{name:'Proteínas',unit:'g',color:'#60a5fa'},
 carboidratos:{name:'Carboidratos',unit:'g',color:'#fbbf24'},
 gorduras:{name:'Gorduras',unit:'g',color:'#a78bfa'},
 passos:{name:'Passos',unit:'passos',color:'#e879f9'},
 caloriasAtivas:{name:'Calorias ativas',unit:'kcal',color:'#fb923c'},
 caloriasPassos:{name:'Gasto estimado dos passos',unit:'kcal',color:'#f97316'},
 treinos:{name:'Sessões Health Connect',unit:'sessões',color:'#84cc16'}
};
const stageCache=new Map(),phaseTokens={LIGHT:0,DEEP:0,REM:0};
let crossToken=0;
const goodNumber=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
const dayOffset=(date,amount)=>{
 const value=new Date(date+'T12:00:00Z');
 value.setUTCDate(value.getUTCDate()+amount);
 return value.toISOString().slice(0,10);
};
const dateSeries=days=>{
 const today=isoLocal(new Date());
 return Array.from({length:days},(_,index)=>dayOffset(today,index-days+1));
};
const labelDate=date=>date.slice(8,10)+'/'+date.slice(5,7);
const longDate=date=>labelDate(date)+'/'+date.slice(0,4);
const valueLabel=(value,unit)=>goodNumber(value)?Number(value).toLocaleString('pt-BR',{maximumFractionDigits:unit==='sessões'||unit==='passos'?0:1})+' '+unit:'Sem registro';

async function nightsFor(days){
 const user=$('usuario').value;
 if(!user)throw new Error('Selecione um usuário para consultar.');
 const key=user+'|'+days;
 if(!stageCache.has(key)){
  // Busca margem para incluir sessões iniciadas antes da meia-noite.
  const promise=getJSON('/api/avn/health/usuarios/'+encodeURIComponent(user)+'/sono?dias='+(days+3))
   .then(data=>{
    if(!Array.isArray(data.noites))throw new Error('Histórico de sono inválido.');
    return data.noites.map(prepare).filter(Boolean);
   });
  stageCache.set(key,promise);
  promise.catch(()=>{if(stageCache.get(key)===promise)stageCache.delete(key);});
 }
 return stageCache.get(key);
}
function dailySleep(nights,dates){
 const grouped=new Map(dates.map(date=>[date,{date,has:false,ASLEEP:0,LIGHT:0,DEEP:0,REM:0,AWAKE:0}]));
 for(const night of nights){
  if(night.asleep===null||night.asleep<=0)continue;
  const date=isoLocal(night.end),day=grouped.get(date);
  if(!day)continue;
  day.has=true;day.ASLEEP+=night.asleep;
  for(const code of ['LIGHT','DEEP','REM','AWAKE'])day[code]+=night.totals[code];
 }
 return [...grouped.values()];
}
function addSVG(parent,tag,attrs={},content){
 const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
 for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
 if(content!==undefined)node.textContent=String(content);
 parent.append(node);
 return node;
}
function makeSvg(width,height,title){
 const node=document.createElementNS('http://www.w3.org/2000/svg','svg');
 node.setAttribute('viewBox','0 0 '+width+' '+height);
 node.setAttribute('role','img');
 node.setAttribute('aria-label',title);
 node.style.width=width+'px';
 node.style.height=height+'px';
 return node;
}
function tableFromRows(host,columns,data,wide=false){
 host.replaceChildren();
 const table=element('table','sleep-data-table'+(wide?' compare-data-table':''));
 const header=element('thead'),tr=element('tr');
 for(const column of columns)tr.append(element('th','',column));
 header.append(tr);table.append(header);
 const body=element('tbody');
 for(const row of data){
  const line=element('tr');
  for(const cell of row)line.append(element('td','',String(cell)));
  body.append(line);
 }
 table.append(body);host.append(table);
}
function plotStage(code,rows){
 const host=$('stage-chart-'+code);host.replaceChildren();
 const available=rows.filter(x=>x.has);
 if(!available.length){
  host.append(element('div','empty','Nenhuma noite com fases válidas no período.'));
  return;
 }
 const W=Math.max(850,rows.length*45+85),H=285,L=56,R=22,T=38,B=48;
 const svg=makeSvg(W,H,'Evolução diária de '+stages[code].name+', em minutos');
 const max=Math.max(30,Math.ceil(Math.max(...available.map(x=>x[code]))/15)*15);
 const x=i=>L+(rows.length===1?.5:i/(rows.length-1))*(W-L-R);
 const y=value=>H-B-(value/max)*(H-T-B);
 for(let j=0;j<=4;j++){
  const v=max*j/4,yy=y(v);
  addSVG(svg,'line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:'#34465f'});
  addSVG(svg,'text',{x:L-7,y:yy+4,fill:'#bac9dc','text-anchor':'end','font-size':11},Math.round(v));
 }
 addSVG(svg,'text',{x:L,y:19,fill:'#cbd5e1','font-size':12},'minutos');
 let previous=null;
 const step=Math.max(1,Math.ceil(rows.length/9));
 rows.forEach((row,i)=>{
  const xx=x(i);
  if(i%step===0||i===rows.length-1)addSVG(svg,'text',{x:xx,y:H-15,fill:'#b9c6d8','text-anchor':'middle','font-size':11},labelDate(row.date));
  if(!row.has){previous=null;return;}
  const yy=y(row[code]),percent=row.ASLEEP>0?100*row[code]/row.ASLEEP:null;
  if(previous)addSVG(svg,'line',{x1:previous.x,y1:previous.y,x2:xx,y2:yy,stroke:stageColors[code],'stroke-width':3,'stroke-linecap':'round'});
  const dot=addSVG(svg,'circle',{cx:xx,cy:yy,r:5,fill:stageColors[code],stroke:'#101c2e','stroke-width':2});
  addSVG(dot,'title',{},longDate(row.date)+': '+minutesFormat(row[code])+(percent===null?'':' ('+percent.toFixed(1).replace('.',',')+'% do sono real)'));
  if(rows.length<=30)addSVG(svg,'text',{x:xx,y:Math.max(T-3,yy-13),fill:'#eff6ff','text-anchor':'middle','font-size':11},Math.round(row[code])+'m');
  previous={x:xx,y:yy};
 });
 host.append(svg);
}
async function updateStage(code){
 const token=++phaseTokens[code],days=Number($('stage-period-'+code).value);
 const status=$('stage-status-'+code);
 status.classList.remove('error');
 status.textContent='Consultando as noites sincronizadas…';
 try{
  const nights=await nightsFor(days);
  if(token!==phaseTokens[code]||!$('dialog-stage-'+code).open)return;
  const rows=dailySleep(nights,dateSeries(days));
  const valid=rows.filter(x=>x.has).length;
  plotStage(code,rows);
  tableFromRows($('stage-table-'+code),['Dia do despertar',stages[code].name,'% do sono real'],
   [...rows].reverse().map(r=>[
    longDate(r.date),r.has?minutesFormat(r[code]):'Sem registro',
    r.has&&r.ASLEEP>0?(100*r[code]/r.ASLEEP).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—'
   ]));
  status.textContent=valid+' de '+days+' dia(s) com fases de sono registradas.';
 }catch(error){
  if(token!==phaseTokens[code])return;
  status.classList.add('error');status.textContent=error.message||'Falha no histórico.';
  $('stage-chart-'+code).replaceChildren();$('stage-table-'+code).replaceChildren();
 }
}
function openStage(code){
 const dialog=$('dialog-stage-'+code);
 if(!dialog.open)dialog.showModal();
 updateStage(code);
}
function plotCross(rows,keys){
 const host=$('compare-chart');host.replaceChildren();
 const valid=keys.filter(key=>rows.some(row=>goodNumber(row.values[key])));
 if(!valid.length){host.append(element('div','empty','Nenhum indicador selecionado possui registros neste período.'));return;}
 const W=Math.max(900,rows.length*51+90),H=330,L=54,R=28,T=32,B=52;
 const svg=makeSvg(W,H,'Evolução cruzada dos indicadores, normalizada de 0 a 100');
 const x=i=>L+(rows.length===1?.5:i/(rows.length-1))*(W-L-R),y=v=>H-B-v/100*(H-T-B);
 for(let tick=0;tick<=4;tick++){
  const value=tick*25,yy=y(value);
  addSVG(svg,'line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:'#34465f'});
  addSVG(svg,'text',{x:L-6,y:yy+4,fill:'#bfcce0','text-anchor':'end','font-size':11},value);
 }
 addSVG(svg,'text',{x:L,y:18,fill:'#bccadc','font-size':11},'Escala relativa (0 a 100)');
 const step=Math.max(1,Math.ceil(rows.length/10));
 rows.forEach((row,i)=>{
  if(i%step===0||i===rows.length-1)addSVG(svg,'text',{x:x(i),y:H-16,fill:'#b9c6d8','text-anchor':'middle','font-size':11},labelDate(row.date));
 });
 valid.forEach((key,k)=>{
  const values=rows.map(row=>row.values[key]).filter(goodNumber).map(Number);
  const min=Math.min(...values),max=Math.max(...values);
  const scaled=v=>max===min?50:(v-min)/(max-min)*100;
  let previous=null;
  rows.forEach((row,i)=>{
   const raw=row.values[key];
   if(!goodNumber(raw)){previous=null;return;}
   const xx=x(i),yy=y(scaled(Number(raw)));
   if(previous)addSVG(svg,'line',{x1:previous.x,y1:previous.y,x2:xx,y2:yy,stroke:compareMetrics[key].color,'stroke-width':2.6,'stroke-linecap':'round'});
   const dot=addSVG(svg,'circle',{cx:xx,cy:yy,r:4.5,stroke:'#152138','stroke-width':1.5,fill:compareMetrics[key].color});
   addSVG(dot,'title',{},longDate(row.date)+' — '+compareMetrics[key].name+': '+valueLabel(raw,compareMetrics[key].unit));
   if(rows.length<=10&&valid.length<=3){
    const dy=k%2===0?-13:20;
    addSVG(svg,'text',{x:xx,y:Math.max(T+8,Math.min(H-B-6,yy+dy)),fill:compareMetrics[key].color,'font-size':10,'text-anchor':'middle'},Number(raw).toLocaleString('pt-BR',{maximumFractionDigits:1}));
   }
   previous={x:xx,y:yy};
  });
 });
 host.append(svg);
}
async function updateCross(){
 const token=++crossToken,days=Number($('compare-period').value);
 const keys=[...document.querySelectorAll('input[data-sleep-compare]:checked')].map(x=>x.dataset.sleepCompare);
 const status=$('compare-status'),chart=$('compare-chart'),legend=$('compare-legend'),table=$('compare-table');
 status.classList.remove('error');
 chart.replaceChildren();legend.replaceChildren();table.replaceChildren();
 if(keys.length<2){status.textContent='Selecione pelo menos dois indicadores para cruzar.';return;}
 const user=$('usuario').value;
 if(!user){status.textContent='Selecione um usuário.';return;}
 status.textContent='Consultando sono, alimentação e atividade física…';
 const dates=dateSeries(days),previousEnd=dayOffset(dates[dates.length-1],-1);
 const needsEnergy=keys.some(k=>['calorias','passos','caloriasAtivas','caloriasPassos'].includes(k));
 const needsNutrition=keys.some(k=>['proteinas','carboidratos','gorduras'].includes(k));
 const needsActivity=keys.includes('treinos');
 const base='/avn/sistema/api/balanco-energetico/';
 const calls=[
  nightsFor(days),
  needsEnergy?getJSON(base+encodeURIComponent(user)+'?data='+previousEnd+'&dias='+days):Promise.resolve(null),
  needsNutrition?getJSON(base+'nutricao-comparacao/'+encodeURIComponent(user)+'?data='+previousEnd+'&dias='+days):Promise.resolve(null),
  needsActivity?getJSON('/api/avn/health/usuarios/'+encodeURIComponent(user)+'/atividades?dias='+(days+3)):Promise.resolve(null)
 ];
 const result=await Promise.allSettled(calls);
 if(token!==crossToken||!$('dialog-compare').open)return;
 if(result[0].status!=='fulfilled'){
  status.classList.add('error');status.textContent='Falha ao consultar sono: '+(result[0].reason?.message||'erro');
  return;
 }
 const sleep=new Map(dailySleep(result[0].value,dates).map(x=>[x.date,x]));
 const energy=new Map((result[1].status==='fulfilled'?result[1].value?.dias:[])?.map(x=>[x.data,x])||[]);
 const nutrition=result[2].status==='fulfilled'?result[2].value?.series:{};
 const nutrientMaps={};
 for(const key of ['proteinas','carboidratos','gorduras'])
  nutrientMaps[key]=new Map((nutrition?.[key]||[]).filter(p=>goodNumber(p.value)).map(p=>[p.data,Number(p.value)]));
 const sessions=new Map();
 if(result[3].status==='fulfilled'&&Array.isArray(result[3].value)){
  for(const s of result[3].value){
   const date=isoLocal(s.inicio);
   sessions.set(date,(sessions.get(date)||0)+1);
  }
 }
 const rows=dates.map(date=>{
  const wake=sleep.get(date),prior=dayOffset(date,-1),e=energy.get(prior);
  const values={};
  for(const key of keys){
   if(compareMetrics[key].sleep)values[key]=wake?.has?wake[key]:null;
   else if(key==='calorias')values[key]=e?.ingestao?.itens>0&&e.ingestao.incompletos===0&&goodNumber(e.ingestao.valor)?Number(e.ingestao.valor):null;
   else if(key==='passos')values[key]=goodNumber(e?.passos?.valor)?Number(e.passos.valor):null;
   else if(key==='caloriasAtivas')values[key]=e?.calorias_ativas&&!e.calorias_ativas.sem_registros&&goodNumber(e.calorias_ativas.valor)?Number(e.calorias_ativas.valor):null;
   else if(key==='caloriasPassos')values[key]=e?.calorias_passos&&!e.calorias_passos.sem_registros&&goodNumber(e.calorias_passos.valor)?Number(e.calorias_passos.valor):null;
   else if(key==='treinos')values[key]=sessions.has(prior)?sessions.get(prior):null;
   else values[key]=nutrientMaps[key]?.get(prior)??null;
  }
  return {date,prior,values};
 });
 for(const key of keys){
  const span=element('span');const dot=element('i');dot.style.backgroundColor=compareMetrics[key].color;
  span.append(dot,document.createTextNode(compareMetrics[key].name));legend.append(span);
 }
 plotCross(rows,keys);
 tableFromRows(table,['Sono (despertar)','Hábitos do dia',...keys.map(k=>compareMetrics[k].name)],
  [...rows].reverse().map(r=>[longDate(r.date),longDate(r.prior),...keys.map(k=>valueLabel(r.values[k],compareMetrics[k].unit))]),true);
 const paired=rows.filter(r=>keys.every(key=>goodNumber(r.values[key]))).length;
 const errors=[];
 if(needsEnergy&&result[1].status!=='fulfilled')errors.push('balanço energético');
 if(needsNutrition&&result[2].status!=='fulfilled')errors.push('nutrição');
 if(needsActivity&&result[3].status!=='fulfilled')errors.push('sessões de atividade');
 status.textContent=paired+' de '+days+' dia(s) com todos os indicadores selecionados. '+(errors.length?'Fontes indisponíveis: '+errors.join(', ')+'. ':'')+'Dias sem registro não entram como zero.';
}

function render(nights,keepSelected=false){
  let selected=$('dia-sono').value;
  if(!keepSelected&&nights.length&&!nights.some(n=>isoLocal(n.end)===selected)){
    selected=isoLocal(nights[0].end);
    $('dia-sono').value=selected;
  }
  if(!nights.length&&!keepSelected){selected='';$('dia-sono').value='';}
  const escolhidas=nights.filter(n=>isoLocal(n.end)===selected);
  latestNight(escolhidas);
  setStats(nights);
  drawChart('chart-duration',nights,'duration');
  drawChart('chart-score',nights,'score');
  const history=$('history');history.replaceChildren();
  if(!nights.length){
    history.append(element('div','no-records','Nenhuma noite encontrada. Faça a leitura e o envio pelo AVN Android.'));
    return;
  }
  const fragment=document.createDocumentFragment();
  for(const night of nights)fragment.append(makeNight(night));
  history.append(fragment);
}
async function refresh(){
  stageCache.clear();
  for(const code of ['LIGHT','DEEP','REM'])phaseTokens[code]++;
  crossToken++;
  const user=$('usuario').value;
  if(controller)controller.abort();
  controller=new AbortController();
  const signal=controller.signal,job=++sequence;
  $('reload').disabled=true;
  $('status').classList.remove('error');
  if(!user){
    $('status').textContent='Selecione um usuário cadastrado.';
    render([]);
    $('reload').disabled=false;
    return;
  }
  $('status').textContent='Consultando o histórico de sono…';
  try{
    const days=$('dias').value;
    const result=await getJSON('/api/avn/health/usuarios/'+encodeURIComponent(user)+'/sono?dias='+encodeURIComponent(days),signal);
    if(signal.aborted||job!==sequence)return;
    if(!Array.isArray(result.noites))throw new Error('Resposta de sono inesperada do servidor.');
    const nights=result.noites.map(prepare).filter(Boolean).sort((a,b)=>new Date(b.start)-new Date(a.start));
    currentNights=nights;
    render(nights);
    for(const code of ['LIGHT','DEEP','REM'])if($('dialog-stage-'+code).open)updateStage(code);
    if($('dialog-compare').open)updateCross();
    $('status').textContent=nights.length?nights.length+' noite(s) sincronizada(s) no período.':'Nenhum registro enviado ao AVN Web neste período.';
  }catch(error){
    if(signal.aborted||job!==sequence)return;
    currentNights=[];
    render([]);
    $('status').classList.add('error');
    $('status').textContent=error.message||'Erro ao consultar o histórico de sono.';
  }finally{
    if(job===sequence)$('reload').disabled=false;
  }
}
async function init(){
  $('usuario').addEventListener('change',refresh);
  $('dias').addEventListener('change',refresh);
  $('reload').addEventListener('click',refresh);
  for(const [buttonId,dialogId] of [['open-history','dialog-history'],['open-charts','dialog-charts'],['open-averages','dialog-averages']]){
    $(buttonId).addEventListener('click',()=>$(dialogId).showModal());
    const dialog=$(dialogId);
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  }
  for(const code of ['LIGHT','DEEP','REM']){
    const dialog=$('dialog-stage-'+code);
    dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    $('stage-period-'+code).addEventListener('change',()=>updateStage(code));
  }
  const crossDialog=$('dialog-compare');
  $('open-compare').addEventListener('click',()=>{crossDialog.showModal();updateCross();});
  crossDialog.querySelector('[data-close]').addEventListener('click',()=>crossDialog.close());
  crossDialog.addEventListener('click',event=>{if(event.target===crossDialog)crossDialog.close();});
  $('compare-period').addEventListener('change',updateCross);
  document.querySelectorAll('input[data-sleep-compare]').forEach(check=>check.addEventListener('change',updateCross));
  $('dia-sono').max=isoLocal(new Date());
  $('dia-sono').addEventListener('change',()=>{
    render(currentNights,true);
    const selected=$('dia-sono').value;
    const count=currentNights.filter(n=>isoLocal(n.end)===selected).length;
    $('status').textContent=count?count+' registro(s) de sono na data '+selected.split('-').reverse().join('/')+'.':'Nenhum registro de sono na data escolhida neste período.';
  });
  try{
    const users=await getJSON('/api/avn/usuarios');
    if(!Array.isArray(users))throw new Error('Resposta inesperada da lista de usuários.');
    const select=$('usuario');select.replaceChildren();
    for(const user of users){
      const option=document.createElement('option');
      option.value=String(user.id);
      option.textContent=String(user.nome||'Usuário '+user.id);
      select.append(option);
    }
    if(!users.length){$('status').textContent='Cadastre um usuário no AVN para consultar o sono.';render([]);return;}
    await refresh();
  }catch(error){
    $('status').classList.add('error');
    $('status').textContent=error.message||'Erro ao carregar usuários.';
  }
}
document.addEventListener('DOMContentLoaded',init);
})();