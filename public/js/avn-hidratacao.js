(()=>{'use strict';
const $=id=>document.getElementById(id),api='/avn/sistema/api/hidratacao';
let uid='',dias=7,registros=[],busy=false;
const today=()=>dateOf(new Date());
const dateOf=value=>{const parts=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(new Date(value));const get=k=>parts.find(x=>x.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');};
const fmt=n=>Number(n).toLocaleString('pt-BR');
function warn(s,error=false){const e=$('aguaAlerta');e.hidden=false;e.textContent=s;e.className='avn-alert'+(error?' error':'');clearTimeout(warn.t);warn.t=setTimeout(()=>e.hidden=true,5500);}
async function request(path,method='GET',body){const r=await fetch(api+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.erro||'Falha na comunicação com o AVN.');return data;}
function render(){
 const total=registros.filter(r=>dateOf(r.ingerido_em)===today()).reduce((sum,r)=>sum+Number(r.quantidade_ml),0);
 $('aguaHoje').textContent=fmt(total)+' ml';
 const selected=$('aguaData').value||today();
 const rows=registros.filter(r=>dateOf(r.ingerido_em)===selected);
 const lista=$('aguaLista');lista.replaceChildren();
 if(!rows.length){const p=document.createElement('p');p.className='muted';p.textContent='Nenhum registro nesta data.';lista.append(p);}
 for(const row of rows){
  const div=document.createElement('div');div.className='list-row';
  const left=document.createElement('div'),name=document.createElement('span'),small=document.createElement('small');
  name.className='name';name.textContent=fmt(row.quantidade_ml)+' ml';
  small.textContent=new Date(row.ingerido_em).toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
  left.append(name,small);
  const actions=document.createElement('div');actions.className='agua-registro-acoes';
  const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent='Editar';
  edit.onclick=async()=>{const next=prompt('Nova quantidade em mililitros:',String(row.quantidade_ml));if(next===null)return;
   const ml=Number(next);if(!Number.isInteger(ml)||ml<1||ml>10000)return warn('Informe entre 1 e 10.000 ml.',true);
   try{await request('/'+row.id,'PUT',{usuarioId:uid,quantidade_ml:ml,ingerido_em:row.ingerido_em});await load();warn('Registro atualizado.');}catch(e){warn(e.message,true);}
  };
  const del=document.createElement('button');del.type='button';del.className='delete';del.textContent='Excluir';
  del.onclick=async()=>{if(!confirm('Excluir o registro de '+fmt(row.quantidade_ml)+' ml?'))return;
   try{await request('/'+row.id+'?usuarioId='+encodeURIComponent(uid),'DELETE');await load();warn('Registro excluído.');}catch(e){warn(e.message,true);}
  };
  actions.append(edit,del);div.append(left,actions);lista.append(div);
 }
 draw();
}
function draw(){
 const sums={};registros.forEach(r=>{const day=dateOf(r.ingerido_em);sums[day]=(sums[day]||0)+Number(r.quantidade_ml);});
 const dates=Array.from({length:dias},(_,i)=>{const delta=dias-1-i;const d=new Date(today()+'T12:00:00-03:00');d.setUTCDate(d.getUTCDate()-delta);return dateOf(d);});
 const max=Math.max(1000,...dates.map(x=>sums[x]||0)),graph=$('aguaGrafico');graph.replaceChildren();
 const bars=document.createElement('div');bars.className='agua-barras';bars.style.minWidth=Math.max(0,dates.length*22)+'px';
 for(const date of dates){const ml=sums[date]||0;const col=document.createElement('div');col.className='agua-bar-dia';col.title=date.split('-').reverse().join('/')+': '+fmt(ml)+' ml';
 const bar=document.createElement('span');bar.className='coluna';bar.style.height=Math.max(2,ml/max*170)+'px';
 const label=document.createElement('span');label.className='eixo';label.textContent=(dias>30?date.slice(8):date.slice(8)+'/'+date.slice(5,7));
 col.append(bar,label);bars.append(col);}
 graph.append(bars);
}
async function load(){if(!uid)return;const res=await request('/?usuarioId='+encodeURIComponent(uid)+'&dias=90');registros=res.registros||[];render();}
async function add(ml){if(busy||!uid)return;busy=true;
 try{await request('/','POST',{usuarioId:uid,quantidade_ml:ml,ingerido_em:new Date().toISOString()});await load();warn(fmt(ml)+' ml registrados.');}
 catch(e){warn(e.message,true);}finally{busy=false;}
}
async function init(){
 $('aguaData').value=today();
 for(const button of document.querySelectorAll('[data-ml]'))button.onclick=()=>add(Number(button.dataset.ml));
 for(const button of document.querySelectorAll('[data-dias]'))button.onclick=()=>{dias=Number(button.dataset.dias);document.querySelectorAll('[data-dias]').forEach(x=>x.setAttribute('aria-pressed',String(x===button)));draw();};
 document.querySelector('[data-dias="7"]').click();
 $('aguaData').onchange=render;
 $('aguaForm').onsubmit=e=>{e.preventDefault();const n=Number($('aguaMl').value);if(!Number.isInteger(n)||n<1||n>10000)return warn('Quantidade inválida.',true);add(n);$('aguaMl').value='';};
 try{
  const r=await fetch('/api/avn/usuarios',{credentials:'same-origin'});if(!r.ok)throw Error('Não foi possível carregar usuários.');const users=await r.json();
  const remembered=localStorage.getItem('avn_nutricao_usuario')||localStorage.getItem('avn_treinos_usuario')||'';
  uid=String(users.find(u=>String(u.id)===remembered)?.id||users[0]?.id||'');
  const sel=$('aguaUsuario');sel.replaceChildren(new Option('Selecione usuário',''));
  users.forEach(u=>sel.add(new Option(u.nome,u.id)));sel.value=uid;
  sel.onchange=()=>{uid=sel.value;localStorage.setItem('avn_nutricao_usuario',uid);load().catch(e=>warn(e.message,true));};
  if(uid)await load();else warn('Cadastre um usuário na Central AVN.',true);
 }catch(e){warn(e.message,true);}
}
init();
})();
