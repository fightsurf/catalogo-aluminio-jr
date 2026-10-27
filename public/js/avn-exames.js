/* AVN · Saúde / Exames Laboratoriais */
(()=>{'use strict';
const $=id=>document.getElementById(id),API='/avn/sistema/api/exames';
const S={usuario:'',catalogo:[],resultados:[],previa:[]};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const num=v=>v==null||v===''?null:Number(String(v).trim().replace(',','.'));
const fmt=v=>v==null||v===''?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:4});
const strDate=v=>String(v||'').slice(0,10);
const localDate=()=>{const d=new Date(),p=x=>String(x).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());};
function alertar(s,erro=false){const e=$('exAlerta');e.hidden=false;e.textContent=s;e.className='avn-alert'+(erro?' error':'');clearTimeout(alertar.timer);alertar.timer=setTimeout(()=>e.hidden=true,6500);}
function status(s){$('exImportStatus').textContent=s;}
async function api(url,options={}){
 const r=await fetch(API+url,{credentials:'same-origin',...options});
 if(r.redirected&&r.url.includes('/login'))throw Error('Sessão expirada. Entre novamente.');
 const j=await r.json().catch(()=>{throw Error('Resposta inválida do servidor.');});
 if(!r.ok)throw Error(j.erro||'Operação não concluída.');return j;
}
const json=(url,method,body)=>api(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const exam=id=>S.catalogo.find(c=>String(c.id)===String(id));
const byName=name=>S.catalogo.find(c=>[c.nome,...(c.aliases||[])].some(t=>norm(t)===norm(name)));
const modal=(id,open=true)=>open?$(id).showModal():$(id).close();
async function loadUsers(){
 const r=await fetch('/api/avn/usuarios',{credentials:'same-origin'});
 if(!r.ok)throw Error('Falha ao carregar usuários AVN.');
 const users=await r.json();
 $('exUsuario').innerHTML='<option value="">Selecione</option>'+users.map(u=>'<option value="'+esc(u.id)+'">'+esc(u.nome)+'</option>').join('');
 const prev=localStorage.getItem('avn_exames_usuario');
 const chosen=users.find(u=>String(u.id)===prev)||users[0];
 if(chosen){$('exUsuario').value=chosen.id;S.usuario=String(chosen.id);}
}
async function loadCatalog(){
 S.catalogo=(await api('/catalogo')).filter(x=>x.tipo==='indicador');
 $('exListaNomes').innerHTML=S.catalogo.map(c=>'<option value="'+esc(c.nome)+'"></option>').join('');
 $('exIndicador').innerHTML='<option value="">Selecione um indicador</option>'+S.catalogo.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.grupo+' · '+c.nome)+'</option>').join('');
}
async function loadResults(){
 if(!S.usuario){S.resultados=[];render();return;}
 S.resultados=await api('/resultados?usuarioId='+encodeURIComponent(S.usuario));
 render();
}
function reference(r){
 const a=r.limite_inferior!=null?fmt(r.limite_inferior):'—';
 const b=r.limite_superior!=null?fmt(r.limite_superior):'—';
 return (r.limite_inferior!=null||r.limite_superior!=null?a+' a '+b+' '+(r.unidade||''):'')+(r.referencia_texto?' · '+r.referencia_texto:'')||'Não informada';
}
function render(){
 const q=norm($('exBusca').value);
 const rows=S.resultados.filter(r=>!q||norm(r.exame_nome+' '+r.codigo+' '+r.grupo+' '+r.laboratorio).includes(q));
 $('exContagem').textContent=rows.length+' registro(s)';
 $('exResultados').innerHTML=rows.length?rows.map(r=>'<article class="avn-ex-item"><div><strong>'+esc(r.exame_nome)+'</strong><small>'+esc(strDate(r.data_coleta).split('-').reverse().join('/'))+' · '+esc(r.grupo)+'</small><div class="avn-ex-value">'+esc(r.valor!=null?fmt(r.valor):r.valor_texto)+' <span>'+esc(r.unidade)+'</span></div><small>Referência: '+esc(reference(r))+'</small><small>'+esc([r.laboratorio,r.material,r.metodo].filter(Boolean).join(' · '))+'</small></div><div class="avn-ex-actions"><button type="button" class="secondary" data-edit="'+r.id+'">Editar</button><button type="button" class="delete" data-del="'+r.id+'">Excluir</button></div></article>').join(''):'<p class="muted">Nenhum resultado encontrado.</p>';
 $('exResultados').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(S.resultados.find(r=>String(r.id)===b.dataset.edit)));
 $('exResultados').querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir este resultado?'))return;try{await api('/resultados/'+b.dataset.del+'?usuarioId='+encodeURIComponent(S.usuario),{method:'DELETE'});await loadResults();alertar('Resultado excluído.');}catch(e){alertar(e.message,true);}});
 chart();
}
function drawSvg(svg,tag,attrs,content){
 const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
 Object.entries(attrs||{}).forEach(([k,v])=>el.setAttribute(k,String(v)));
 if(content!=null)el.textContent=content;svg.appendChild(el);return el;
}
function chart(){
 const el=$('exGrafico'),details=$('exDetalheGrafico'),eid=$('exIndicador').value;
 details.textContent='';
 if(!eid){el.innerHTML='<p class="muted">Selecione um indicador para visualizar o histórico.</p>';return;}
 const all=S.resultados.filter(r=>String(r.exame_id)===eid&&r.valor!=null).sort((a,b)=>strDate(a.data_coleta).localeCompare(strDate(b.data_coleta))||Number(a.id)-Number(b.id));
 if(!all.length){el.innerHTML='<p class="muted">Este indicador ainda não tem resultados numéricos.</p>';return;}
 // Não sobrepor unidades ou métodos diferentes: incompatibilidades permanecem listadas no histórico.
 const latest=all[all.length-1],unit=latest.unidade,method=norm(latest.metodo);
 const rows=all.filter(r=>r.unidade===unit&&norm(r.metodo)===method);
 const excluded=all.length-rows.length;
 const w=760,h=300,l=65,t=28,right=18,b=48,plotW=w-l-right,plotH=h-t-b;
 const vals=rows.map(r=>Number(r.valor));
 let lo=Math.min(...vals),hi=Math.max(...vals);
 if(lo===hi){lo-=Math.max(1,Math.abs(lo)*0.1);hi+=Math.max(1,Math.abs(hi)*0.1);}
 else{const pad=(hi-lo)*0.12;lo-=pad;hi+=pad;}
 const times=rows.map(r=>Date.parse(strDate(r.data_coleta)+'T12:00:00Z'));
 const tmin=Math.min(...times),tmax=Math.max(...times);
 const x=(z,i)=>tmin===tmax?l+plotW*(rows.length===1?0.5:i/(rows.length-1)):l+(z-tmin)/(tmax-tmin)*plotW;
 const y=v=>t+plotH-(v-lo)/(hi-lo)*plotH;
 el.innerHTML='';
 const svg=drawSvg(el,'svg',{viewBox:'0 0 760 300',role:'img','aria-label':'Evolução histórica de '+exam(eid)?.nome});
 for(let i=0;i<=4;i++){
  const yy=t+plotH*i/4,v=hi-(hi-lo)*i/4;
  drawSvg(svg,'line',{x1:l,x2:w-right,y1:yy,y2:yy,stroke:'currentColor','stroke-opacity':'.15'});
  drawSvg(svg,'text',{x:l-10,y:yy+5,'text-anchor':'end','font-size':13,fill:'currentColor'},fmt(v));
 }
 drawSvg(svg,'line',{x1:l,x2:w-right,y1:t+plotH,y2:t+plotH,stroke:'currentColor','stroke-opacity':'.45'});
 for(const i of [0,rows.length-1].filter((v,i,a)=>a.indexOf(v)===i)){
  drawSvg(svg,'text',{x:x(times[i],i),y:h-15,'text-anchor':rows.length===1?'middle':i===0?'start':'end','font-size':13,fill:'currentColor'},strDate(rows[i].data_coleta).split('-').reverse().join('/'));
 }
 if(rows.length>1)drawSvg(svg,'polyline',{points:rows.map((r,i)=>x(times[i],i)+','+y(Number(r.valor))).join(' '),fill:'none',stroke:'#4b9ce8','stroke-width':3,'stroke-linejoin':'round'});
 for(let i=0;i<rows.length;i++){
  const r=rows[i],circle=drawSvg(svg,'circle',{cx:x(times[i],i),cy:y(Number(r.valor)),r:6,fill:'#287dcc',stroke:'#fff','stroke-width':2,tabindex:0,role:'button','aria-label':'Resultado em '+strDate(r.data_coleta)+': '+fmt(r.valor)+' '+unit});
  drawSvg(circle,'title',{},strDate(r.data_coleta)+' · '+fmt(r.valor)+' '+unit+' · referência: '+reference(r));
  const show=()=>{details.textContent='Coleta: '+strDate(r.data_coleta).split('-').reverse().join('/')+' | Resultado: '+fmt(r.valor)+' '+unit+' | Referência: '+reference(r)+' | Material: '+(r.material||'Não informado')+' | Método: '+(r.metodo||'Não informado')+' | Laboratório: '+(r.laboratorio||'Não informado');};
  circle.addEventListener('mouseenter',show);circle.addEventListener('focus',show);circle.addEventListener('click',show);
 }
 const ref=reference(latest);
 details.textContent='Referência do registro mais recente: '+ref+'. '+(excluded?'Há '+excluded+' resultado(s) com unidade ou método diferente, omitidos deste gráfico para evitar comparação inválida.':'');
}
function fieldsFromRow(r){
 return {exNome:r?.exame_nome||'',exData:strDate(r?.data_coleta)||localDate(),exValor:r?.valor??'',exValorTexto:r?.valor_texto??'',exUnidade:r?.unidade||'',exRefMin:r?.limite_inferior??'',exRefMax:r?.limite_superior??'',exRefTexto:r?.referencia_texto||'',exMaterial:r?.material||'',exMetodo:r?.metodo||'',exLab:r?.laboratorio||'',exObs:r?.observacoes||''};
}
function openEditor(row=null){
 $('exModalTitulo').textContent=row?'Editar resultado':'Registrar exame';$('exId').value=row?.id||'';
 for(const [field,value] of Object.entries(fieldsFromRow(row)))$(field).value=value;
 modal('exModal');
}
async function referenceSuggestion(){
 if($('exId').value||!S.usuario)return;
 const c=byName($('exNome').value);if(!c)return;
 // Apenas unidade padrão é preenchida sem contexto clínico.
 if(!$('exUnidade').value)$('exUnidade').value=c.unidade_padrao||'';
 if(!($('exLab').value||$('exMetodo').value||$('exMaterial').value))return;
 try{
  const params=new URLSearchParams({usuarioId:S.usuario,exameId:c.id,laboratorio:$('exLab').value,metodo:$('exMetodo').value,material:$('exMaterial').value});
  const r=await api('/referencia?'+params);
  if(norm($('exNome').value)!==norm(c.nome))return;
  if(r.referencia&&confirm('Aplicar a referência do último exame com este mesmo laboratório, material e método?')){
   const a=r.referencia;
   $('exRefMin').value=a.limite_inferior??'';$('exRefMax').value=a.limite_superior??'';
   $('exRefTexto').value=a.referencia_texto||'';$('exUnidade').value=a.unidade;
  }
 }catch(e){alertar(e.message,true);}
}
function formData(){
 const c=byName($('exNome').value);
 if(!c)throw Error('Selecione um exame existente no catálogo.');
 const r={usuarioId:S.usuario,exame_id:c.id,data_coleta:$('exData').value,valor:$('exValor').value,valor_texto:$('exValorTexto').value,unidade:$('exUnidade').value,
 limite_inferior:$('exRefMin').value,limite_superior:$('exRefMax').value,referencia_texto:$('exRefTexto').value,
 material:$('exMaterial').value,metodo:$('exMetodo').value,laboratorio:$('exLab').value,observacoes:$('exObs').value,origem:'manual'};
 if(!r.valor&&!r.valor_texto)throw Error('Informe um resultado.');
 return r;
}
async function saveManual(e){
 e.preventDefault();if(!S.usuario)return alertar('Selecione um usuário.',true);
 try{
  const data=formData(),rid=$('exId').value;
  const out=await json('/resultados'+(rid?'/'+rid:''),rid?'PUT':'POST',data);
  modal('exModal',false);await loadResults();
  $('exIndicador').value=data.exame_id;chart();alertar(out.duplicado?'Esse resultado já estava cadastrado.':'Resultado salvo.');
 }catch(e){alertar(e.message,true);}
}
const pvFields=[['data_coleta','Data da coleta','date'],['valor','Valor numérico','text'],['valor_texto','Resultado textual','text'],['unidade','Unidade','text'],['limite_inferior','Referência mín.','text'],['limite_superior','Referência máx.','text'],['referencia_texto','Referência descritiva','text'],['material','Material','text'],['metodo','Método','text'],['laboratorio','Laboratório','text']];
function renderPreview(){
 $('exPrevia').hidden=false;
 $('exLinhasPrevia').innerHTML=S.previa.map((r,i)=>'<fieldset class="avn-ex-preview-row" data-index="'+i+'"><legend>Exame '+(i+1)+': '+esc(r.nome||'Não identificado')+'</legend>'+
 '<label class="avn-field">Associar ao catálogo<select data-field="exame_id"><option value="">Selecione um indicador</option>'+
 S.catalogo.map(c=>'<option value="'+esc(c.id)+'"'+(String(c.id)===String(r.exame_id)?' selected':'')+'>'+esc(c.grupo+' · '+c.nome)+'</option>').join('')+'</select></label>'+
 '<div class="avn-ex-grid">'+pvFields.map(([key,label,type])=>'<label class="avn-field">'+esc(label)+'<input data-field="'+key+'" type="'+type+'" value="'+esc(r[key]??'')+'"></label>').join('')+'</div>'+
 '<label class="avn-ex-check"><input type="checkbox" data-field="incluir" checked> Importar este resultado</label>'+
 (r.precisa_revisao?'<p class="muted">Confira especialmente a identificação, a data e os valores.</p>':'')+'</fieldset>').join('');
}
async function interpretar(){
 const texto=$('exTextoLaudo').value,pdf=$('exArquivo').files[0];
 if(!texto.trim()&&!pdf)return status('Cole um laudo ou selecione um PDF.');
 const btn=$('exInterpretar');btn.disabled=true;$('exPrevia').hidden=true;status('Interpretando o laudo…');
 try{
  const fd=new FormData();fd.append('texto',texto);if(pdf)fd.append('pdf',pdf);
  const data=await api('/interpretar',{method:'POST',body:fd});
  S.previa=data.resultados;
  if(!S.previa.length){status('A IA não identificou resultados. Confira o documento.');return;}
  renderPreview();status(S.previa.length+' resultado(s) identificado(s). Confira e corrija antes de salvar.');
 }catch(e){status(e.message);}finally{btn.disabled=false;}
}
async function saveImported(){
 if(!S.usuario)return status('Selecione um usuário primeiro.');
 const rows=[...$('exLinhasPrevia').querySelectorAll('[data-index]')].filter(el=>el.querySelector('[data-field="incluir"]').checked);
 if(!rows.length)return status('Selecione pelo menos um resultado.');
 const results=rows.map(el=>{const data={origem:'ia'};el.querySelectorAll('[data-field]').forEach(input=>{if(input.dataset.field!=='incluir')data[input.dataset.field]=input.value;});return data;});
 if(results.some(r=>!r.exame_id||!r.data_coleta||!r.unidade||(!r.valor&&!r.valor_texto)))return status('Complete exame, data, resultado e unidade de todas as linhas selecionadas.');
 const btn=$('exConfirmar');btn.disabled=true;status('Salvando resultados conferidos…');
 try{
  const r=await json('/resultados/lote','POST',{usuarioId:S.usuario,resultados:results});
  modal('exImportModal',false);await loadResults();alertar(r.inseridos+' resultado(s) salvo(s); '+r.duplicados+' duplicado(s) ignorado(s).');
 }catch(e){status(e.message);}finally{btn.disabled=false;}
}
async function start(){
 try{await Promise.all([loadUsers(),loadCatalog()]);await loadResults();}
 catch(e){alertar(e.message,true);}
 $('exUsuario').onchange=async e=>{S.usuario=e.target.value;localStorage.setItem('avn_exames_usuario',S.usuario);try{await loadResults();}catch(err){alertar(err.message,true);}};
 $('exBusca').oninput=render;$('exIndicador').onchange=chart;
 $('exNovo').onclick=()=>openEditor();$('exFechar').onclick=() =>modal('exModal',false);
 $('exCancelar').onclick=()=>modal('exModal',false);
 $('exForm').onsubmit=saveManual;
 $('exNome').onchange=()=>{const c=byName($('exNome').value);if(c)$('exUnidade').value=c.unidade_padrao||'';referenceSuggestion();};
 for(const f of ['exLab','exMaterial','exMetodo'])$(f).addEventListener('change',referenceSuggestion);
 $('exImportar').onclick=()=>{S.previa=[];$('exPrevia').hidden=true;$('exTextoLaudo').value='';$('exArquivo').value='';status('');modal('exImportModal');};
 $('exImportFechar').onclick=()=>modal('exImportModal',false);
 $('exCancelarImport').onclick=()=>modal('exImportModal',false);
 $('exInterpretar').onclick=interpretar;$('exConfirmar').onclick=saveImported;
}
start();
})();