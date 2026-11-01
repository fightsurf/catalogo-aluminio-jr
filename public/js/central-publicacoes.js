(()=>{'use strict';
const base='/marketing/central-publicacoes',get=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=s=>s?new Date(s).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'}):'—';
let latest,catOrder=[],cats=[],logCursor;
async function req(url,options={}){
 const r=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
 const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error(j.message||j.error||'Falha de comunicação');
 return j.data;
}
const put=(url,data)=>req(url,{method:'PUT',body:JSON.stringify(data)});
const post=(url,data={})=>req(url,{method:'POST',body:JSON.stringify(data)});
function feedback(s){const x=get('feedback');x.textContent=s;x.style.display='block';}
function info(d,c){
 if(!c)return 'Indisponível';
 const min=d?.ritmo?.intervalo_global_minutos||0,ultima=d?.ritmo?.ultima_reserva_em;
 const reserva=ultima?Date.parse(ultima)+min*60000:0;
 const proxima=c.proxima_execucao?Date.parse(c.proxima_execucao):0;
 const estimativa=c.ativo&&proxima?fmt(Math.max(reserva,proxima)): 'não agendada';
 return (c.ativo?'LIGADO':'DESLIGADO')+' · Próxima previsão mínima: '+estimativa+
 (c.ultimo_erro?' · ERRO: '+c.ultimo_erro:'');
}
function fields(prefix,c){
 get(prefix+'-ativo').checked=!!c?.ativo;
 for(const [k,v] of [['intervalo','intervalo_minutos'],['inicio','inicio'],['fim','fim']])get(prefix+'-'+k).value=c?.[v]??'';
}
function categoryView(){
 get('categorias').innerHTML=catOrder.map((id,i)=>{
 const cat=cats.find(x=>Number(x.id)===id);
 if(!cat)return '';
 return '<div class="cat"><input type="checkbox" data-cat="'+id+'" '+(cat.sel?'checked':'')+'><span>'+esc(cat.nome)+'</span>'+
 '<button class="outline" type="button" data-move="'+id+'" data-dir="-1" '+(i===0?'disabled':'')+'>↑</button>'+
 '<button class="outline" type="button" data-move="'+id+'" data-dir="1" '+(i===catOrder.length-1?'disabled':'')+'>↓</button></div>';
 }).join('');
}
get('categorias').addEventListener('click',e=>{
 const b=e.target.closest('[data-move]');if(!b)return;
 const i=catOrder.indexOf(Number(b.dataset.move)),n=i+Number(b.dataset.dir);
 if(i<0||n<0||n>=catOrder.length)return;
 [catOrder[i],catOrder[n]]=[catOrder[n],catOrder[i]];categoryView();
});
get('categorias').addEventListener('change',e=>{
 if(e.target.matches('[data-cat]')){const c=cats.find(x=>Number(x.id)===Number(e.target.dataset.cat));if(c)c.sel=e.target.checked;}
});
async function hydrate(){
 const d=latest;get('pausado').checked=!!d.ritmo.pausado;
 get('global-min').value=d.ritmo.intervalo_global_minutos;
 for(const [p,k] of [['status','statuszap'],['youtube','youtube'],['ofertas','ofertas']])
   get('prio-'+p).value=Number(d.ritmo.prioridades?.[k]||({statuszap:1,youtube:2,ofertas:3}[k]));
 fields('s',d.status.config);get('s-midia').value=d.status.config.tipo_midia;
 fields('y',d.youtube.config);fields('o',d.ofertas.config);
 cats=await req('/api/whatsapp/status/categorias');
 if(!Array.isArray(cats))cats=cats?.data||[];
 const order=(d.status.config.categorias||[]).map(Number);
 cats=cats.map(c=>({...c,sel:order.includes(Number(c.id))}));
 catOrder=[...order.filter(id=>cats.some(c=>Number(c.id)===id)),
    ...cats.map(c=>Number(c.id)).filter(id=>!order.includes(id))];
 categoryView();
}
function draw(){
 const d=latest,pace=d.ritmo;
 get('global-status').textContent=(pace.pausado?'PAUSADO — novos envios bloqueados':'FUNIL LIBERADO')+
 ' · Intervalo: '+pace.intervalo_global_minutos+' min · Última reserva: '+fmt(pace.ultima_reserva_em);
 get('s-status').textContent=info(d,d.status.config)+
 (d.status.config.lote_atual_id?' · Lote em andamento nº '+d.status.config.lote_atual_id:'');
 get('y-status').textContent=info(d,d.youtube.config)+
 ' · Último vídeo: '+(d.youtube.ultimo_publicado?.produto_nome||'nenhum')+
 (d.youtube.pendencia?' · PENDÊNCIA: '+d.youtube.pendencia.estado:'');
 get('o-status').textContent=info(d,d.ofertas.config)+
 ' · Último kit: '+(d.ofertas.ultimo_publicado?.produto_nome||'nenhum')+
 (d.ofertas.pendencia?' · PENDÊNCIA: '+d.ofertas.pendencia.estado:'');
 const stats=d.fila.resumo||{};
 get('stats').innerHTML=[['Pendentes',stats.pendentes],['Em execução',stats.em_execucao],['Concluídas',stats.concluidas],['Exigem conferência',stats.atencao]]
 .map(([label,n])=>'<div class="pill">'+esc(label)+'<b>'+Number(n||0)+'</b></div>').join('');
 get('fila').innerHTML=(d.fila.itens||[]).map(item=>{
 const review=['incerto','atencao'].includes(item.estado);
 return '<tr><td>#'+Number(item.id)+'<br>'+esc(item.origem)+'</td><td>'+esc(item.produto_nome||item.categoria_nome||item.tipo)+'</td>'+
 '<td>'+esc(item.estado)+'</td><td>'+fmt(item.criado_em)+'<br>'+esc(item.erro||'')+'</td>'+
 '<td>'+(review?'<button data-review="'+Number(item.id)+'" data-action="confirmar_publicado" class="outline">Confirmar publicado</button>'+
 '<button data-review="'+Number(item.id)+'" data-action="confirmar_nao_publicado" class="outline">Confirmar NÃO publicado</button>':'—')+'</td></tr>';
 }).join('')||'<tr><td colspan="5">Nenhuma tarefa pendente.</td></tr>';
 get('lotes').innerHTML=(d.fila.lotes||[]).map(l=>'<tr><td>#'+Number(l.id)+'</td><td>'+esc(l.origem)+'</td><td>'+esc(l.estado)+'</td><td>'+fmt(l.criado_em)+'</td></tr>').join('');
 get('legados').innerHTML=(d.status.historico||[]).filter(x=>x.origem==='legado'&&['revisao','executando'].includes(x.estado))
 .map(x=>'<p class="note">Execução antiga #'+Number(x.id)+' requer conferência. <button type="button" data-legacy="'+Number(x.id)+'">Recuperar execução antiga</button></p>').join('');
}
async function refresh(h=false){
 try{latest=await req(base+'/api/painel');draw();if(h)await hydrate();}
 catch(e){feedback('Erro ao carregar Central: '+e.message);}
}
const binding=(id,fn)=>get(id).addEventListener('submit',async e=>{
 e.preventDefault();const b=e.target.querySelector('button[type=submit]');b.disabled=true;
 try{await fn();feedback('Configuração salva.');await refresh(true);}
 catch(x){feedback('Não foi possível salvar: '+x.message);}finally{b.disabled=false;}
});
binding('global',async()=>{
 const prioridades={statuszap:Number(get('prio-status').value),youtube:Number(get('prio-youtube').value),ofertas:Number(get('prio-ofertas').value)};
 if(new Set(Object.values(prioridades)).size!==3)throw Error('Escolha prioridades diferentes para cada aplicativo.');
 const pausado=get('pausado').checked;
 if(!pausado&&latest.ritmo.pausado&&!confirm('Retomar o envio de todas as tarefas pendentes no funil?'))return;
 await put(base+'/api/global',{pausado,intervalo_global_minutos:Number(get('global-min').value),prioridades});
});
function body(prefix){return {ativo:get(prefix+'-ativo').checked,intervalo_minutos:Number(get(prefix+'-intervalo').value),
  inicio:get(prefix+'-inicio').value,fim:get(prefix+'-fim').value};}
function confirmActive(body,label){return !body.ativo||confirm('Ativar publicações reais automáticas de '+label+'?');}
binding('status',async()=>{
 const b=body('s');b.tipo_midia=get('s-midia').value;b.categorias=catOrder.filter(id=>cats.some(x=>Number(x.id)===id&&x.sel));
 if(!confirmActive(b,'Status WhatsApp'))return;
 await put(base+'/api/status',b);
});
for(const [name,prefix,label] of [['youtube','y','YouTube'],['ofertas','o','Kits Feirinha']]){
 binding(name,async()=>{const b=body(prefix);if(!confirmActive(b,label))return;
   b.intervalo_global_minutos=Number(get('global-min').value);
   await put(base+'/api/'+name,b);
 });
}
get('fila').addEventListener('click',async e=>{
 const button=e.target.closest('[data-review]');if(!button)return;button.disabled=true;
 try{
 const id=Number(button.dataset.review),action=button.dataset.action;
 const data=await req(base+'/api/itens/'+id);
 const uncertain=(data?.canais||[]).filter(c=>c.estado==='incerto');
 let canal=null;
 if(uncertain.length>1){
  canal=prompt('Digite exatamente o canal conferido: '+uncertain.map(c=>c.canal).join(', '));
  if(!uncertain.some(c=>c.canal===canal))throw Error('Canal não selecionado.');
 }else if(uncertain.length===1)canal=uncertain[0].canal;
 const texto=action==='confirmar_publicado'?'CONFIRMOU que foi publicado':'CONFIRMOU que NÃO foi publicado';
 if(!confirm('Você conferiu na rede social e '+texto+'? Esta decisão ficará registrada.'))return;
 await post(base+'/api/itens/'+id+'/conciliar',{acao:action,canal});
 feedback('Conciliação registrada.');await refresh(false);
 }catch(x){feedback(x.message);}finally{button.disabled=false;}
});
get('legados').addEventListener('click',async e=>{
 const b=e.target.closest('[data-legacy]');if(!b)return;
 if(!confirm('Importar execução antiga para o funil? Envios incertos continuarão exigindo conferência.'))return;
 try{await post(base+'/api/recuperar-legado/'+Number(b.dataset.legacy));feedback('Execução importada.');await refresh(true);}
 catch(x){feedback(x.message);}
});
async function logs(append=false){
 const p=new URLSearchParams({limite:'60'}),level=get('nivel').value,from=get('desde').value;
 if(level)p.set('nivel',level);if(from)p.set('de',from+'T00:00:00-03:00');
 if(append&&logCursor)p.set('antes',logCursor);
 const d=await req(base+'/api/logs?'+p);logCursor=d.proximo_cursor;
 const html=(d.logs||[]).map(x=>'<p><b>'+esc(x.codigo)+'</b> · '+fmt(x.criado_em)+' · '+esc(x.origem||'')+
 '<br>'+esc(x.mensagem)+'</p>').join('');
 if(append)get('logs').insertAdjacentHTML('beforeend',html);
 else get('logs').innerHTML=html||'<p>Sem eventos.</p>';
 get('mais-logs').hidden=!logCursor;
}
get('logs-btn').onclick=()=>logs().catch(e=>feedback(e.message));
get('mais-logs').onclick=()=>logs(true).catch(e=>feedback(e.message));
get('atualizar').onclick=()=>refresh(false);
refresh(true).then(()=>logs().catch(e=>feedback(e.message)));
setInterval(()=>{if(!document.hidden)refresh(false);},30000);
})();