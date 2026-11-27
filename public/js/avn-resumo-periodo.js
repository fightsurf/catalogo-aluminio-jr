(()=>{'use strict';
// Datas de calendário do AVN (Brasília), e não deslocamentos de 24 h do momento atual.
const timezone='America/Sao_Paulo';
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'});
const fmt=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const valido=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
function dia(valor){
 if(typeof valor==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(valor))return valor;
 if(valor===null||valor===undefined||valor==='')return '';
 const d=new Date(valor);if(!Number.isFinite(d.getTime()))return '';
 const partes=dateFormat.formatToParts(d),p=k=>partes.find(x=>x.type===k)?.value;
 return p('year')+'-'+p('month')+'-'+p('day');
}
function periodo(dias,fim=dia(new Date())){
 const n=Math.max(1,Math.trunc(Number(dias)||7));
 const d=new Date(fim+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()-n+1);
 return {inicio:d.toISOString().slice(0,10),fim};
}
function extremos(rows,inicio,fim){
 const porDia=new Map();
 for(const r of Array.isArray(rows)?rows:[]){
  if(!valido(r.value))continue;
  const data=dia(r.data??r.date??r.time);
  if(!data||data<inicio||data>fim)continue;
  const t=Number.isFinite(r.time)?r.time:Date.parse(r.date??data);
  const anterior=porDia.get(data);
  if(!anterior||t>=anterior.t)porDia.set(data,{value:Number(r.value),t,nota:r.nota||''});
 }
 const inicial=porDia.get(inicio)||null,final=porDia.get(fim)||null;
 return {inicial,final,variacao:inicial&&final?inicial.value-final.value:null};
}
function duracao(v){
 const total=Math.round(Math.abs(v)*60);
 return Math.floor(total/60)+'h '+String(total%60).padStart(2,'0')+'min';
}
function formatar(v,unidade,variacao=false){
 if(!valido(v))return 'Sem registro';
 const n=Number(v),arred=unidade==='h'?Math.round(Math.abs(n)*60):Math.round(Math.abs(n)*100);
 const sinal=arred===0?'':n<0?'−':variacao?'+':'';
 if(unidade==='h')return sinal+duracao(n);
 const u=variacao&&unidade==='%'?'p.p.':unidade;
 return sinal+fmt.format(Math.abs(n))+(u?' '+u:'');
}
function dataBR(d){return d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4);}
function painel(area){
 if(!area?.id)return null;
 const id=area.id+'-resumo-periodo';
 let el=document.getElementById(id);
 if(!el){
  el=document.createElement('div');el.id=id;el.className='avn-resumo-periodo';
  el.setAttribute('aria-label','Resumo dos extremos do período');
  area.insertAdjacentElement('afterend',el);
 }
 return el;
}
function limpar(area){
 const el=area?.id&&document.getElementById(area.id+'-resumo-periodo');
 if(el){el.replaceChildren();el.hidden=true;}
}
function desenhar(area,series,p){
 const el=painel(area);if(!el)return;
 el.replaceChildren();el.hidden=!series.length;
 for(const serie of series){
  const {inicial,final,variacao}=extremos(serie.rows,p.inicio,p.fim);
  const linha=document.createElement('section');linha.className='avn-resumo-linha';
  if(serie.nome){
   const titulo=document.createElement('strong');titulo.className='avn-resumo-nome';titulo.textContent=serie.nome;
   if(serie.cor)titulo.style.color=serie.cor;
   linha.append(titulo);
  }
  const grid=document.createElement('div');grid.className='avn-resumo-grid';
  const arredondado=variacao===null?null:Math.round(Math.abs(variacao)*(serie.unidade==='h'?60:100));
  const direcao=variacao===null?'Dados insuficientes':arredondado===0?'Sem variação':variacao>0?'Redução':'Aumento';
  const itens=[
   ['Início · '+dataBR(p.inicio),inicial?formatar(inicial.value,serie.unidade):'Sem registro',inicial?.nota],
   ['Fim · '+dataBR(p.fim),final?formatar(final.value,serie.unidade):'Sem registro',final?.nota],
   ['Variação (início − fim)',variacao===null?'—':formatar(variacao,serie.unidade,true),direcao]
  ];
  for(const [rotulo,valor,nota] of itens){
   const cel=document.createElement('div');cel.className='avn-resumo-item';
   const label=document.createElement('small');label.textContent=rotulo;
   const value=document.createElement('strong');value.textContent=valor;
   cel.append(label,value);
   if(nota){const obs=document.createElement('small');obs.textContent=nota;cel.append(obs);}
   grid.append(cel);
  }
  linha.append(grid);el.append(linha);
 }
}
window.AVNResumoPeriodo={dia,periodo,extremos,formatar,desenhar,limpar};
})();
