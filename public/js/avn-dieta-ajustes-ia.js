/* AVN · Ajustes com IA: prévia independente, aplicação individual e confirmação final. */
(()=>{
'use strict';
if(document.body.dataset.nutricaoPagina!=='dieta')return;
const core=window.AVNNutricaoInterno;
if(!core)return;
const {state,send,loadDiet,show,esc,fmt}=core;
const $=id=>document.getElementById(id);
const MACROS=[['kcal','Energia','kcal'],['proteinas_g','Proteínas','g'],
 ['carboidratos_g','Carboidratos','g'],['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g']];
let usuario='',versao='',aplicadas=[],resultado=null,ocupado=false,revisao=0;
function status(texto,erro=false){
 const el=$('ajustesIaStatus');el.textContent=texto||'';el.classList.toggle('erro',!!erro);
}
function bloqueio(ativo){
 ocupado=ativo;
 $('ajustesIaSalvar').disabled=ativo||!aplicadas.length;
 $('ajustesIaReanalisar').disabled=ativo;
 $('ajustesIaReiniciar').disabled=ativo||!aplicadas.length;
 $('ajustesIaSugestoes').querySelectorAll('button').forEach(btn=>btn.disabled=ativo);
 $('ajustesIaAplicadas').querySelectorAll('button').forEach(btn=>btn.disabled=ativo);
}
function tabela(totais,metas){
 return '<div class="avn-ajustes-tabela" role="table" aria-label="Comparação das metas">'+
  '<div class="avn-ajustes-linha avn-ajustes-cabecalho" role="row"><span>Nutriente</span><span>Meta</span><span>Planejado</span><span>Diferença</span></div>'+
  MACROS.map(([chave,nome,unidade])=>{
   const alvo=metas[chave];
   const atual=totais[chave];
   const valido=alvo!=null&&Number(alvo)>0;
   const delta=valido?Number(atual)-Number(alvo):null;
   const ok=valido&&Math.abs(delta)/Number(alvo)<=0.03;
   const label=delta==null?'—':(delta>0?'+':'')+fmt(delta,chave==='kcal'?0:1)+' '+unidade;
   return '<div class="avn-ajustes-linha'+(ok?' ideal':'')+'" role="row">'+
    '<strong>'+nome+'</strong><span>'+(valido?fmt(alvo,chave==='kcal'?0:1)+' '+unidade:'Não definida')+'</span>'+
    '<span>'+fmt(atual,chave==='kcal'?0:1)+' '+unidade+'</span>'+
    '<span>'+label+'</span></div>';
  }).join('')+'</div>';
}
function mostrar(){
 if(!resultado)return;
 $('ajustesIaComparacao').innerHTML=tabela(resultado.atual,resultado.metas);
 $('ajustesIaAvisos').innerHTML=(resultado.avisos||[]).map(x=>'<p class="muted">'+esc(x)+'</p>').join('');
 const melhorou=aplicadas.length;
 $('ajustesIaResumo').textContent=melhorou?
  aplicadas.length+' ajuste(s) aplicado(s) apenas na simulação. Compare os valores antes de salvar.':
  'A IA analisa todos os nutrientes em conjunto. Nenhum alimento foi alterado.';
 $('ajustesIaAplicadas').innerHTML=aplicadas.length?
  '<h4>Ajustes aplicados nesta simulação</h4>'+
  aplicadas.map((a,i)=>{
   const fonte=resultado?.aplicadas?.[i]||a;
   return '<div class="avn-ajustes-aplicada"><span><strong>'+(i+1)+'º ajuste</strong> · '+
    (fonte.tipo==='ingrediente'?'Ingrediente de receita':'Quantidade de alimento')+
    ' · '+fmt(fonte.quantidade_g)+' g</span>'+
    '<button type="button" class="secondary" data-desfazer="'+i+'">Desfazer</button></div>';
  }).join(''):'';
 const sugestoes=resultado.sugestoes||[];
 $('ajustesIaSugestoes').innerHTML=sugestoes.length?
  sugestoes.map((s,i)=>'<article class="avn-ajustes-sugestao">'+
   '<div><h4>'+esc(s.titulo)+'</h4><p>'+esc(s.motivo)+'</p>'+
   '<p class="avn-ajustes-gramas">'+fmt(s.antes_g)+' g <span aria-hidden="true">→</span> <strong>'+fmt(s.depois_g)+' g</strong></p>'+
   '<details><summary>Ver impacto na dieta inteira</summary>'+tabela(s.impacto,resultado.metas)+'</details></div>'+
   '<button type="button" class="primary" data-aplicar="'+i+'">Aplicar</button></article>').join(''):
  '<p class="muted">Nenhuma alteração individual adicional melhorou as metas sem prejudicar os outros nutrientes. Você pode salvar os ajustes aplicados ou revisar as metas e os alimentos cadastrados.</p>';
 $('ajustesIaSalvar').disabled=ocupado||!aplicadas.length;
 $('ajustesIaReiniciar').disabled=ocupado||!aplicadas.length;
}
async function analisar(acoes,reiniciar=false){
 if(ocupado)return;
 const meu=++revisao,original=usuario;
 bloqueio(true);
 status('Analisando proteínas, carboidratos, gorduras, fibras, energia e ingredientes das receitas…');
 try{
  const r=await send('/dieta/'+encodeURIComponent(usuario)+'/ajustes-ia/analisar','POST',{
   versao:reiniciar?'':versao,aplicadas:acoes
  });
  if(meu!==revisao||!$('modalAjustesDietaIA').open||original!==state.usuarioId)return;
  resultado=r;versao=r.versao;aplicadas=r.aplicadas||[];
  mostrar();
  status(aplicadas.length?'Simulação recalculada. Confira as metas e aplique outros ajustes se desejar.':
   'Análise concluída. Aplique individualmente as sugestões que fizerem sentido.');
 }catch(e){
  if(meu===revisao)status(e.message,true);
 }finally{
  if(meu===revisao)bloqueio(false);
 }
}
async function abrir(){
 if(ocupado)return;
 try{core.userGuard();}catch(e){show(e.message,true);return;}
 usuario=state.usuarioId;versao='';aplicadas=[];resultado=null;
 $('ajustesIaComparacao').replaceChildren();
 $('ajustesIaAplicadas').replaceChildren();
 $('ajustesIaSugestoes').replaceChildren();
 $('ajustesIaResumo').textContent='';
 $('modalAjustesDietaIA').showModal();
 await analisar([],true);
}
async function salvar(){
 if(ocupado||!aplicadas.length||!resultado)return;
 if(state.usuarioId!==usuario){status('O usuário mudou. Reabra a análise.',true);return;}
 if(!confirm('Salvar os '+aplicadas.length+' ajuste(s) na dieta programada? As receitas ajustadas serão copiadas; as originais serão preservadas.'))return;
 bloqueio(true);
 status('Salvando a dieta e criando cópias das receitas ajustadas…');
 try{
  const r=await send('/dieta/'+encodeURIComponent(usuario)+'/ajustes-ia/salvar','POST',{versao,aplicadas});
  ++revisao;
  $('modalAjustesDietaIA').close();
  await loadDiet();
  show(r.alteracoes+' ajuste(s) salvo(s) na dieta. '+r.receitas_criadas+' receita(s) copiada(s) sem alterar as originais.');
 }catch(e){status(e.message,true);}
 finally{bloqueio(false);}
}
$('abrirAjustesDietaIA').addEventListener('click',abrir);
$('fecharAjustesDietaIA').addEventListener('click',()=>$('modalAjustesDietaIA').close());
$('modalAjustesDietaIA').addEventListener('close',()=>{++revisao;versao='';resultado=null;aplicadas=[];usuario='';bloqueio(false);});
$('usuario').addEventListener('change',()=>{if($('modalAjustesDietaIA').open)$('modalAjustesDietaIA').close();});
$('ajustesIaReanalisar').addEventListener('click',()=>analisar(aplicadas));
$('ajustesIaReiniciar').addEventListener('click',()=>analisar([],true));
$('ajustesIaSalvar').addEventListener('click',salvar);
$('ajustesIaSugestoes').addEventListener('click',e=>{
 const b=e.target.closest('[data-aplicar]');
 if(!b||ocupado||!resultado)return;
 const s=resultado.sugestoes[Number(b.dataset.aplicar)];
 if(!s)return;
 analisar([...aplicadas,s.acao]);
});
$('ajustesIaAplicadas').addEventListener('click',e=>{
 const b=e.target.closest('[data-desfazer]');
 if(!b||ocupado)return;
 const i=Number(b.dataset.desfazer);
 if(!Number.isInteger(i)||i<0||i>=aplicadas.length)return;
 // Preserva as demais modificações quando continuarem válidas; a API valida o novo conjunto.
 analisar(aplicadas.filter((_,index)=>index!==i));
});
})();
