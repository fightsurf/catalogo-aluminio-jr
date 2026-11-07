/* AVN: perfis de refeição, lançamento direto e repetição de refeições consumidas. */
(()=>{
'use strict';
const core=window.AVNNutricaoInterno;
if(!core)return;
const {state,MEALS,esc,fmt,localDate,show,api,send,loadDiet,loadDaily,renderDiet,userGuard,resumoMacrosDoAlimento}=core;
const $=id=>document.getElementById(id);
const PAGE=document.body.dataset.nutricaoPagina;
const nomeRefeicao=id=>MEALS[id]||id;
let refeicaoPerfil=null,perfilOcupado=false;
function listarPerfis(){
 if(!refeicaoPerfil)return;
 $('tituloPerfisRefeicao').textContent='Perfis · '+nomeRefeicao(refeicaoPerfil);
 const perfis=state.perfis.filter(p=>p.refeicao===refeicaoPerfil&&!p.recuperado);
 $('listaPerfisRefeicao').innerHTML=perfis.map(p=>
  '<div class="avn-perfil-linha"><span><strong>'+esc(p.nome)+'</strong>'+
  (p.ativo?'<small>Perfil selecionado</small>':'')+'</span><div class="avn-perfil-comandos">'+
  (p.ativo?'':'<button type="button" class="secondary" data-ativar="'+esc(p.id)+'">Selecionar</button>')+
  '<button type="button" class="secondary" data-renomear="'+esc(p.id)+'">Renomear</button>'+
  (perfis.length>1?'<button type="button" class="delete" data-excluir="'+esc(p.id)+'">Excluir</button>':'')+
  '</div></div>'
 ).join('')||'<p class="muted">Nenhum perfil encontrado.</p>';
}
function abrirPerfis(ref){
 refeicaoPerfil=ref;$('novoPerfilNome').value='';
 listarPerfis();$('modalPerfisRefeicao').showModal();
}
async function agirPerfil(e){
 const btn=e.target.closest('[data-ativar],[data-renomear],[data-excluir]');
 if(!btn||perfilOcupado)return;
 const id=btn.dataset.ativar||btn.dataset.renomear||btn.dataset.excluir;
 const perfil=state.perfis.find(p=>String(p.id)===String(id)&&p.refeicao===refeicaoPerfil);
 if(!perfil)return;
 let nome;
 if(btn.dataset.renomear){
  nome=prompt('Nome do perfil:',perfil.nome);
  if(nome===null)return;
  nome=nome.trim();
  if(!nome){show('Informe um nome para o perfil.',true);return;}
 }
 if(btn.dataset.excluir&&!confirm('Excluir “'+perfil.nome+'” e seus alimentos planejados? Os registros anteriores do diário serão preservados.'))return;
 perfilOcupado=true;
 try{
  const url='/dieta/'+state.usuarioId+'/perfis/'+id;
  if(btn.dataset.ativar)await send(url+'/ativar','PUT',{});
  else if(btn.dataset.renomear)await send(url+'/nome','PUT',{nome});
  else await send(url,'DELETE');
  await loadDiet();listarPerfis();
  if(btn.dataset.ativar)$('modalPerfisRefeicao').close();
  show('Perfis da refeição atualizados.');
 }catch(err){show(err.message,true);}
 finally{perfilOcupado=false;}
}
async function novoPerfil(e){
 e.preventDefault();if(perfilOcupado)return;
 perfilOcupado=true;
 try{
  userGuard();const nome=$('novoPerfilNome').value.trim();
  if(!nome)throw Error('Informe o nome do perfil.');
  const r=await send('/dieta/'+state.usuarioId+'/perfis','POST',{refeicao:refeicaoPerfil,nome});
  await send('/dieta/'+state.usuarioId+'/perfis/'+r.perfil.id+'/ativar','PUT',{});
  await loadDiet();$('modalPerfisRefeicao').close();
  show('Novo perfil criado vazio e selecionado. Use “+ Adicionar alimento” para montar essa refeição.');
 }catch(err){show(err.message,true);}
 finally{perfilOcupado=false;}
}

let envioRefeicao=null,envioRegistrados=[],salvandoEnvio=false;
function montarEnvio(){
 if(!envioRefeicao)return;
 const itens=state.dieta.filter(i=>i.refeicao===envioRefeicao);
 const ids=new Set(envioRegistrados.filter(i=>i.plano_item_id!=null).map(i=>String(i.plano_item_id)));
 $('tituloEnviarDiario').textContent='Adicionar ao diário · '+nomeRefeicao(envioRefeicao);
 $('itensEnvioDiario').innerHTML=itens.map(i=>{
  const registrado=ids.has(String(i.id));
  return '<div class="avn-refeicao-item" data-envio-item="'+esc(i.id)+'">'+
   '<div class="avn-refeicao-principal"><label class="avn-refeicao-nome"><input type="checkbox" data-envio-check '+(registrado?'disabled':'checked')+'>'+
   '<span><strong>'+esc(i.alimento_nome)+'</strong><small>'+esc(registrado?'Já registrado nessa data':fmt(i.quantidade_g)+' g programados')+'</small></span></label>'+
   '<div data-previa-macros>'+resumoMacrosDoAlimento(i,i.quantidade_g)+'</div></div>'+
   '<label class="avn-field">Quantidade consumida (g)<input type="number" data-envio-peso min="0.1" max="10000" step="any" value="'+esc(i.quantidade_g)+'" '+(registrado?'disabled':'')+'></label></div>';
 }).join('')||'<p class="muted">Nenhum alimento planejado nesse perfil.</p>';
 const atualizarBotao=()=>{
  const marcados=[...$('itensEnvioDiario').querySelectorAll('[data-envio-check]:checked')];
  $('confirmarEnviarDiario').disabled=salvandoEnvio||!marcados.length||marcados.some(box=>{
   const peso=box.closest('[data-envio-item]').querySelector('[data-envio-peso]');
   const valor=Number(peso.value);
   return !peso.value||!peso.checkValidity()||!Number.isFinite(valor)||valor<0.1||valor>10000;
  });
 };
 $('itensEnvioDiario').querySelectorAll('[data-envio-check]').forEach(box=>box.addEventListener('change',atualizarBotao));
 $('itensEnvioDiario').querySelectorAll('[data-envio-peso]').forEach(input=>input.addEventListener('input',()=>{
  const linha=input.closest('[data-envio-item]');
  const item=itens.find(i=>String(i.id)===linha.dataset.envioItem);
  if(item)linha.querySelector('[data-previa-macros]').innerHTML=resumoMacrosDoAlimento(item,input.value);
  atualizarBotao();
 }));
 atualizarBotao();
}
async function consultarEnvio(){
 const data=$('dataEnvioDiario').value,uid=state.usuarioId;
 if(!data)return;
 $('confirmarEnviarDiario').disabled=true;
 const r=await api('/diario/'+uid+'?data='+encodeURIComponent(data));
 if(uid!==state.usuarioId||data!==$('dataEnvioDiario').value)return;
 envioRegistrados=r.itens||[];montarEnvio();
}
async function abrirEnvio(ref){
 try{
  userGuard();envioRefeicao=ref;
  $('dataEnvioDiario').value=localDate();
  $('itensEnvioDiario').textContent='Consultando registros do dia…';
  $('confirmarEnviarDiario').disabled=true;$('modalEnviarDiario').showModal();
  await consultarEnvio();
 }catch(err){show(err.message,true);}
}
async function confirmarEnvio(){
 if(salvandoEnvio)return;
 try{
  userGuard();const data=$('dataEnvioDiario').value;
  const selecionados=[...$('itensEnvioDiario').querySelectorAll('[data-envio-item]')]
   .filter(row=>row.querySelector('[data-envio-check]').checked).map(row=>{
    const input=row.querySelector('[data-envio-peso]'),q=Number(input.value);
    if(!input.value||!input.checkValidity()||!Number.isFinite(q)||q<=0||q>10000)throw Error('Corrija os pesos consumidos.');
    return {plano_item_id:row.dataset.envioItem,quantidade_g:q};
   });
  if(!selecionados.length)throw Error('Selecione pelo menos um alimento.');
  salvandoEnvio=true;$('confirmarEnviarDiario').disabled=true;
  await send('/diario/'+state.usuarioId+'/registrar-refeicao','POST',{data,refeicao:envioRefeicao,itens:selecionados});
  $('modalEnviarDiario').close();
  window.location.assign('/avn/sistema/nutricao/diario?data='+encodeURIComponent(data));
 }catch(err){show(err.message,true);}
 finally{salvandoEnvio=false;if($('modalEnviarDiario').open)montarEnvio();}
}

let anteriores=[],destinoRegistrados=[],repetindo=false;
let consultandoOrigem=false,consultandoDestino=false;
function anterior(data){
 const d=new Date(data+'T12:00:00');d.setDate(d.getDate()-1);
 const pad=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function renderRepeticao(){
 const ref=$('tipoRepetirRefeicao').value;
 const origem=$('dataOrigemRefeicao').value,destino=$('dataDestinoRefeicao').value;
 const itens=anteriores.filter(i=>i.refeicao===ref);
 const presentes=destinoRegistrados.filter(i=>i.refeicao===ref);
 const mesmaData=Boolean(origem&&destino&&origem===destino);
 $('destinoRepetirRefeicao').textContent='Origem: '+(origem||'selecione a data')+' · Destino: '+(destino||'selecione a data');
 $('previaRepetirRefeicao').innerHTML=itens.length?itens.map(i=>
  '<div class="list-row"><span>'+esc(i.alimento_nome)+'</span><small>'+fmt(i.quantidade_g)+' g</small></div>'
 ).join(''):'<p class="muted">Não há alimentos nessa refeição na data de origem.</p>';
 if(mesmaData)$('previaRepetirRefeicao').insertAdjacentHTML('beforeend',
  '<p class="muted">A data de destino deve ser diferente da data de origem.</p>');
 if(presentes.length)$('previaRepetirRefeicao').insertAdjacentHTML('beforeend',
  '<p class="muted">Já existem '+presentes.length+' alimento(s) no destino. Escolha acrescentar ou substituir.</p>');
 $('confirmarRepetirRefeicao').disabled=!itens.length||repetindo||consultandoOrigem||consultandoDestino||
  !origem||!destino||mesmaData||!$('dataOrigemRefeicao').checkValidity()||!$('dataDestinoRefeicao').checkValidity();
}
async function consultarOrigem(){
 const data=$('dataOrigemRefeicao').value,uid=state.usuarioId;
 anteriores=[];consultandoOrigem=Boolean(data);renderRepeticao();
 if(!data)return;
 try{
  const r=await api('/diario/'+uid+'?data='+encodeURIComponent(data));
  if(uid!==state.usuarioId||data!==$('dataOrigemRefeicao').value)return;
  anteriores=r.itens||[];
 }catch(err){
  if(uid===state.usuarioId&&data===$('dataOrigemRefeicao').value)show(err.message,true);
 }finally{
  if(uid===state.usuarioId&&data===$('dataOrigemRefeicao').value){consultandoOrigem=false;renderRepeticao();}
 }
}
async function consultarDestino(){
 const data=$('dataDestinoRefeicao').value,uid=state.usuarioId;
 destinoRegistrados=[];consultandoDestino=Boolean(data);renderRepeticao();
 if(!data)return;
 try{
  const r=await api('/diario/'+uid+'?data='+encodeURIComponent(data));
  if(uid!==state.usuarioId||data!==$('dataDestinoRefeicao').value)return;
  destinoRegistrados=r.itens||[];
 }catch(err){
  if(uid===state.usuarioId&&data===$('dataDestinoRefeicao').value)show(err.message,true);
 }finally{
  if(uid===state.usuarioId&&data===$('dataDestinoRefeicao').value){consultandoDestino=false;renderRepeticao();}
 }
}
async function abrirRepeticao(ref='cafe'){
 try{
  userGuard();
  $('dataOrigemRefeicao').removeAttribute('max');
  $('dataOrigemRefeicao').value=anterior(state.data);
  $('dataDestinoRefeicao').value=state.data;
  $('tipoRepetirRefeicao').innerHTML=Object.entries(MEALS).map(([id,nome])=>
   '<option value="'+esc(id)+'">'+esc(nome)+'</option>').join('');
  $('tipoRepetirRefeicao').value=ref;
  $('modoRepetirRefeicao').value='acrescentar';
  $('modalRepetirRefeicao').showModal();
  await Promise.all([consultarOrigem(),consultarDestino()]);
 }catch(err){show(err.message,true);}
}
async function confirmarRepeticao(){
 if(repetindo||consultandoOrigem||consultandoDestino)return;
 try{
  userGuard();
  const origem=$('dataOrigemRefeicao').value,destino=$('dataDestinoRefeicao').value;
  const ref=$('tipoRepetirRefeicao').value,modo=$('modoRepetirRefeicao').value;
  if(!origem||!destino||!$('dataOrigemRefeicao').checkValidity()||!$('dataDestinoRefeicao').checkValidity())
   throw Error('Informe datas válidas de origem e destino.');
  if(origem===destino)throw Error('Escolha uma data de destino diferente da origem.');
  if(!anteriores.some(i=>i.refeicao===ref))throw Error('Não há alimentos para copiar.');
  if(modo==='substituir'&&destinoRegistrados.some(i=>i.refeicao===ref)&&
   !confirm('Substituir todos os alimentos registrados nessa refeição em '+destino+'?'))return;
  repetindo=true;$('confirmarRepetirRefeicao').disabled=true;
  const uid=state.usuarioId;
  const r=await send('/diario/'+uid+'/repetir-refeicao','POST',{
   data_origem:origem,data_destino:destino,refeicao:ref,modo
  });
  $('modalRepetirRefeicao').close();
  if(uid===state.usuarioId){
   state.data=destino;
   $('dataDiario').value=destino;
   await loadDaily();
  }
  show(r.inseridos+' alimento(s) copiado(s) para '+nomeRefeicao(ref)+' em '+destino+'.');
 }catch(err){show(err.message,true);}
 finally{repetindo=false;if($('modalRepetirRefeicao').open)renderRepeticao();}
}
if(PAGE==='dieta'){
 $('listaDieta').addEventListener('click',async e=>{
  const perfil=e.target.closest('[data-perfis-refeicao]');
  if(perfil){e.preventDefault();abrirPerfis(perfil.dataset.perfisRefeicao);return;}
  const recuperar=e.target.closest('[data-salvar-perfil-recuperado]');
  if(recuperar){
   if(perfilOcupado)return;
   const nome=prompt('Nome do novo perfil (até 80 caracteres):');
   if(nome===null)return;
   if(!nome.trim()||nome.trim().length>80){show('Informe um nome de até 80 caracteres.',true);return;}
   perfilOcupado=true;
   try{
    await send('/dieta/'+state.usuarioId+'/fotografias/perfil-recuperado/'+recuperar.dataset.salvarPerfilRecuperado+'/salvar','POST',{nome:nome.trim()});
    await loadDiet();
    show('Refeição salva como novo perfil cadastrado.');
   }catch(err){show(err.message,true);}finally{perfilOcupado=false;}
   return;
  }
  const botao=e.target.closest('[data-enviar-refeicao]');
  if(botao)abrirEnvio(botao.dataset.enviarRefeicao);
 });
 $('fecharPerfisRefeicao').onclick=()=>$('modalPerfisRefeicao').close();
 $('listaPerfisRefeicao').addEventListener('click',agirPerfil);
 $('formNovoPerfil').addEventListener('submit',novoPerfil);
 $('fecharEnviarDiario').onclick=()=>$('modalEnviarDiario').close();
 $('dataEnvioDiario').addEventListener('change',()=>consultarEnvio().catch(err=>show(err.message,true)));
 $('confirmarEnviarDiario').onclick=confirmarEnvio;
}
if(PAGE==='diario'){
 $('abrirRepetirRefeicao').onclick=()=>abrirRepeticao();
 $('fecharRepetirRefeicao').onclick=()=>$('modalRepetirRefeicao').close();
 $('dataOrigemRefeicao').onchange=consultarOrigem;
 $('dataDestinoRefeicao').onchange=consultarDestino;
 $('tipoRepetirRefeicao').onchange=renderRepeticao;
 $('confirmarRepetirRefeicao').onclick=confirmarRepeticao;
 $('listaDiario').addEventListener('click',e=>{
  const add=e.target.closest('[data-diario-adicionar]');
  if(add){$('diarioRefeicao').value=add.dataset.diarioAdicionar;$('modalAdicionarDiario').showModal();return;}
  const copy=e.target.closest('[data-diario-repetir]');
  if(copy)abrirRepeticao(copy.dataset.diarioRepetir);
 });
}
})();
