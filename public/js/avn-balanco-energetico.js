(()=>{'use strict';
const $=id=>document.getElementById(id);
const tz='America/Sao_Paulo';
const numero=(x,dec=0)=>Number(x).toLocaleString('pt-BR',{maximumFractionDigits:dec});
const diaLocal=()=>{
 const p=new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=k=>p.find(x=>x.type===k).value;
 return get('year')+'-'+get('month')+'-'+get('day');
};
const rotulo=data=>new Date(data+'T12:00:00-03:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const completo=data=>new Date(data+'T12:00:00-03:00').toLocaleDateString('pt-BR');
const conf={
 ingestao:{nome:'Calorias consumidas',unidade:'kcal',get:d=>d.ingestao?.valor},
 tmb:{nome:'TMB',unidade:'kcal/dia',get:d=>d.tmb?.valor},
 passos:{nome:'Passos',unidade:'passos',get:d=>d.passos?.valor},
 calorias_ativas:{nome:'Calorias ativas queimadas',unidade:'kcal',get:d=>d.calorias_ativas?.valor}
};
let usuario='',data='',sequencia=0;
const vazio=v=>v===null||v===undefined||!Number.isFinite(Number(v));
async function json(url){
 const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
 if(r.redirected&&r.url.includes('/login'))throw Error('Sessão expirada. Entre novamente.');
 const body=await r.json().catch(()=>{throw Error('Resposta inválida do servidor.');});
 if(!r.ok)throw Error(body.erro||'Falha na consulta.');
 return body;
}
function mostrarMetricas(dias,selecionado) {
 for(const [chave,metrica] of Object.entries(conf)){
  const alvo=$('grafico-'+chave),dom=$('valor-'+chave),atual=metrica.get(selecionado);
  dom.textContent=vazio(atual)?'Sem dados':numero(atual)+' '+metrica.unidade;
  if(chave==='calorias_ativas'&&selecionado.calorias_ativas?.sem_registros)dom.textContent+=' (sem registros)';
  alvo.replaceChildren();
  const maior=Math.max(1,...dias.map(d=>vazio(metrica.get(d))?0:Number(metrica.get(d))));
  for(const d of dias){
   const v=metrica.get(d),tem=!vazio(v),b=document.createElement('button');
   b.type='button';b.className='barra-dia'+(d.data===selecionado.data?' selecionado':'')+(tem?'':' sem-dado');
   const nota=chave==='calorias_ativas'&&d.calorias_ativas?.sem_registros?' (sem registros)':'';
   b.title=completo(d.data)+' — '+(tem?numero(v,1)+' '+metrica.unidade:'sem dados')+nota;
   b.setAttribute('aria-label',metrica.nome+' em '+completo(d.data)+': '+(tem?numero(v,1)+' '+metrica.unidade:'sem dados')+nota);
   const trilho=document.createElement('span');trilho.className='trilho';
   const coluna=document.createElement('span');coluna.className='coluna';
   coluna.style.height=(tem?Math.max(3,Number(v)/maior*100):0)+'%';trilho.append(coluna);
   const etiqueta=document.createElement('span');etiqueta.className='dia';etiqueta.textContent=rotulo(d.data);
   b.append(trilho,etiqueta);
   b.onclick=()=>{if(d.data!==data){data=d.data;$('data').value=data;atualizar();}};
   alvo.append(b);
  }
 }
 $('nota-tmb').textContent=selecionado.tmb?.medida_em
  ? 'Última bioimpedância válida até esta data: '+new Date(selecionado.tmb.medida_em).toLocaleDateString('pt-BR',{timeZone:tz})
  : 'Sem TMB disponível nos 90 dias anteriores';
}
function mostrarSaldo(d){
 const alvo=$('saldo');alvo.className='saldo';
 const s=d.saldo;
 if(s.classificacao==='indisponivel'){
  $('saldo-valor').textContent='Dados insuficientes';
  $('saldo-descricao').textContent='Faltam: '+s.faltam.join(', ')+'.';
  $('saldo-formula').textContent=d.ingestao?.incompletos>0?'Há alimentos com calorias desconhecidas no diário.':'O diário alimentar e a TMB são necessários para calcular o balanço.';
  return;
 }
 alvo.classList.add(s.classificacao);
 $('saldo-valor').textContent=(s.classificacao==='deficit'?'Déficit':s.classificacao==='superavit'?'Superávit':'Equilíbrio')+' de '+numero(Math.abs(s.saldo_kcal))+' kcal';
 $('saldo-descricao').textContent=(s.classificacao==='deficit'?'Gasto estimado acima do consumido.':s.classificacao==='superavit'?'Consumo acima do gasto estimado.':'Consumo e gasto estimado próximos.')+(d.calorias_ativas?.sem_registros?' Sem registros de calorias ativas: adotadas 0 kcal para o cálculo.':'')+(d.data===diaLocal()?' Resultado provisório de hoje.':'');
 $('saldo-formula').textContent='Consumidas: '+numero(d.ingestao.valor)+' kcal − (TMB: '+numero(d.tmb.valor)+' + ativas: '+numero(d.calorias_ativas.valor)+') = '+numero(s.saldo_kcal,1)+' kcal.';
}
async function atualizar(){
 const seq=++sequencia;
 usuario=$('usuario').value;data=$('data').value;
 if(!usuario||!data){$('mensagem').textContent='Selecione usuário e data.';return;}
 $('mensagem').textContent='Carregando…';
 try{
  const resultado=await json('/avn/sistema/api/balanco-energetico/'+encodeURIComponent(usuario)+'?data='+encodeURIComponent(data));
  if(seq!==sequencia)return;
  const escolhido=resultado.dias.find(x=>x.data===data);
  if(!escolhido)throw Error('Data não encontrada.');
  mostrarMetricas(resultado.dias,escolhido);mostrarSaldo(escolhido);
  $('mensagem').textContent='Valores diários · '+completo(data)+' · barras anteriores para comparação por dia.';
 }catch(e){if(seq===sequencia){$('mensagem').textContent=e.message;for(const k of Object.keys(conf)){$('valor-'+k).textContent='—';$('grafico-'+k).replaceChildren();}$('saldo-valor').textContent='—';$('saldo-descricao').textContent='Falha na consulta.';$('saldo-formula').textContent='';}}
}
async function iniciar(){
 data=diaLocal();$('data').value=data;$('data').max=data;
 try{
  const usuarios=await json('/api/avn/usuarios');
  $('usuario').replaceChildren();
  for(const u of usuarios){const opt=document.createElement('option');opt.value=u.id;opt.textContent=u.nome;$('usuario').append(opt);}
  const anterior=localStorage.getItem('avn_nutricao_usuario')||localStorage.getItem('avn_treinos_usuario');
  if(usuarios.some(u=>String(u.id)===anterior))$('usuario').value=anterior;
  usuario=$('usuario').value;
  if(!usuario){$('mensagem').textContent='Cadastre um usuário primeiro.';return;}
  $('usuario').onchange=()=>{localStorage.setItem('avn_nutricao_usuario',$('usuario').value);atualizar();};
  $('data').onchange=atualizar;
  atualizar();
 }catch(e){$('mensagem').textContent=e.message;}
}
iniciar();
})();
