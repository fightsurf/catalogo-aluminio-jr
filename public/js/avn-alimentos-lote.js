/* AVN: importação de alimentos em lote por print, com revisão prévia. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
if(!$('modalImportacaoAlimentos'))return;
const BASE='/avn/sistema/api/nutricao';
const MACROS=[
 ['kcal','Energia','kcal'],
 ['proteinas_g','Proteínas','g'],
 ['carboidratos_g','Carboidratos','g'],
 ['gorduras_g','Gorduras','g'],
 ['fibras_g','Fibras','g']
];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>x===null||x===undefined||x===''?'Sem dado':Number(x).toLocaleString('pt-BR',{maximumFractionDigits:3});
const ctx=()=>window.AVNNutricaoInterno;
const currentUser=()=>String(ctx()?.state?.usuarioId||'');
let itens=[],nutrientes=[],usuarioImagem='',operacao=0,pesquisando=false,salvando=false,previaUrl=null;
function status(mensagem){$('statusImportacaoAlimentos').textContent=mensagem;}
function notificar(mensagem,erro=false){if(ctx()?.show)ctx().show(mensagem,erro);else alert(mensagem);}
async function requisitar(caminho,opcoes={}){
 const resposta=await fetch(BASE+caminho,{credentials:'same-origin',cache:'no-store',...opcoes});
 if(resposta.redirected&&resposta.url.includes('/login'))throw Error('Sessão expirada. Faça login novamente.');
 const json=await resposta.json().catch(()=>{throw Error('Resposta inválida do servidor.');});
 if(!resposta.ok)throw Error(json.erro||'Não foi possível concluir a importação.');
 return json;
}
function jsonPost(caminho,dados){
 return requisitar('/importacao-lote/'+caminho,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(dados)});
}
function limpar(){
 operacao++;itens=[];nutrientes=[];usuarioImagem='';pesquisando=false;salvando=false;
 if(previaUrl){URL.revokeObjectURL(previaUrl);previaUrl=null;}
 $('previaPrintAlimentos').hidden=true;$('previaPrintAlimentos').removeAttribute('src');
 $('arquivoImportacaoAlimentos').value='';
 status('Aguardando imagem.');renderizar();
}
function resumo(){
 const cad=itens.filter(i=>i.status==='pronto').length;
 const dup=itens.filter(i=>i.status==='duplicado').length;
 const erros=itens.filter(i=>i.status==='erro').length;
 const emFila=itens.filter(i=>['pendente','pesquisando'].includes(i.status)).length;
 return {cad,dup,erros,emFila,selecionados:itens.filter(i=>i.status==='pronto'&&i.selecionado).length};
}
function valorCampo(label,id,valor,max=1000000){
 return '<label>'+esc(label)+'<input type="number" step="any" min="0" max="'+max+'" data-nutriente="'+esc(id)+'" value="'+(valor==null?'':esc(valor))+'" placeholder="Sem dado"></label>';
}
function composicaoHtml(item,indice){
 if(!item.dados)return '';
 const m=item.dados.macros||{},u=item.dados.micros||{};
 return '<div class="avn-lote-resumo">'+MACROS.slice(0,4).map(([k,n,un])=>
  '<span><strong>'+esc(n)+':</strong> '+esc(fmt(m[k]))+(m[k]==null?'':' '+un)+'</span>').join('')+
  '<span><strong>Micros preenchidos:</strong> '+Object.values(u).filter(v=>v!==null&&v!==undefined).length+'</span></div>'+
  '<small>'+esc(item.dados.qualidade||'Revise os dados antes de salvar.')+'</small>'+
  '<details><summary>Conferir/editar todos os macros e micros por 100 g</summary>'+
  '<h4>Macronutrientes</h4><div class="avn-lote-nutrientes">'+MACROS.map(([k,n,un])=>valorCampo(n+' ('+un+')','macro:'+k,m[k],k==='kcal'?1000:100)).join('')+'</div>'+
  '<h4 class="avn-lote-microtitulo">Vitaminas, minerais e outros</h4><div class="avn-lote-nutrientes">'+
  nutrientes.map(n=>valorCampo(n.nome+' ('+n.unidade+')','micro:'+n.codigo,u[n.codigo])).join('')+
  '</div><small>Campos em branco indicam falta de dados, não zero.</small></details>';
}
function renderizar(){
 const r=resumo();
 $('contagemImportacaoAlimentos').textContent=itens.length?itens.length+' identificados · '+r.cad+' pesquisados · '+r.dup+' duplicados · '+r.erros+' falhas':'';
 $('salvarImportacaoAlimentos').disabled=salvando||pesquisando||r.emFila>0||r.selecionados===0||usuarioImagem!==currentUser();
 $('salvarImportacaoAlimentos').textContent=salvando?'Salvando…':'Salvar '+r.selecionados+' alimento'+(r.selecionados===1?'':'s');
 $('selecionarPrintAlimentos').disabled=salvando||pesquisando;
 $('fecharImportacaoAlimentos').disabled=salvando;
 $('cancelarImportacaoAlimentos').disabled=salvando;
 $('listaImportacaoAlimentos').innerHTML=itens.map((item,i)=>{
  const duplicado=item.status==='duplicado';
  const estado=duplicado?(item.duplicado?'Já cadastrado: '+item.duplicado.nome:'Repetido no próprio print'):
   item.status==='pronto'?'Nutrição pesquisada · '+(item.dados?.fonte==='taco'?'TACO':'Estimativa IA'):
   item.status==='pesquisando'?'Pesquisando TACO e composição nutricional…':
   item.status==='erro'?'Falha na pesquisa':item.status==='pendente'?'Aguardando pesquisa':'Aguardando';
  return '<section class="avn-lote-item '+(duplicado?'duplicado':item.status==='erro'?'erro':'')+'" data-indice="'+i+'">'+
   '<header><div class="avn-lote-identificacao"><label><input type="checkbox" data-selecionar="'+i+'"'+(item.selecionado&&item.status==='pronto'?' checked':'')+
   (item.status!=='pronto'||salvando?' disabled':'')+'> <strong>'+esc(i+1)+'. '+esc(item.nome)+'</strong></label></div><span>'+esc(estado)+'</span></header>'+
   '<div class="avn-lote-campos">'+
    '<label>Nome<input data-editar="nome" maxlength="180" value="'+esc(item.nome)+'"'+(salvando||pesquisando?' disabled':'')+'></label>'+
    '<label>Marca (opcional)<input data-editar="marca" maxlength="120" value="'+esc(item.marca||'')+'"'+(salvando||pesquisando?' disabled':'')+'></label>'+
    '<label>Preparo (opcional)<input data-editar="preparo" maxlength="120" value="'+esc(item.preparo||'')+'"'+(salvando||pesquisando?' disabled':'')+'></label></div>'+
   (item.erro?'<small class="avn-lote-erro">'+esc(item.erro)+'</small>':'')+
   (item.status==='pendente'||item.status==='erro'?'<button type="button" class="secondary" data-pesquisar="'+i+'"'+(pesquisando||salvando?' disabled':'')+'>Pesquisar novamente</button>':'')+
   (item.dados?composicaoHtml(item,i):'')+
   '</section>';
 }).join('');
}
async function pesquisarItem(indice,token){
 const item=itens[indice];
 if(!item||token!==operacao)return;
 item.status='pesquisando';item.erro='';renderizar();
 const identidade=JSON.stringify([item.nome,item.marca,item.preparo]);
 try{
  const resultado=await jsonPost('pesquisar',{usuarioId:usuarioImagem,alimento:{nome:item.nome,marca:item.marca,preparo:item.preparo}});
  if(token!==operacao||JSON.stringify([item.nome,item.marca,item.preparo])!==identidade)return;
  if(resultado.duplicado){
   item.duplicado=resultado.duplicado;item.status='duplicado';item.selecionado=false;item.dados=null;
  }else{
   item.status='pronto';item.dados=resultado.alimento;item.selecionado=true;item.duplicado=null;
  }
 }catch(e){
  if(token!==operacao)return;
  item.status='erro';item.erro=e.message;item.selecionado=false;item.dados=null;
 }
 if(token===operacao)renderizar();
}
async function pesquisarTudo(token){
 pesquisando=true;renderizar();
 const fila=itens.map((i,n)=>({i,n})).filter(({i})=>i.status==='pendente').map(({n})=>n);
 let cursor=0;
 async function trabalhador(){
  while(cursor<fila.length&&token===operacao){
   const n=fila[cursor++];
   status('Pesquisando composição nutricional: '+Math.min(cursor,fila.length)+' de '+fila.length+'…');
   await pesquisarItem(n,token);
  }
 }
 await Promise.all([trabalhador(),trabalhador()]);
 if(token!==operacao)return;
 pesquisando=false;
 const r=resumo();
 status(r.cad+' alimento(s) pesquisado(s), '+r.dup+' duplicado(s), '+r.erros+' com erro. Confira e clique em Salvar.');
 renderizar();
}
async function selecionarImagem(arquivo){
 if(!arquivo)return;
 if(!['image/jpeg','image/png','image/webp'].includes(arquivo.type))return notificar('Escolha JPG, PNG ou WebP.',true);
 if(arquivo.size>8*1024*1024)return notificar('O arquivo deve ter até 8 MB.',true);
 if(!currentUser())return notificar('Selecione um usuário AVN antes de importar.',true);
 limpar();usuarioImagem=currentUser();
 const token=operacao;
 previaUrl=URL.createObjectURL(arquivo);
 $('previaPrintAlimentos').src=previaUrl;$('previaPrintAlimentos').hidden=false;
 status('Identificando alimentos no print com IA…');
 $('selecionarPrintAlimentos').disabled=true;
 try{
  const form=new FormData();
  form.append('usuarioId',usuarioImagem);form.append('imagem',arquivo,arquivo.name||'print.png');
  const [resultado,catalogo]=await Promise.all([
   requisitar('/importacao-lote/interpretar',{method:'POST',body:form}),
   requisitar('/nutrientes')
  ]);
  if(token!==operacao)return;
  nutrientes=Array.isArray(catalogo.micros)?catalogo.micros:[];
  itens=resultado.itens.map(i=>({...i,
   status:i.duplicado||i.repetido_na_imagem?'duplicado':'pendente',
   selecionado:!i.duplicado&&!i.repetido_na_imagem,dados:null,erro:''}));
  renderizar();
  if(itens.some(i=>i.status==='pendente'))await pesquisarTudo(token);
  else status('Todos os alimentos do print já estão cadastrados ou aparecem repetidos.');
 }catch(e){
  if(token!==operacao)return;
  status('Falha: '+e.message);
  notificar(e.message,true);
 }finally{if(token===operacao){pesquisando=false;renderizar();}}
}
async function salvar(){
 if(salvando||pesquisando||usuarioImagem!==currentUser())return notificar('Selecione o usuário correto e conclua a pesquisa.',true);
 const selecionados=itens.filter(i=>i.status==='pronto'&&i.selecionado);
 if(!selecionados.length)return notificar('Nenhum alimento novo está selecionado.',true);
 salvando=true;renderizar();status('Salvando '+selecionados.length+' alimento(s) em uma única transação…');
 try{
  const payload=selecionados.map(i=>({
   nome:i.nome,marca:i.marca,preparo:i.preparo,
   macros:i.dados.macros,micros:i.dados.micros,
   fonte:i.dados.fonte,fonte_referencia:i.dados.fonte_referencia
  }));
  const resultado=await jsonPost('salvar',{usuarioId:usuarioImagem,itens:payload});
  const cadastrados=resultado.cadastrados?.length||0,ignorados=resultado.ignorados?.length||0;
  await ctx().loadFoods();
  $('modalImportacaoAlimentos').close();
  notificar(cadastrados+' alimento(s) cadastrado(s). '+(ignorados+itens.filter(i=>i.status==='duplicado').length)+' duplicado(s) ignorado(s).');
 }catch(e){
  status('Não foi possível salvar: '+e.message);
  notificar(e.message,true);
 }finally{salvando=false;renderizar();}
}
$('abrirImportacaoAlimentos').addEventListener('click',()=>{
 if(!currentUser())return notificar('Selecione um usuário antes de importar.',true);
 limpar();$('modalImportacaoAlimentos').showModal();
});
const fechar=()=>{if(!salvando)$('modalImportacaoAlimentos').close();};
$('fecharImportacaoAlimentos').addEventListener('click',fechar);
$('cancelarImportacaoAlimentos').addEventListener('click',fechar);
$('modalImportacaoAlimentos').addEventListener('cancel',e=>{if(salvando)e.preventDefault();});
$('modalImportacaoAlimentos').addEventListener('close',limpar);
const area=$('areaPrintAlimentos'),selecionar=$('arquivoImportacaoAlimentos');
const escolher=()=>{if(!salvando&&!pesquisando)selecionar.click();};
$('selecionarPrintAlimentos').addEventListener('click',e=>{e.stopPropagation();escolher();});
area.addEventListener('click',e=>{if(!e.target.closest('button'))escolher();});
area.addEventListener('keydown',e=>{if(e.target===area&&(e.key==='Enter'||e.key===' ')){e.preventDefault();escolher();}});
selecionar.addEventListener('change',()=>{const file=selecionar.files?.[0];if(file)selecionarImagem(file);});
area.addEventListener('paste',e=>{const file=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();selecionarImagem(file);}});
for(const nome of ['dragenter','dragover'])area.addEventListener(nome,e=>{e.preventDefault();area.classList.add('dragging');});
for(const nome of ['dragleave','drop'])area.addEventListener(nome,e=>{e.preventDefault();area.classList.remove('dragging');});
area.addEventListener('drop',e=>{const file=[...(e.dataTransfer?.files||[])].find(f=>f.type.startsWith('image/'));if(file)selecionarImagem(file);});
document.addEventListener('paste',e=>{
 if(!$('modalImportacaoAlimentos').open||area.contains(e.target))return;
 const file=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'))?.getAsFile();
 if(file){e.preventDefault();selecionarImagem(file);}
});
$('usuario').addEventListener('change',()=>{if($('modalImportacaoAlimentos').open)fechar();});
$('listaImportacaoAlimentos').addEventListener('change',e=>{
 const elemento=e.target.closest('[data-indice]');
 if(!elemento||salvando||pesquisando)return;
 const item=itens[Number(elemento.dataset.indice)];
 if(!item)return;
 if(e.target.matches('[data-selecionar]')){item.selecionado=e.target.checked;renderizar();return;}
 const campo=e.target.dataset.editar;
 if(campo){
  const novo=e.target.value.trim();
  if(item[campo]===novo)return;
  item[campo]=novo;item.status='pendente';item.selecionado=true;item.dados=null;item.duplicado=null;item.erro='';
  renderizar();status('Dados alterados: clique em Pesquisar novamente para verificar duplicação e composição.');
  return;
 }
 const nutriente=e.target.dataset.nutriente;
 if(nutriente&&item.dados){
  const [grupo,chave]=nutriente.split(':');
  const destino=grupo==='macro'?item.dados.macros:grupo==='micro'?item.dados.micros:null;
  if(destino)destino[chave]=e.target.value===''?null:Number(e.target.value);
 }
});
$('listaImportacaoAlimentos').addEventListener('click',e=>{
 const botao=e.target.closest('[data-pesquisar]');
 if(!botao||salvando||pesquisando)return;
 const indice=Number(botao.dataset.pesquisar),token=operacao;
 pesquisando=true;renderizar();status('Repesquisando '+itens[indice].nome+'…');
 pesquisarItem(indice,token).then(()=>{if(token!==operacao)return;pesquisando=false;status('Consulta concluída. Confira os dados antes de salvar.');renderizar();});
});
$('salvarImportacaoAlimentos').addEventListener('click',salvar);
renderizar();
})();
