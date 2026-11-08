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


let origemCopia=null,destinoRegistrados=[],copiando=false,consultandoDestino=false,falhaConsultaDestino=false,versaoConsultaDestino=0;
function dataBR(data){
 const p=String(data||'').split('-');
 return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:data;
}
function renderCopia(){
 if(!origemCopia)return;
 const destino=$('dataDestinoRefeicao').value,refDestino=$('refeicaoDestinoRepeticao').value;
 const origem=origemCopia;
 const itensOrigem=state.diario.filter(i=>i.refeicao===origem.ref);
 const itensDestino=destinoRegistrados.filter(i=>i.refeicao===refDestino);
 const mesmoLugar=Boolean(destino&&origem.data===destino&&origem.ref===refDestino);
 $('origemRepetirRefeicao').textContent='Origem: '+nomeRefeicao(origem.ref)+' · '+dataBR(origem.data);
 const avisos=[];
 if(!itensOrigem.length)avisos.push('Não há alimentos nessa refeição para copiar.');
 else avisos.push('Serão copiados '+itensOrigem.length+' alimento(s) com as quantidades e os nutrientes registrados.');
 if(!destino)avisos.push('Escolha a data de destino.');
 else if(mesmoLugar)avisos.push('Escolha outra data ou outra refeição de destino.');
 else if(itensDestino.length)avisos.push('O destino já possui alimentos. A cópia será acrescentada, sem excluir os existentes.');
 if(falhaConsultaDestino)avisos.push('Não foi possível consultar o destino. Escolha novamente a data.');
 $('statusRepetirRefeicao').textContent=avisos.join(' ');
 $('confirmarRepetirRefeicao').disabled=!itensOrigem.length||!destino||!MEALS[refDestino]||
  !($('dataDestinoRefeicao').checkValidity())||mesmoLugar||copiando||consultandoDestino||falhaConsultaDestino;
}
async function consultarDestino(){
 const versao=++versaoConsultaDestino,uid=state.usuarioId,data=$('dataDestinoRefeicao').value;
 destinoRegistrados=[];falhaConsultaDestino=false;consultandoDestino=Boolean(data);
 renderCopia();
 if(!data)return;
 try{
  const r=await api('/diario/'+uid+'?data='+encodeURIComponent(data));
  if(versao!==versaoConsultaDestino||!origemCopia||uid!==state.usuarioId)return;
  destinoRegistrados=r.itens||[];
 }catch(err){
  if(versao===versaoConsultaDestino&&origemCopia&&uid===state.usuarioId){
   falhaConsultaDestino=true;show(err.message,true);
  }
 }finally{
  if(versao===versaoConsultaDestino&&origemCopia&&uid===state.usuarioId){
   consultandoDestino=false;renderCopia();
  }
 }
}
function abrirCopia(ref){
 try{
  userGuard();
  if(!MEALS[ref]||!state.data||!state.diario.some(i=>i.refeicao===ref))
   throw Error('Escolha uma refeição com alimentos registrados para copiar.');
  origemCopia={data:state.data,ref,usuarioId:state.usuarioId};
  ++versaoConsultaDestino;
  destinoRegistrados=[];consultandoDestino=false;falhaConsultaDestino=false;
  $('dataDestinoRefeicao').value='';
  $('refeicaoDestinoRepeticao').innerHTML=Object.entries(MEALS).map(([id,nome])=>
   '<option value="'+esc(id)+'">'+esc(nome)+'</option>').join('');
  $('refeicaoDestinoRepeticao').value=ref;
  $('modalRepetirRefeicao').showModal();
  renderCopia();
 }catch(err){show(err.message,true);}
}
async function confirmarCopia(){
 if(copiando||consultandoDestino||falhaConsultaDestino||!origemCopia)return;
 try{
  userGuard();
  const origem={...origemCopia},destino=$('dataDestinoRefeicao').value;
  const refDestino=$('refeicaoDestinoRepeticao').value;
  if(origem.usuarioId!==state.usuarioId||origem.data!==state.data)
   throw Error('O diário mudou. Abra novamente a refeição para copiar.');
  if(!destino||!$('dataDestinoRefeicao').checkValidity())throw Error('Escolha uma data de destino válida.');
  if(!MEALS[refDestino])throw Error('Escolha uma refeição de destino válida.');
  if(destino===origem.data&&refDestino===origem.ref)
   throw Error('Escolha outra data ou outra refeição de destino.');
  if(!state.diario.some(i=>i.refeicao===origem.ref))throw Error('Não há alimentos para copiar.');
  copiando=true;$('confirmarRepetirRefeicao').disabled=true;
  const r=await send('/diario/'+origem.usuarioId+'/repetir-refeicao','POST',{
   data_origem:origem.data,data_destino:destino,
   refeicao:origem.ref,refeicao_destino:refDestino,modo:'acrescentar'
  });
  $('modalRepetirRefeicao').close();
  ++versaoConsultaDestino;
  origemCopia=null;
  if(origem.usuarioId===state.usuarioId){
   state.data=destino;
   $('dataDiario').value=destino;
   try{await loadDaily();}
   catch(err){show('A refeição foi copiada, mas não foi possível atualizar o diário: '+err.message,true);return;}
  }
  show(r.inseridos+' alimento(s) copiado(s) para '+nomeRefeicao(refDestino)+' em '+dataBR(destino)+'.');
 }catch(err){show(err.message,true);}
 finally{copiando=false;if($('modalRepetirRefeicao').open)renderCopia();}
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
 $('fecharRepetirRefeicao').onclick=()=>$('modalRepetirRefeicao').close();
 $('modalRepetirRefeicao').addEventListener('close',()=>{++versaoConsultaDestino;origemCopia=null;});
 $('dataDestinoRefeicao').onchange=consultarDestino;
 $('refeicaoDestinoRepeticao').onchange=consultarDestino;
 $('confirmarRepetirRefeicao').onclick=confirmarCopia;
 $('listaDiario').addEventListener('click',e=>{
  const add=e.target.closest('[data-diario-adicionar]');
  if(add){$('diarioRefeicao').value=add.dataset.diarioAdicionar;$('modalAdicionarDiario').showModal();return;}
  const copy=e.target.closest('[data-diario-repetir]');
  if(copy)abrirCopia(copy.dataset.diarioRepetir);
 });
}
})();
