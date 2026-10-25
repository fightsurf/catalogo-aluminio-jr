/* AVN — Comparador de alimentos por 100 g: TACO × USDA × IA.
 * Pesquisa independente e simultânea; os três resultados só se encontram na tabela visual.
 * Nenhuma seleção grava alimento no PostgreSQL: escolha -> formulário -> salvar.
 */
(function(root,factory){
 const app=factory();
 if(typeof module==='object'&&module.exports)module.exports=app;
 else root.AVNComparadorAlimentos=app;
})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const SOURCES=['taco','usda','ia'];
 const IDS={taco:'TACO',usda:'USDA',ia:'IA'};
 const TITLES={taco:'TACO',usda:'USDA',ia:'IA'};
 function normalizarTermo(v){return String(v||'').trim().replace(/\s+/g,' ').slice(0,180);}
 function celula(valor,unidade){
  if(valor===null||valor===undefined||valor==='')return {texto:'—',desconhecido:true};
  const n=Number(valor);
  if(!Number.isFinite(n)||n<0)return {texto:'—',desconhecido:true};
  return {texto:n.toLocaleString('pt-BR',{maximumFractionDigits:4})+(unidade?' '+unidade:''),desconhecido:false};
 }
 function linhas(macroList,microList){
  const result=[{grupo:'Macronutrientes'}];
  for(const [codigo,nome,unidade] of macroList)result.push({codigo,nome,unidade,tipo:'macro'});
  for(const categoria of ['Vitaminas','Minerais','Outros']){
   const entries=microList.filter(n=>n[3]===categoria);
   if(!entries.length)continue;
   result.push({grupo:categoria==='Outros'?'Outros componentes':categoria});
   for(const [codigo,nome,unidade] of entries)result.push({codigo,nome,unidade,tipo:'micro'});
  }
  return result;
 }
 function descricao(d){return String(d?.nome||d?.descricao||'').trim();}
 function iniciar({api,send,esc,MACROS,getMicros,aplicar}){
  const $=id=>document.getElementById(id);
  const modal=$('modalConsultaIA');if(!modal)throw Error('Modal comparativo não encontrado.');
  const selected={taco:null,usda:null,ia:null};
  let revision=0,searchTimer=null,iaBusy=false,generated=null;
  let options={taco:[],usda:[]};
  const setStatus=(source,text)=>{const node=$('status'+IDS[source]+(source==='ia'?'Coluna':''));if(node)node.textContent=text;};
  // ID da IA é statusIAColuna; a mensagem geral usa statusIA.
  const general=text=>{$('statusIA').textContent=text;};
  function renderTable(){
   const all=linhas(MACROS,getMicros());
   $('nutrientesComparacao').innerHTML=all.map(entry=>{
    if(entry.grupo)return `<tr><td colspan="4" class="ia-grupo">${esc(entry.grupo)}</td></tr>`;
    const cells=SOURCES.map(source=>{
     const record=selected[source];
     const val=entry.tipo==='macro'?record?.macros?.[entry.codigo]:record?.micros?.[entry.codigo];
     const cell=celula(val,entry.unidade);
     return `<td${cell.desconhecido?' class="ia-desconhecido"':''}>${esc(cell.texto)}</td>`;
    }).join('');
    return `<tr><td>${esc(entry.nome)} <small class="muted">(${esc(entry.unidade)})</small></td>${cells}</tr>`;
   }).join('');
  }
  function renderSelected(source){
   const node=$('selecao'+IDS[source]);const d=selected[source];
   const button=$('usar'+IDS[source]);button.disabled=!d;
   if(!d){node.textContent=source==='ia'?'A IA ainda não foi consultada.':'Selecione um resultado';return;}
   const original=source==='usda'&&d.descricaoOriginal&&d.descricaoOriginal!==d.descricao
    ?`<span class="ia-source-original">USDA (original): ${esc(d.descricaoOriginal)}</span>`:'';
   const prep=d.preparo?`<span>Preparo: ${esc(d.preparo)}</span>`:'';
   const total=getMicros().filter(([k])=>d.micros?.[k]!==null&&d.micros?.[k]!==undefined).length;
   const note=source==='ia'?'<span>Pesquisa assistida por IA. Confira todas as fontes e valores.</span>':'';
   const url=source==='ia'?(d.fontes?.[0]?.url||''):d.fonteUrl;
   node.innerHTML=`<strong>${esc(descricao(d))}</strong>${original}${prep}<span>${total} micronutriente(s) com valor</span>${note}${url?`<span class="ia-source-original">Fonte: ${esc(url)}</span>`:''}`;
  }
  function updateSource(source,d){selected[source]=d;renderSelected(source);renderTable();}
  function setButtons(resetAll=false){
   for(const source of SOURCES){if(resetAll||!selected[source])$('usar'+IDS[source]).disabled=true;}
  }
  function clearSelected(){
   for(const source of SOURCES)selected[source]=null;
   generated=null;$('blocoJSON').hidden=true;$('jsonGerado').textContent='';
   for(const source of SOURCES)renderSelected(source);
   renderTable();
  }
  function clearLists(){
   for(const source of ['taco','usda']){
    options[source]=[];$('resultados'+IDS[source]).replaceChildren();
   }
  }
  function renderOptions(source,items){
   const area=$('resultados'+IDS[source]);const sourceLabel=source==='taco'?'TACO':'USDA';
   area.innerHTML=items.length?items.map((item,index)=>{
    const original=source==='usda'&&item.descricaoOriginal&&item.descricaoOriginal!==item.descricao
     ?`<small>USDA (original): ${esc(item.descricaoOriginal)}</small>`:'';
    return `<button type="button" class="ia-result" data-index="${index}" aria-pressed="false"><strong>${esc(item.descricao)}</strong>${original}<small>${esc(item.preparo||item.tipo||'')}${item.marca?' · '+esc(item.marca):''}</small></button>`;
   }).join(''):`<p class="muted">Nenhum resultado de ${sourceLabel} para essa pesquisa.</p>`;
   area.querySelectorAll('[data-index]').forEach(button=>{
    button.onclick=()=>selectItem(source,Number(button.dataset.index),button);
   });
  }
  async function selectItem(source,index,button){
   const item=options[source][index];if(!item)return;
   const r=revision;const term=normalizarTermo($('termoIA').value);
   const buttons=$('resultados'+IDS[source]).querySelectorAll('.ia-result');
   buttons.forEach(el=>{el.disabled=true;el.setAttribute('aria-pressed',String(el===button));});
   setStatus(source,'Carregando composição de '+item.descricao+'…');
   updateSource(source,null);
   try{
    const id=String(item.fdcId||'');
    if(source==='taco'&&!/^taco-[1-9]\d{0,2}$/.test(id))throw Error('Identificador TACO inválido.');
    if(source==='usda'&&!/^\d{1,12}$/.test(id))throw Error('Identificador USDA inválido.');
    const url=source==='taco'?'/consulta-ia/taco/'+id.slice(5):'/consulta-ia/detalhar/'+id;
    const detail=await api(url);
    if(r!==revision||!modal.open||normalizarTermo($('termoIA').value)!==term)return;
    updateSource(source,detail);
    setStatus(source,'Composição carregada. Confira e compare na tabela abaixo.');
   }catch(e){if(r===revision&&modal.open){setStatus(source,'Erro ao detalhar: '+e.message);updateSource(source,null);}}
   finally{if(r===revision&&modal.open)buttons.forEach(el=>el.disabled=false);}
  }
  async function pesquisarFonte(source,termo,r){
   setStatus(source,'Pesquisando '+TITLES[source]+'…');
   try{
    const response=await api('/consulta-ia/buscar?termo='+encodeURIComponent(termo)+'&fonte='+source);
    if(r!==revision||!modal.open)return;
    options[source]=Array.isArray(response.opcoes)?response.opcoes:[];
    renderOptions(source,options[source]);
    setStatus(source,options[source].length+' resultado(s). Clique em um alimento.');
   }catch(e){
    if(r!==revision||!modal.open)return;
    $('resultados'+IDS[source]).innerHTML='<p class="muted">Não foi possível consultar esta fonte.</p>';
    setStatus(source,'Erro: '+e.message);
   }
  }
  async function pesquisarPar(){
   clearTimeout(searchTimer);const termo=normalizarTermo($('termoIA').value);
   const r=++revision;
   clearSelected();clearLists();
   if(termo.length<2){general('Digite pelo menos dois caracteres.');setStatus('taco','Aguardando alimento');setStatus('usda','Aguardando alimento');return;}
   general('Pesquisando TACO e USDA simultaneamente. A IA só será consultada quando você clicar em Carregar IA.');
   setStatus('ia',iaBusy?'Consulta anterior ainda em andamento.':'Clique em Carregar IA para pesquisar.');
   await Promise.all([pesquisarFonte('taco',termo,r),pesquisarFonte('usda',termo,r)]);
  }
  async function carregarIA(){
   if(iaBusy)return;
   const termo=normalizarTermo($('termoIA').value);
   if(termo.length<2){general('Informe o nome do alimento primeiro.');$('termoIA').focus();return;}
   const r=revision;iaBusy=true;const botao=$('carregarIA');botao.disabled=true;
   setStatus('ia','Pesquisando fontes na web e gerando JSON. Isso pode levar até dois minutos…');
   updateSource('ia',null);
   generated=null;$('blocoJSON').hidden=true;$('jsonGerado').textContent='';
   try{
    const result=await send('/consulta-ia/gerar-json','POST',{
     nome:termo,marca:$('alimentoMarca').value.trim(),preparo:$('alimentoPreparo').value.trim()
    });
    if(r!==revision||!modal.open)return;
    generated=result;
    updateSource('ia',result);
    $('jsonGerado').textContent=JSON.stringify(result,null,2);
    $('blocoJSON').hidden=false;
    const count=getMicros().filter(([k])=>result.micros?.[k]!==null&&result.micros?.[k]!==undefined).length;
    setStatus('ia','JSON completo: '+getMicros().length+' campos de micronutrientes; '+count+' com valores. Confira as fontes.');
   }catch(e){if(r===revision&&modal.open){setStatus('ia','Erro: '+e.message);updateSource('ia',null);}}
   finally{iaBusy=false;botao.disabled=false;}
  }
  function usar(source){const d=selected[source];if(!d)return;
   aplicar(d,{taco:'taco',usda:'usda_fdc',ia:'ia_pesquisa'}[source]);
   fechar();
  }
  function fechar(){clearTimeout(searchTimer);revision++;if(modal.open)modal.close();}
  function abrir(){
   const nome=normalizarTermo($('alimentoNome').value);
   if(nome.length<2){const nomeField=$('alimentoNome');nomeField.focus();
    if(typeof nomeField.reportValidity==='function')nomeField.reportValidity();
    return;}
   $('termoIA').value=[nome,$('alimentoPreparo').value.trim()].filter(Boolean).join(', ');
   clearSelected();clearLists();general('Consultando as fontes. Selecione um alimento em cada coluna.');
   setStatus('taco','Aguardando consulta');setStatus('usda','Aguardando consulta');setStatus('ia','Clique em Carregar IA.');
   modal.showModal();pesquisarPar();
  }
  $('consultarIA').addEventListener('click',abrir);
  $('fecharIA').addEventListener('click',fechar);
  $('cancelarIA').addEventListener('click',fechar);
  modal.addEventListener('close',()=>{clearTimeout(searchTimer);revision++;});
  $('pesquisarIA').addEventListener('click',pesquisarPar);
  $('termoIA').addEventListener('input',()=>{
   clearTimeout(searchTimer);
   ++revision;clearSelected();clearLists();
   general('Aguarde: a pesquisa incremental iniciará após você parar de digitar.');
   setStatus('taco','Aguardando digitação');setStatus('usda','Aguardando digitação');
   searchTimer=setTimeout(pesquisarPar,700);
  });
  $('termoIA').addEventListener('keydown',event=>{
   if(event.key==='Enter'){event.preventDefault();pesquisarPar();}
  });
  $('carregarIA').addEventListener('click',carregarIA);
  for(const source of SOURCES)$('usar'+IDS[source]).addEventListener('click',()=>usar(source));
  $('copiarJSON').addEventListener('click',async()=>{
   if(!generated)return;
   try{await navigator.clipboard.writeText(JSON.stringify(generated,null,2));general('JSON copiado.');}
   catch{general('Não foi possível copiar automaticamente. Selecione o texto do JSON.');}
  });
  setButtons(true);
  renderTable();
  return {pesquisarPar,carregarIA,renderTable};
 }
 return {iniciar,linhas,celula,normalizarTermo};
});
