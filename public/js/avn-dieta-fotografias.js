/* Fotografias da Dieta Programada: salvar, listar, restaurar e excluir versões. */
(()=>{
 'use strict';
 const core=window.AVNNutricaoInterno;
 if(!core||document.body.dataset.nutricaoPagina!=='dieta')return;
 const {state,esc,api,send,show,loadDiet}=core;
 const $=id=>document.getElementById(id);
 const base=()=>'/dieta/'+state.usuarioId+'/fotografias';
 let ocupado=false;
 async function listar(){
  if(!state.usuarioId)throw Error('Selecione o usuário.');
  $('listaFotografiasDieta').textContent='Carregando fotografias…';
  const uid=state.usuarioId;
  const data=await api(base());
  if(uid!==state.usuarioId)return;
  const registros=data.fotografias||[];
  $('listaFotografiasDieta').innerHTML=registros.length?registros.map(item=>
   '<article class="avn-fotografia-linha"><div><strong>'+esc(item.nome)+'</strong>'+
   '<small>'+esc(new Date(item.criado_em).toLocaleString('pt-BR'))+
   ' · '+esc(item.refeicoes)+' refeições · '+esc(item.alimentos)+' alimentos</small></div>'+
   '<div class="avn-fotografia-acoes"><button type="button" class="primary" data-restaurar-fotografia="'+esc(item.id)+'">Restaurar dieta</button>'+
   '<button type="button" class="delete" data-excluir-fotografia="'+esc(item.id)+'">Excluir</button></div></article>'
  ).join(''):'<p class="muted">Nenhuma fotografia salva. Use “Salvar dieta atual”.</p>';
 }
 async function salvar(){
  if(ocupado)return;
  if(!state.usuarioId){show('Selecione o usuário.',true);return;}
  const padrao='Dieta de '+new Date().toLocaleString('pt-BR');
  const nome=prompt('Nome da fotografia da dieta:',padrao);
  if(nome===null)return;
  if(!nome.trim()||nome.trim().length>100){show('Informe um nome de até 100 caracteres.',true);return;}
  ocupado=true;$('salvarFotografiaDieta').disabled=true;
  try{
   await send(base(),'POST',{nome:nome.trim()});
   show('Fotografia da dieta salva. Os perfis originais não foram alterados.');
   if($('modalFotografiasDieta').open)await listar();
  }catch(e){show(e.message,true);}
  finally{ocupado=false;$('salvarFotografiaDieta').disabled=false;}
 }
 async function abrir(){
  if(!state.usuarioId){show('Selecione o usuário.',true);return;}
  $('modalFotografiasDieta').showModal();
  try{await listar();}catch(e){$('listaFotografiasDieta').textContent=e.message;}
 }
 async function agir(e){
  const restaurar=e.target.closest('[data-restaurar-fotografia]');
  const excluir=e.target.closest('[data-excluir-fotografia]');
  if((!restaurar&&!excluir)||ocupado)return;
  const id=restaurar?.dataset.restaurarFotografia||excluir?.dataset.excluirFotografia;
  if(restaurar&&!confirm('Restaurar esta fotografia e substituir a dieta programada atual? Os perfis cadastrados não serão alterados. Salve a dieta atual antes, se quiser preservá-la.'))return;
  if(excluir&&!confirm('Excluir permanentemente esta fotografia? A dieta atual não será modificada.'))return;
  const uid=state.usuarioId;
  ocupado=true;
  const botoes=[...$('listaFotografiasDieta').querySelectorAll('button')];
  botoes.forEach(b=>b.disabled=true);
  try{
   if(restaurar){
    const resposta=await send(base()+'/'+id+'/restaurar','POST',{});
    if(uid!==state.usuarioId)return;
    await loadDiet();
    $('modalFotografiasDieta').close();
    show('Dieta restaurada. '+resposta.perfis_sem_cadastro+' refeição(ões) sem perfil cadastrado; os demais perfis permanecem intactos.');
   }else{
    await send(base()+'/'+id,'DELETE');
    if(uid!==state.usuarioId)return;
    await listar();
    show('Fotografia excluída.');
   }
  }catch(e){show(e.message,true);}
  finally{ocupado=false;botoes.forEach(b=>b.disabled=false);}
 }
 $('salvarFotografiaDieta').addEventListener('click',salvar);
 $('abrirFotografiasDieta').addEventListener('click',abrir);
 $('fecharFotografiasDieta').addEventListener('click',()=>$('modalFotografiasDieta').close());
 $('listaFotografiasDieta').addEventListener('click',agir);
})();
