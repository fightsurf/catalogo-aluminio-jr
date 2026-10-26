(()=>{'use strict';
const $=id=>document.getElementById(id),API='/avn/sistema/api/nutricao';let alimentos=[],nutrientes=[],receitas=[],editId=null,usuarioId='';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,options={}){const r=await fetch(API+url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});const x=await r.json().catch(()=>({}));if(!r.ok)throw Error(x.erro||'Falha no servidor.');return x;}
function alertar(t,e=false){$('alerta').hidden=false;$('alerta').textContent=t;$('alerta').className='avn-alert'+(e?' error':'');}
function opcoes(id){return '<option value="">Escolha o alimento</option>'+alimentos.filter(f=>f.fonte!=='receita').map(f=>`<option value="${f.id}" ${String(id)===String(f.id)?'selected':''}>${esc(f.nome)}${f.preparo?' · '+esc(f.preparo):''}</option>`).join('');}
function addRow(id='',g=''){const linha=document.createElement('div');linha.className='receita-linha';linha.innerHTML=`<label class="avn-field">Alimento<select class="ingrediente" required>${opcoes(id)}</select></label><label class="avn-field">Peso (g)<input class="gramas" type="number" min="0.001" max="10000" step="any" required value="${esc(g)}"></label><button class="secondary remover" type="button">Remover</button>`;linha.querySelector('.remover').onclick=()=>{linha.remove();soma()};linha.querySelector('.gramas').oninput=soma;$('ingredientes').appendChild(linha);soma();}
let importacaoRevision=0,importacaoPendente=false;
function limparImportador(){
 importacaoRevision++;
 $('textoReceita').value='';
 $('revisaoImportacao').replaceChildren();
 $('revisaoImportacao').hidden=true;
 $('aplicarImportacao').hidden=true;
 $('statusImportacao').textContent='';
}
function renderImportacao(itens){
 const area=$('revisaoImportacao');area.replaceChildren();
 for(const item of itens){
  const peso=Number(item.gramas);
  const valido=Number.isFinite(peso)&&peso>0&&peso<=10000;
  const confiavel=item.confianca==='alta'&&!!item.alimento_id&&valido;
  const linha=document.createElement('div');
  linha.className='importador-item'+(confiavel?'':' revisar');
  linha.innerHTML=`<p class="linha-original">${esc(item.linha)}</p>
    <label class="incluir"><input class="incluir-review" type="checkbox" ${confiavel?'checked':''}> Incluir</label>
    <label class="avn-field">Alimento do cadastro<select class="alim-review">${opcoes(item.alimento_id)}</select></label>
    <label class="avn-field campo-peso">Peso estimado (g)<input class="peso-review" type="number" min="0.001" max="10000" step="any" value="${valido?esc(peso):''}" placeholder="${peso>10000?esc(String(peso))+' g suspeitos':''}"></label>
    <p class="obs">${esc(item.observacao||'Confira alimento e peso.')} ${!valido?'Informe peso válido até 10.000 g.':''}</p>`;
  area.appendChild(linha);
 }
 area.hidden=false;
 $('aplicarImportacao').hidden=false;
 $('statusImportacao').textContent=itens.length+' ingrediente(s) identificados. Confira os itens marcados e os pesos antes de adicionar.';
}
async function interpretarReceita(){
 if(importacaoPendente)return;
 const texto=$('textoReceita').value.trim();
 if(!texto){$('statusImportacao').textContent='Cole os ingredientes, um por linha.';return;}
 if(!usuarioId){$('statusImportacao').textContent='Selecione um usuário.';return;}
 const r=++importacaoRevision;const usuario=usuarioId;
 $('revisaoImportacao').hidden=true;$('aplicarImportacao').hidden=true;
 importacaoPendente=true;$('interpretarReceita').disabled=true;
 $('statusImportacao').textContent='Interpretando e comparando os alimentos do cadastro…';
 try{
  const result=await api('/receitas/interpretar',{
   method:'POST',body:JSON.stringify({usuarioId:usuario,texto})
  });
  if(r!==importacaoRevision||usuario!==usuarioId||texto!==$('textoReceita').value.trim())return;
  if(!Array.isArray(result.itens))throw Error('A IA não retornou ingredientes.');
  renderImportacao(result.itens);
 }catch(e){if(r===importacaoRevision)$('statusImportacao').textContent=e.message;}
 finally{importacaoPendente=false;$('interpretarReceita').disabled=false;}
}
function aplicarImportacao(){
 const rows=[...$('revisaoImportacao').querySelectorAll('.importador-item')];
 const escolhidos=rows.filter(l=>l.querySelector('.incluir-review').checked);
 if(!escolhidos.length){$('statusImportacao').textContent='Marque ao menos um ingrediente para incluir.';return;}
 if(document.querySelectorAll('.receita-linha').length+escolhidos.length>60){
  $('statusImportacao').textContent='Limite de 60 ingredientes por receita. Remova ingredientes antes de continuar.';return;
 }
 const itens=[];
 for(const linha of escolhidos){
  const alimento=linha.querySelector('.alim-review').value;
  const peso=Number(linha.querySelector('.peso-review').value);
  if(!alimento||!Number.isFinite(peso)||peso<=0||peso>10000){
   $('statusImportacao').textContent='Corrija o alimento e peso (até 10.000 g) de todos os itens marcados.';
   linha.classList.add('revisar');return;
  }
  itens.push({alimento,peso});
 }
 // Descartar somente a linha vazia inicial; nunca substituir ingredientes preenchidos.
 const anteriores=[...$('ingredientes').querySelectorAll('.receita-linha')];
 if(anteriores.length===1&&!anteriores[0].querySelector('select').value&&!anteriores[0].querySelector('.gramas').value)anteriores[0].remove();
 for(const item of itens)addRow(item.alimento,item.peso);
 $('revisaoImportacao').hidden=true;$('aplicarImportacao').hidden=true;
 $('textoReceita').value='';
 $('statusImportacao').textContent=itens.length+' ingrediente(s) acrescentados. Confira a lista antes de salvar a receita.';
 soma();
}
function soma(){const n=[...document.querySelectorAll('.gramas')].reduce((a,e)=>a+(Number(e.value)||0),0);$('soma').textContent='Peso total dos ingredientes: '+n.toLocaleString('pt-BR',{maximumFractionDigits:3})+' g';}
function payload(){const itens=[...document.querySelectorAll('.receita-linha')].map(l=>({alimento_id:l.querySelector('select').value,quantidade_g:l.querySelector('.gramas').value}));if(!itens.length)throw Error('Adicione pelo menos um ingrediente.');return {usuarioId,nome:$('nome').value,preparo:$('preparo').value,rendimento_g:$('rendimento').value,ingredientes:itens};}
function comp(f){return {kcal:f.kcal_100g,proteinas_g:f.proteinas_g_100g,carboidratos_g:f.carboidratos_g_100g,gorduras_g:f.gorduras_g_100g,fibras_g:f.fibras_g_100g,micros:f.micronutrientes_100g||{}};}
function calcLocal(data){const rows=data.ingredientes.map(i=>({quantidade_g:Number(i.quantidade_g),composicao_100g:comp(alimentos.find(f=>String(f.id)===String(i.alimento_id))||{})}));const renda=Number(data.rendimento_g);if(!(renda>0))throw Error('Informe o peso final pronto.');const out={};const keys=[['kcal','Energia','kcal'],['proteinas_g','Proteínas','g'],['carboidratos_g','Carboidratos','g'],['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g'],...nutrientes.map(n=>[n.codigo,n.nome,n.unidade])];for(const [key,label,unit] of keys){let sum=0,ok=true;for(const r of rows){const v=key in r.composicao_100g?r.composicao_100g[key]:r.composicao_100g.micros[key];if(v===null||v===undefined||v===''){ok=false;continue;}sum+=Number(v)*r.quantidade_g/100;}out[key]={label,unit,val:ok?sum*100/renda:null};}return out;}
function resultado(o){$('resultado').innerHTML='<h3>Composição estimada por 100 g da receita pronta</h3><table><thead><tr><th>Nutriente</th><th>Valor</th></tr></thead><tbody>'+Object.values(o).map(x=>`<tr><td>${esc(x.label)}</td><td>${x.val==null?'<span class="muted">Sem dado</span>':Number(x.val).toLocaleString('pt-BR',{maximumFractionDigits:3})+' '+esc(x.unit)}</td></tr>`).join('')+'</tbody></table>';$('resultado').scrollIntoView({behavior:'smooth',block:'nearest'});}
async function listar(){receitas=await api('/receitas?usuarioId='+usuarioId);$('listaReceitas').innerHTML=receitas.length?receitas.map(r=>`<div class="list-row"><div><strong>${esc(r.nome)}</strong><small>Rendimento ${Number(r.rendimento_g).toLocaleString('pt-BR')} g · ${r.kcal_100g==null?'calorias desconhecidas':Number(r.kcal_100g).toLocaleString('pt-BR',{maximumFractionDigits:1})+' kcal/100 g'}</small></div><button type="button" class="secondary" data-id="${r.id}">Editar</button></div>`).join(''):'<p class="muted">Nenhuma receita cadastrada.</p>';$('listaReceitas').querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>editar(b.dataset.id));}
function nova(){limparImportador();editId=null;$('titulo').textContent='Nova receita';$('nome').value='';$('preparo').value='';$('rendimento').value='';$('ingredientes').innerHTML='';$('resultado').innerHTML='';addRow();}
async function editar(id){try{const r=await api('/receitas/'+id+'?usuarioId='+usuarioId);limparImportador();editId=id;$('titulo').textContent='Editar receita';$('nome').value=r.nome;$('preparo').value=r.preparo||'';$('rendimento').value=r.rendimento_g;$('ingredientes').innerHTML='';r.ingredientes.forEach(i=>addRow(i.alimento_id,i.quantidade_g));$('resultado').innerHTML='';}catch(e){alertar(e.message,true)}}
async function init(){try{const r=await fetch('/api/avn/usuarios',{credentials:'same-origin'});if(!r.ok)throw Error('Erro ao buscar usuários.');const users=await r.json();$('usuario').innerHTML=users.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('');const stored=localStorage.getItem('avn_treinos_usuario');$('usuario').value=users.some(u=>String(u.id)===stored)?stored:users[0]?.id||'';$('usuario').onchange=()=>carregar();$('nova').onclick=nova;$('adicionar').onclick=()=>addRow();$('interpretarReceita').onclick=interpretarReceita;$('aplicarImportacao').onclick=aplicarImportacao;$('textoReceita').oninput=()=>{importacaoRevision++;$('revisaoImportacao').hidden=true;$('aplicarImportacao').hidden=true;$('statusImportacao').textContent='';};$('calcular').onclick=()=>{try{resultado(calcLocal(payload()))}catch(e){alertar(e.message,true)}};$('form').onsubmit=async e=>{e.preventDefault();try{const body=payload();await api('/receitas'+(editId?'/'+editId:''),{method:editId?'PUT':'POST',body:JSON.stringify(body)});alertar('Receita salva. Ela já está disponível na Dieta programada e no Diário alimentar.');await carregar();}catch(err){alertar(err.message,true)}};await carregar();}catch(e){alertar(e.message,true)}}
async function carregar(){usuarioId=$('usuario').value;if(!usuarioId)return;nova();alimentos=await api('/receitas/catalogo?usuarioId='+usuarioId);nutrientes=(await api('/nutrientes')).micros;await listar();}
init();})();
