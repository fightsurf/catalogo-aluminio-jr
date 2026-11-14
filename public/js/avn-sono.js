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
const minutesFormat=value => value==null?'Não informado':Math.floor(value/60)+'h '+String(Math.round(value%60)).padStart(2,'0')+'min';
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
    hasStages:segments.length>0
  };
}
function setStats(nights){
  // Somente dados da data selecionada. Nunca calcular médias de dias diferentes.
  const total=key=>nights.reduce((sum,n)=>sum+(n[key]===null?0:n[key]),0);
  const duracoes=nights.filter(n=>n.duration!==null);
  const comFases=nights.filter(n=>n.hasStages);
  const pontuada=nights.find(n=>n.score!==null);
  $('duracao').textContent=duracoes.length?minutesFormat(total('duration')):'—';
  $('pontuacao').textContent=pontuada?String(pontuada.score):'—';
  for(const [id,tipo] of [['leve','LIGHT'],['profundo','DEEP'],['rem','REM']]){
    $(''+id).textContent=comFases.length?minutesFormat(comFases.reduce((sum,n)=>sum+n.totals[tipo],0)):'—';
  }
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
  times.append(element('strong','',night.duration===null?'Duração não informada':minutesFormat(night.duration)+' · Duração informada'));
  const inBed=elapsed(night.start,night.end);
  if(inBed!==null)times.append(element('span','',minutesFormat(inBed)+' · Intervalo entre início e fim'));
  hero.append(rating,times);
  host.append(hero);
  const asleep=night.hasStages?night.totals.LIGHT+night.totals.DEEP+night.totals.REM:null;
  if(asleep!==null)host.append(element('p','latest-asleep','Tempo nas fases de sono registradas: '+minutesFormat(asleep)));
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
    phases.append(tile);
  }
  host.append(phases);
}

function drawChart(target,rows,field,unit){
  const host=$(target);host.replaceChildren();
  // Limite visual: evita centenas de pontos comprimidos. Os totais usam todo o período.
  const data=rows.filter(n=>n[field]!==null).slice(0,45).reverse();
  if(!data.length){
    host.append(element('div','empty','Sem registros com '+(field==='score'?'pontuação':'duração')+' neste período.'));
    return;
  }
  const ns='http://www.w3.org/2000/svg',W=900,H=250,L=50,R=12,T=18,B=44;
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 '+W+' '+H);
  svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('role','img');
  svg.setAttribute('aria-label',field==='score'?'Evolução das pontuações por noite':'Evolução das horas dormidas por noite');
  const add=(tag,attributes,label)=>{
    const node=document.createElementNS(ns,tag);
    for(const [key,value]of Object.entries(attributes||{}))node.setAttribute(key,String(value));
    if(label!==undefined)node.textContent=label;
    svg.append(node);
    return node;
  };
  const values=data.map(n=>field==='duration'?n.duration/60:n.score);
  const max=field==='score'?100:Math.max(9,Math.ceil(Math.max(...values)+1));
  const width=(W-L-R)/data.length;
  const y=value=>T+(max-value)/max*(H-T-B);
  const color=field==='duration'?'#60a5fa':'#2dd4bf';
  for(let tick=0;tick<=4;tick++){
    const val=max*tick/4,yy=y(val);
    add('line',{x1:L,y1:yy,x2:W-R,y2:yy,stroke:'#34465f','stroke-width':1});
    add('text',{x:L-8,y:yy+4,fill:'#b5c6dc','font-size':12,'text-anchor':'end'},val.toLocaleString('pt-BR',{maximumFractionDigits:1}));
  }
  const step=Math.max(1,Math.ceil(data.length/7));
  data.forEach((n,i)=>{
    const value=values[i],x=L+i*width+Math.max(1,width*.12),bw=Math.max(2,width*.76),yy=y(value);
    const rect=add('rect',{x,y:yy,width:bw,height:Math.max(1,H-B-yy),rx:Math.min(4,bw/3),fill:color});
    const tip=document.createElementNS(ns,'title');
    tip.textContent=day(n.start)+' · '+(field==='duration'?minutesFormat(n.duration):String(value)+' pontos');
    rect.append(tip);
    if(i%step===0||i===data.length-1){
      add('text',{x:L+i*width+width/2,y:H-15,fill:'#a9b9d1','font-size':11,'text-anchor':'middle'},day(n.start));
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
    ['Duração',minutesFormat(n.duration)],
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
function render(nights,keepSelected=false){
  let selected=$('dia-sono').value;
  if(!keepSelected&&nights.length&&!nights.some(n=>isoLocal(n.end)===selected)){
    selected=isoLocal(nights[0].end);
    $('dia-sono').value=selected;
  }
  if(!nights.length&&!keepSelected){selected='';$('dia-sono').value='';}
  const escolhidas=nights.filter(n=>isoLocal(n.end)===selected);
  latestNight(escolhidas);
  setStats(escolhidas);
  drawChart('chart-duration',nights,'duration','h');
  drawChart('chart-score',nights,'score','pontos');
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
    $('status').textContent=nights.length?nights.length+' noite(s) sincronizada(s) no período. Gráficos exibem no máximo 45 noites recentes.':'Nenhum registro enviado ao AVN Web neste período.';
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