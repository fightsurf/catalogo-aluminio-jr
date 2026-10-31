/* AVN: perfis de refeição, lançamento direto e repetição de refeições consumidas. */
(()=>{
'use strict';
const core=window.AVNNutricaoInterno;
if(!core)return;
const {state,MEALS,esc,fmt,localDate,show,api,send,loadDiet,loadDaily,renderDiet,userGuard}=core;
const $=id=>document.getElementById(id);
const PAGE=document.body.dataset.nutricaoPagina;
const nomeRefeicao=id=>MEALS[id]||id;
let refeicaoPerfil=null,perfilOcupado=false;
function listarPerfis(){
 if(!refeicaoPerfil)return;
 $('tituloPerfisRefeicao').textContent='Perfis · '+nomeRefeicao(refeicaoPerfil);
 const perfis=state.perfis.filter(p=>p.refeicao===refeicaoPerfil);
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
   '<label class="avn-refeicao-nome"><input type="checkbox" data-envio-check '+(registrado?'disabled':'checked')+'>'+
   '<span><strong>'+esc(i.alimento_nome)+'</strong><small>'+esc(registrado?'Já registrado nessa data':fmt(i.quantidade_g)+' g programados')+'</small></span></label>'+
   '<label class="avn-field">Quantidade consumida (g)<input type="number" data-envio-peso min="0.1" max="10000" step="any" value="'+esc(i.quantidade_g)+'" '+(registrado?'disabled':'')+'></label></div>';
 }).join('')||'<p class="muted">Nenhum alimento planejado nesse perfil.</p>';
 $('confirmarEnviarDiario').disabled=!itens.some(i=>!ids.has(String(i.id)))||salvandoEnvio;
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

let anteriores=[],repetindo=false;
function anterior(data){
 const d=new Date(data+'T12:00:00');d.setDate(d.getDate()-1);
 const pad=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function renderRepeticao(){
 const ref=$('tipoRepetirRefeicao').value;
 const itens=anteriores.filter(i=>i.refeicao===ref);
 const presentes=state.diario.filter(i=>i.refeicao===ref);
 $('previaRepetirRefeicao').innerHTML=itens.length?itens.map(i=>
  '<div class="list-row"><span>'+esc(i.alimento_nome)+'</span><small>'+fmt(i.quantidade_g)+' g</small></div>'
 ).join(''):'<p class="muted">Não há alimentos nessa refeição da data anterior.</p>';
 if(presentes.length)$('previaRepetirRefeicao').insertAdjacentHTML('beforeend',
  '<p class="muted">Já existem '+presentes.length+' alimento(s) no destino. Escolha acrescentar ou substituir.</p>');
 $('confirmarRepetirRefeicao').disabled=!itens.length||repetindo||$('dataOrigemRefeicao').value>=state.data;
}
async function consultarOrigem(){
 try{
  const data=$('dataOrigemRefeicao').value,uid=state.usuarioId;
  if(!data||data>=state.data){anteriores=[];renderRepeticao();return;}
  $('previaRepetirRefeicao').textContent='Carregando refeição anterior…';
  $('confirmarRepetirRefeicao').disabled=true;
  const r=await api('/diario/'+uid+'?data='+encodeURIComponent(data));
  if(uid!==state.usuarioId||data!==$('dataOrigemRefeicao').value)return;
  anteriores=r.itens||[];renderRepeticao();
 }catch(err){anteriores=[];show(err.message,true);renderRepeticao();}
}
async function abrirRepeticao(ref='cafe'){
 try{
  userGuard();
  $('destinoRepetirRefeicao').textContent='Data de destino: '+state.data;
  $('dataOrigemRefeicao').max=anterior(state.data);
  $('dataOrigemRefeicao').value=anterior(state.data);
  $('tipoRepetirRefeicao').innerHTML=Object.entries(MEALS).map(([id,nome])=>
   '<option value="'+esc(id)+'">'+esc(nome)+'</option>').join('');
  $('tipoRepetirRefeicao').value=ref;
  $('modoRepetirRefeicao').value='acrescentar';
  $('modalRepetirRefeicao').showModal();
  await consultarOrigem();
 }catch(err){show(err.message,true);}
}
async function confirmarRepeticao(){
 if(repetindo)return;
 try{
  const ref=$('tipoRepetirRefeicao').value,modo=$('modoRepetirRefeicao').value;
  if(!anteriores.some(i=>i.refeicao===ref))throw Error('Não há alimentos para copiar.');
  if(modo==='substituir'&&state.diario.some(i=>i.refeicao===ref)&&
   !confirm('Substituir todos os alimentos registrados nessa refeição do dia de destino?'))return;
  repetindo=true;$('confirmarRepetirRefeicao').disabled=true;
  const r=await send('/diario/'+state.usuarioId+'/repetir-refeicao','POST',{
   data_origem:$('dataOrigemRefeicao').value,data_destino:state.data,refeicao:ref,modo
  });
  $('modalRepetirRefeicao').close();
  await loadDaily();show(r.inseridos+' alimento(s) copiado(s) para '+nomeRefeicao(ref)+'.');
 }catch(err){show(err.message,true);}
 finally{repetindo=false;if($('modalRepetirRefeicao').open)renderRepeticao();}
}
if(PAGE==='dieta'){
 $('listaDieta').addEventListener('click',e=>{
  const perfil=e.target.closest('[data-perfis-refeicao]');
  if(perfil){e.preventDefault();abrirPerfis(perfil.dataset.perfisRefeicao);return;}
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
