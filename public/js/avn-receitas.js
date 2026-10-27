(()=>{'use strict';
const $=id=>document.getElementById(id),API='/avn/sistema/api/nutricao';let alimentos=[],nutrientes=[],receitas=[],editId=null,usuarioId='';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,options={}){const r=await fetch(API+url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...options});const x=await r.json().catch(()=>({}));if(!r.ok)throw Error(x.erro||'Falha no servidor.');return x;}
function alertar(t,e=false){$('alerta').hidden=false;$('alerta').textContent=t;$('alerta').className='avn-alert'+(e?' error':'');}
function opcoes(id){return '<option value="">Escolha um alimento ou receita</option>'+alimentos.filter(f=>f.fonte!=='receita'||String(f.usuario_id)===String(usuarioId)).filter(f=>!editId||!receitas.some(r=>String(r.id)===String(editId)&&String(r.alimento_id)===String(f.id))).map(f=>`<option value="${f.id}" ${String(id)===String(f.id)?'selected':''}>${f.fonte==='receita'?'📖 Receita · ':''}${esc(f.nome)}${f.preparo?' · '+esc(f.preparo):''}</option>`).join('');}
function addRow(id='',g=''){const linha=document.createElement('div');linha.className='receita-linha';linha.innerHTML=`<label class="avn-field">Alimento ou receita<select class="ingrediente" required>${opcoes(id)}</select></label><label class="avn-field">Peso (g)<input class="gramas" type="number" min="0.001" max="10000" step="any" required value="${esc(g)}"></label><button class="secondary remover" type="button">Remover</button>`;linha.querySelector('.remover').onclick=()=>{linha.remove();soma()};linha.querySelector('.gramas').oninput=soma;$('ingredientes').appendChild(linha);soma();}
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
  // Se todos os alimentos e pesos forem confiáveis, aplicar imediatamente.
  // Itens ambíguos permanecem disponíveis para revisão manual.
  if(result.itens.length&&result.itens.every(i=>i.confianca==='alta'&&i.alimento_id&&Number(i.gramas)>0&&Number(i.gramas)<=10000))aplicarImportacao();
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
 if($('modalImportacaoReceita').open)$('modalImportacaoReceita').close();
}
function soma(){const n=[...document.querySelectorAll('.gramas')].reduce((a,e)=>a+(Number(e.value)||0),0);$('soma').textContent='Peso total dos ingredientes: '+n.toLocaleString('pt-BR',{maximumFractionDigits:3})+' g';}
function payload(){const itens=[...document.querySelectorAll('.receita-linha')].map(l=>({alimento_id:l.querySelector('select').value,quantidade_g:l.querySelector('.gramas').value}));if(!itens.length)throw Error('Adicione pelo menos um ingrediente.');return {usuarioId,nome:$('nome').value,preparo:$('preparo').value,rendimento_g:$('rendimento').value,ingredientes:itens};}
function comp(f){return {kcal:f.kcal_100g,proteinas_g:f.proteinas_g_100g,carboidratos_g:f.carboidratos_g_100g,gorduras_g:f.gorduras_g_100g,fibras_g:f.fibras_g_100g,micros:f.micronutrientes_100g||{},micros_parciais:f.micronutrientes_parciais||{}};}
function calcLocal(data){const rows=data.ingredientes.map(i=>({quantidade_g:Number(i.quantidade_g),composicao_100g:comp(alimentos.find(f=>String(f.id)===String(i.alimento_id))||{})}));const renda=Number(data.rendimento_g);if(!(renda>0))throw Error('Informe o peso final pronto.');const out={};const keys=[['kcal','Energia','kcal'],['proteinas_g','Proteínas','g'],['carboidratos_g','Carboidratos','g'],['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g'],...nutrientes.map(n=>[n.codigo,n.nome,n.unidade])];for(const [key,label,unit] of keys){let sum=0,ok=true,conhecidos=0;for(const r of rows){const v=key in r.composicao_100g?r.composicao_100g[key]:r.composicao_100g.micros[key];if(v===null||v===undefined||v===''){ok=false;continue;}sum+=Number(v)*r.quantidade_g/100;conhecidos++;}const micro=!['kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g'].includes(key);out[key]={label,unit,val:(ok||(micro&&conhecidos&&sum>0))?sum*100/renda:null,parcial:micro&&conhecidos>0&&(!ok||rows.some(r=>r.composicao_100g.micros_parciais?.[key]))};}return out;}
function resultado(o){
 const macros={kcal:o.kcal?.val,proteinas_g:o.proteinas_g?.val,carboidratos_g:o.carboidratos_g?.val,gorduras_g:o.gorduras_g?.val};
 const micros={},parciais={};
 for(const n of nutrientes){const x=o[n.codigo];if(x?.val!=null&&Number(x.val)>0){micros[n.codigo]=x.val;if(x.parcial)parciais[n.codigo]=true;}}
 $('resultado').innerHTML='<p class="muted">Composição estimada por 100 g da receita pronta, calculada com os ingredientes informados (ainda não salvos).</p>'+
   painelNutrientes(macros,micros,'Macronutrientes por 100 g','por 100 g','previa',parciais);
 ativarAbasNutrientes($('resultado'));
 if(!$('modalPreviaReceita').open)$('modalPreviaReceita').showModal();
}
const fmt=(x,p=1)=>Number(x).toLocaleString('pt-BR',{maximumFractionDigits:p});
async function listar(){
 const usuario=usuarioId, dados=await api('/receitas?usuarioId='+usuario);
 if(usuario!==usuarioId)return;
 receitas=dados;
 $('listaReceitas').innerHTML=receitas.length?receitas.map(r=>`<div class="list-row receita-lista-linha"><div class="receita-lista-info"><button type="button" class="receita-nome" data-ver-id="${r.id}">${esc(r.nome)}</button><small>Rendimento ${fmt(r.rendimento_g)} g · ${r.kcal_100g==null?'calorias desconhecidas':fmt(r.kcal_100g)+' kcal/100 g'}</small></div><button type="button" class="secondary" data-id="${r.id}">Editar</button></div>`).join(''):'<p class="muted">Nenhuma receita cadastrada.</p>';
 $('listaReceitas').querySelectorAll('[data-ver-id]').forEach(b=>b.onclick=()=>ver(b.dataset.verId));
 $('listaReceitas').querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>editar(b.dataset.id));
}
function graficoMacros(dados,titulo,escopo){
 const campos=[
  {chave:'proteinas_g',nome:'Proteínas',cls:'proteina',fator:4},
  {chave:'carboidratos_g',nome:'Carboidratos',cls:'carboidrato',fator:4},
  {chave:'gorduras_g',nome:'Gorduras',cls:'gordura',fator:9}
 ];
 const completo=campos.every(c=>dados[c.chave]!=null&&Number.isFinite(Number(dados[c.chave]))&&Number(dados[c.chave])>=0);
 const total=completo?campos.reduce((s,c)=>s+Number(dados[c.chave])*c.fator,0):0;
 let visual='<p class="muted receita-sem-grafico">Dados insuficientes para calcular a distribuição dos macronutrientes.</p>';
 if(total>0){
  const p1=Number(dados.proteinas_g)*4/total*100,p2=Number(dados.carboidratos_g)*4/total*100;
  const limite1=p1.toFixed(4),limite2=(p1+p2).toFixed(4);
  const etiqueta=campos.map(c=>c.nome+' '+fmt(Number(dados[c.chave])*c.fator/total*100)+'%').join(', ');
  visual=`<div class="receita-grafico" role="img" title="${esc(etiqueta)}" aria-label="Distribuição energética ${esc(escopo)}: ${esc(etiqueta)}" style="background:conic-gradient(#60a5fa 0 ${limite1}%,#fbbf24 ${limite1}% ${limite2}%,#a78bfa ${limite2}% 100%)"><span>Macros</span></div>`;
 }else if(completo)visual='<p class="muted receita-sem-grafico">Sem energia proveniente de macronutrientes para representar.</p>';
 const legenda=campos.map(c=>`<div class="receita-macro-linha"><span class="receita-macro-rotulo"><i class="receita-cor ${c.cls}" aria-hidden="true"></i>${c.nome}</span><strong>${dados[c.chave]==null?'Sem dado':fmt(dados[c.chave],2)+' g'+(total>0?' · '+fmt(Number(dados[c.chave])*c.fator/total*100)+'%':'')}</strong></div>`).join('');
 return `<h3>${esc(titulo)}</h3><p class="receita-energia">${dados.kcal==null?'Energia sem dado':fmt(dados.kcal,2)+' kcal'}</p>${visual}<div class="receita-macros-legenda">${legenda}</div><p class="muted receita-grafico-nota">Distribuição energética: proteínas e carboidratos 4 kcal/g; gorduras 9 kcal/g.</p>`;
}
function formatarMicro(v){
 if(v>0&&v<0.000001)return v.toExponential(2).replace('.',',');
 return fmt(v,9);
}
function listaMicronutrientes(valores,titulo,parciais={}){
 const itens=nutrientes.map(n=>({
  codigo:n.codigo,nome:String(n.nome||n.codigo),unidade:String(n.unidade||''),
  valor:valores?.[n.codigo]==null?null:Number(valores[n.codigo]),
  parcial:Boolean(parciais[n.codigo])
 })).filter(n=>n.valor!=null&&Number.isFinite(n.valor)&&n.valor>0)
   .sort((a,b)=>b.valor-a.valor||a.nome.localeCompare(b.nome,'pt-BR'));
 if(!itens.length)return `<h3>${esc(titulo)}</h3><p class="muted receita-micros-vazio">Nenhum micronutriente positivo encontrado nos dados cadastrados dos ingredientes.</p>`;
 const temParcial=itens.some(n=>n.parcial);
 return `<h3>${esc(titulo)}</h3><ul class="receita-micros-lista">${itens.map(n=>`<li><span>${esc(n.nome)}${n.parcial?' <small class="receita-micro-parcial" title="Um ou mais ingredientes não têm este micronutriente cadastrado.">parcial</small>':''}</span><strong>${formatarMicro(n.valor)} ${esc(n.unidade)}</strong></li>`).join('')}</ul>${temParcial?'<p class="muted receita-micro-aviso">Parcial: soma dos ingredientes com dados disponíveis. O total real pode ser maior.</p>':''}`;
}
function painelNutrientes(dados,totaisMicros,titulo,escopo,prefixo,parciais={}){
 const macroid=prefixo+'-macros',microid=prefixo+'-micros';
 const macroTab=prefixo+'-aba-macros',microTab=prefixo+'-aba-micros';
 return `<div class="receita-abas" role="tablist" aria-label="Composição nutricional ${esc(escopo)}">
  <button type="button" id="${macroTab}" class="receita-aba" role="tab" aria-selected="true" aria-controls="${macroid}" tabindex="0">Macronutrientes</button>
  <button type="button" id="${microTab}" class="receita-aba" role="tab" aria-selected="false" aria-controls="${microid}" tabindex="-1">Micronutrientes</button>
 </div>
 <div id="${macroid}" class="receita-aba-painel" role="tabpanel" aria-labelledby="${macroTab}">${graficoMacros(dados,titulo,escopo)}</div>
 <div id="${microid}" class="receita-aba-painel" role="tabpanel" aria-labelledby="${microTab}" hidden>${listaMicronutrientes(totaisMicros,'Micronutrientes '+escopo,parciais)}</div>`;
}
function ativarAbasNutrientes(raiz=$('detalheConteudo')){
 raiz.querySelectorAll('.receita-abas').forEach(grupo=>{
  const tabs=[...grupo.querySelectorAll('[role="tab"]')];
  function selecionar(tab){
   for(const b of tabs){
    const ativa=b===tab;
    b.setAttribute('aria-selected',String(ativa));
    b.tabIndex=ativa?0:-1;
    const painel=$(b.getAttribute('aria-controls'));
    if(painel)painel.hidden=!ativa;
   }
  }
  tabs.forEach((tab,i)=>{
   tab.addEventListener('click',()=>selecionar(tab));
   tab.addEventListener('keydown',e=>{
    const direcao=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;
    const destino=direcao?tabs[(i+direcao+tabs.length)%tabs.length]:
      e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:null;
    if(destino){e.preventDefault();selecionar(destino);destino.focus();}
   });
  });
 });
}
async function ver(id){
 const usuario=usuarioId;
 try{
  const r=await api('/receitas/'+id+'?usuarioId='+usuario);
  if(usuario!==usuarioId)return;
  // O servidor soma os nutrientes dos ingredientes nas quantidades cadastradas.
  // A composição por 100 g é obtida desse total usando o rendimento final.
  const totais=r.totais_ingredientes;
  const cemGramas=r.composicao_100g;
  const parciais=r.micronutrientes_parciais||{};
  const graficoInteiro=painelNutrientes(totais,r.micronutrientes_totais||{},'Macronutrientes da receita inteira','da receita inteira','receita-inteira',parciais);
  const grafico100g=painelNutrientes(cemGramas,cemGramas.micronutrientes_100g||{},'Macronutrientes por 100 g','por 100 g','receita-cem-gramas',parciais);
  const ingredientes=Array.isArray(r.ingredientes)?r.ingredientes:[];
  const total=ingredientes.reduce((s,i)=>s+Number(i.quantidade_g||0),0);
  $('detalheTitulo').textContent=r.nome;
  $('detalheConteudo').innerHTML=`<div class="receita-detalhe-grid">
   <section class="receita-descricao"><h3>Ingredientes</h3>
    <p class="receita-pesos"><strong>Ingredientes:</strong> ${fmt(total,3)} g<br><strong>Rendimento pronto:</strong> ${fmt(r.rendimento_g,3)} g</p>
    <ul class="receita-ingredientes-detalhe">${ingredientes.map(i=>`<li><span>${esc(i.nome_snapshot||'Ingrediente')}</span><strong>${fmt(i.quantidade_g,3)} g</strong></li>`).join('')}</ul>
    <p class="receita-preparo"><strong>Preparo:</strong> ${esc(r.preparo||'Não informado')}</p>
    <button type="button" class="secondary" id="editarDoDetalhe">Editar receita</button>
   </section>
   <section class="receita-macros" aria-label="Macronutrientes do bolo inteiro">${graficoInteiro}</section>
   <section class="receita-macros" aria-label="Macronutrientes por 100 gramas">${grafico100g}</section>
   </div>`;
  $('editarDoDetalhe').onclick=()=>editar(id);
  ativarAbasNutrientes();
  if(!$('modalDetalheReceita').open)$('modalDetalheReceita').showModal();
 }catch(e){alertar(e.message,true);}
}
function nova(){limparImportador();editId=null;$('titulo').textContent='Nova receita';$('nome').value='';$('preparo').value='';$('rendimento').value='';$('ingredientes').innerHTML='';$('resultado').innerHTML='';addRow();}
async function editar(id){const usuario=usuarioId;try{const r=await api('/receitas/'+id+'?usuarioId='+usuario);if(usuario!==usuarioId)return;limparImportador();editId=id;$('titulo').textContent='Editar receita';$('nome').value=r.nome;$('preparo').value=r.preparo||'';$('rendimento').value=r.rendimento_g;$('ingredientes').innerHTML='';r.ingredientes.forEach(i=>addRow(i.alimento_id,i.quantidade_g));$('resultado').innerHTML='';if($('modalDetalheReceita').open)$('modalDetalheReceita').close();if(!$('modalReceita').open)$('modalReceita').showModal();}catch(e){alertar(e.message,true)}}
async function init(){try{const r=await fetch('/api/avn/usuarios',{credentials:'same-origin'});if(!r.ok)throw Error('Erro ao buscar usuários.');const users=await r.json();$('usuario').innerHTML=users.map(u=>`<option value="${u.id}">${esc(u.nome)}</option>`).join('');const stored=localStorage.getItem('avn_treinos_usuario');$('usuario').value=users.some(u=>String(u.id)===stored)?stored:users[0]?.id||'';$('usuario').onchange=()=>{if($('modalImportacaoReceita').open)$('modalImportacaoReceita').close();if($('modalPreviaReceita').open)$('modalPreviaReceita').close();if($('modalReceita').open)$('modalReceita').close();if($('modalDetalheReceita').open)$('modalDetalheReceita').close();carregar()};$('nova').onclick=()=>{nova();$('modalReceita').showModal()};$('fecharModalReceita').onclick=()=>{if($('modalImportacaoReceita').open)$('modalImportacaoReceita').close();if($('modalPreviaReceita').open)$('modalPreviaReceita').close();$('modalReceita').close()};$('abrirImportacao').onclick=()=>{if(!$('modalImportacaoReceita').open)$('modalImportacaoReceita').showModal()};$('fecharImportacao').onclick=()=>$('modalImportacaoReceita').close();$('fecharPrevia').onclick=()=>$('modalPreviaReceita').close();$('fecharDetalheReceita').onclick=()=>$('modalDetalheReceita').close();$('adicionar').onclick=()=>addRow();$('interpretarReceita').onclick=interpretarReceita;$('aplicarImportacao').onclick=aplicarImportacao;$('textoReceita').oninput=()=>{importacaoRevision++;$('revisaoImportacao').hidden=true;$('aplicarImportacao').hidden=true;$('statusImportacao').textContent='';};$('calcular').onclick=()=>{try{resultado(calcLocal(payload()))}catch(e){alertar(e.message,true)}};$('form').onsubmit=async e=>{e.preventDefault();try{const body=payload();await api('/receitas'+(editId?'/'+editId:''),{method:editId?'PUT':'POST',body:JSON.stringify(body)});alertar('Receita salva. Ela já está disponível na Dieta programada e no Diário alimentar.');if($('modalPreviaReceita').open)$('modalPreviaReceita').close();if($('modalImportacaoReceita').open)$('modalImportacaoReceita').close();$('modalReceita').close();await carregar();}catch(err){alertar(err.message,true)}};await carregar();}catch(e){alertar(e.message,true)}}
async function carregar(){usuarioId=$('usuario').value;if(!usuarioId)return;nova();alimentos=await api('/receitas/catalogo?usuarioId='+usuarioId);nutrientes=(await api('/nutrientes')).micros;await listar();}
init();})();
