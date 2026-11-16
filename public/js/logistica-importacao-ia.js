(() => {
'use strict';
const API='/api/logistica/importacao-ia';
let overlay=null, resultado=null, cidades=[];
const $=id=>overlay.querySelector('#'+id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function aviso(msg,erro=false){const el=$('ia-aviso');el.textContent=msg;el.style.color=erro?'#b91c1c':'#166534';}
async function json(url,opt){const r=await fetch(url,{credentials:'same-origin',...opt});const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(v.erro||v.error||'Falha na operação');return v;}
function fechar(){if(overlay)overlay.style.display='none';}
function montar(){
  if(overlay)return;
  const estilo=document.createElement('style');
  estilo.textContent='#ia-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#0009;z-index:1200;padding:12px;box-sizing:border-box}'+
    '#ia-overlay .ia-caixa{width:min(900px,100%);max-height:94vh;overflow:auto;background:#fff;color:#17202a;border-radius:10px;padding:18px;box-sizing:border-box}'+
    '#ia-overlay label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}'+
    '#ia-overlay input:not([type=checkbox]):not([type=file]),#ia-overlay select{width:100%;padding:8px;box-sizing:border-box;border:1px solid #b9c4d0;border-radius:5px;margin:0}'+
    '#ia-overlay input[type=checkbox]{width:auto;margin-right:7px}'+
    '#ia-overlay button{background:#2563eb;color:white;border:0;border-radius:5px;padding:8px 12px;margin:4px;cursor:pointer}'+
    '#ia-overlay button:disabled{opacity:.5;cursor:wait}'+
    '#ia-overlay .ia-row{border:1px solid #dce3ec;border-radius:6px;padding:10px;margin:9px 0;display:grid;grid-template-columns:1fr 1.7fr;gap:8px}'+
    '#ia-overlay .ia-campo{display:grid;grid-template-columns:1fr 1fr;gap:12px}'+
    '#ia-overlay .ia-ajuda{font-size:12px;color:#5d6876}'+
    '@media(max-width:600px){#ia-overlay .ia-row,#ia-overlay .ia-campo{grid-template-columns:1fr}}';
  document.head.appendChild(estilo);
  overlay=document.createElement('div');overlay.id='ia-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
  overlay.innerHTML='<section class="ia-caixa">'+
    '<div style="display:flex;align-items:center;justify-content:space-between"><h3>🤖 Importar com IA</h3><button type="button" id="ia-fechar">Fechar</button></div>'+
    '<p class="ia-ajuda">Envie foto JPG, PNG ou WEBP (até 8 MB). Os dados não são gravados sem sua confirmação.</p>'+
    '<input id="ia-imagem" type="file" accept="image/jpeg,image/png,image/webp">'+
    '<button id="ia-ler" type="button">Ler foto</button>'+
    '<p id="ia-aviso" role="status"></p>'+
    '<div id="ia-preview" hidden><hr><h4>Transportadora</h4><p id="ia-matches" class="ia-ajuda"></p>'+
    '<label for="ia-destino">Cadastrar em qual transportadora?</label><select id="ia-destino"></select>'+
    '<label for="ia-nome">Nome confirmado da nova transportadora</label><input id="ia-nome" maxlength="160">'+
    '<div class="ia-campo"><div><label for="ia-telefones">Telefones da foto</label><input id="ia-telefones" maxlength="180"></div>'+
    '<div><label for="ia-principal">Telefone principal</label><input id="ia-principal" maxlength="45"></div></div>'+
    '<label><input type="checkbox" id="ia-sobrescrever">Substituir telefones existentes</label>'+
    '<p class="ia-ajuda">Sem marcar a opção, telefones já cadastrados serão preservados e somente campos vazios serão preenchidos.</p>'+
    '<hr><h4>Cidades identificadas</h4><p id="ia-contagem" class="ia-ajuda"></p>'+
    '<div id="ia-cidades"></div><button id="ia-confirmar" type="button">Confirmar cadastro</button>'+
    '<button id="ia-cancelar" type="button">Cancelar</button></div></section>';
  document.body.appendChild(overlay);
  $('ia-fechar').onclick=fechar;$('ia-cancelar').onclick=fechar;
  $('ia-ler').onclick=interpretar;$('ia-confirmar').onclick=confirmar;
  $('ia-destino').onchange=()=>{const nova=$('ia-destino').value==='nova';$('ia-nome').disabled=!nova;$('ia-sobrescrever').disabled=nova;if(nova)$('ia-sobrescrever').checked=false;};
  overlay.onclick=e=>{if(e.target===overlay)fechar();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay?.style.display==='flex')fechar();});
}
function abrir(){montar();overlay.style.display='flex';}
function atualizarContagem(){
  const marcadas=cidades.filter(c=>c.marcada&&c.cidade_id).length;
  $('ia-contagem').textContent=cidades.length+' cidade(s) na foto, '+marcadas+' selecionada(s). As não selecionadas não serão vinculadas.';
}
function renderCidades(){
  const alvo=$('ia-cidades');alvo.innerHTML='';
  if(!cidades.length){alvo.textContent='Nenhuma cidade identificada: envie uma foto mais nítida.';return;}
  cidades.forEach(c=>{
    const duplicada=c.status==='repetida';
    const row=document.createElement('div');row.className='ia-row';
    row.innerHTML='<div><label><input class="ia-marcar" type="checkbox" '+(c.marcada?'checked':'')+' '+(!c.cidade_id||duplicada?'disabled':'')+'>'+
      escape(c.nome+(c.uf?' - '+c.uf:''))+'</label><p class="ia-ajuda">'+
      escape(duplicada?'Repetida na foto':c.cidade_id?'Correspondência confirmada':'Revisar município/UF')+'</p></div>'+
      '<div><label>Município no cadastro</label><select class="ia-select"><option value="">Selecione</option>'+
      (c.opcoes||[]).map(o=>'<option value="'+Number(o.id)+'" '+(Number(o.id)===Number(c.cidade_id)?'selected':'')+'>'+escape(o.nome+' - '+o.uf)+'</option>').join('')+
      '</select><div style="display:flex;gap:4px;margin-top:5px">'+
      '<input class="ia-busca" value="'+escape(c.nome)+'" aria-label="Nome da cidade">'+
      '<button class="ia-pesquisar" type="button">Buscar</button></div></div>';
    alvo.appendChild(row);
    const check=row.querySelector('.ia-marcar'),select=row.querySelector('.ia-select'),input=row.querySelector('.ia-busca'),btn=row.querySelector('.ia-pesquisar');
    check.onchange=()=>{c.marcada=check.checked;atualizarContagem();};
    select.onchange=()=>{c.cidade_id=Number(select.value)||null;c.marcada=Boolean(c.cidade_id)&&!duplicada;check.disabled=!c.cidade_id||duplicada;check.checked=c.marcada;atualizarContagem();};
    btn.onclick=async()=>{
      btn.disabled=true;
      try{
        const encontrados=await json(API+'/cidades?nome='+encodeURIComponent(input.value.trim())+'&uf='+encodeURIComponent(c.uf||''));
        select.innerHTML='<option value="">Selecione</option>'+encontrados.map(o=>'<option value="'+Number(o.id)+'">'+escape(o.nome+' - '+o.uf)+'</option>').join('');
        c.cidade_id=null;c.marcada=false;check.checked=false;check.disabled=true;atualizarContagem();
        aviso(encontrados.length?'Selecione o município correto.':'Cidade não localizada. Confira a grafia e UF.',!encontrados.length);
      }catch(e){aviso(e.message,true);}finally{btn.disabled=false;}
    };
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();btn.click();}};
    if(duplicada){select.disabled=true;input.disabled=true;btn.disabled=true;}
  });
  atualizarContagem();
}
function preencherDestino(){
  const select=$('ia-destino');
  const sugestoes=resultado.sugestoesTransportadora||[],todos=resultado.transportadoras||[];
  const ids=new Set(sugestoes.map(t=>Number(t.id)));
  const ordem=[...sugestoes,...todos.filter(t=>!ids.has(Number(t.id)))];
  select.innerHTML='<option value="nova">➕ Cadastrar nova transportadora</option>'+
    ordem.map(t=>{
      const s=sugestoes.find(x=>Number(x.id)===Number(t.id));
      const descricao=s?(s.pontuacao>=0.99?'Nome exato: ':'Nome semelhante: '):'Já cadastrada: ';
      return '<option value="existente:'+Number(t.id)+'">'+escape(descricao+t.nome)+'</option>';
    }).join('');
  select.value=sugestoes.length?'existente:'+sugestoes[0].id:'nova';
  $('ia-matches').textContent=sugestoes.length?'Encontrei '+sugestoes.length+' correspondência(s) possível(is). Você pode selecionar qualquer transportadora existente.':
    'Nenhuma correspondência próxima encontrada. Você ainda pode escolher qualquer transportadora existente.';
  select.onchange();
}
async function interpretar(){
  const arquivo=$('ia-imagem').files?.[0];if(!arquivo){aviso('Selecione uma foto.',true);return;}
  if(!['image/jpeg','image/png','image/webp'].includes(arquivo.type)||arquivo.size>8*1024*1024){aviso('Use JPG, PNG ou WEBP de até 8 MB.',true);return;}
  $('ia-preview').hidden=true;$('ia-ler').disabled=true;aviso('Lendo foto e comparando cadastros...');
  try{
    const form=new FormData();form.append('imagem',arquivo);
    resultado=await json(API+'/interpretar',{method:'POST',body:form});
    cidades=(resultado.extraido.cidades||[]).map(c=>({...c,cidade_id:c.cidade_id||null,marcada:Boolean(c.cidade_id)&&c.status!=='repetida'}));
    $('ia-nome').value=resultado.extraido.transportadora||'';
    $('ia-telefones').value=(resultado.extraido.telefones||[]).join(' / ');
    $('ia-principal').value=resultado.extraido.telefones?.[0]||'';
    $('ia-sobrescrever').checked=false;
    preencherDestino();renderCidades();$('ia-preview').hidden=false;
    aviso('Prévia pronta. Confira transportadora, telefones e cidades antes de confirmar.');
  }catch(e){aviso(e.message,true);}finally{$('ia-ler').disabled=false;}
}
async function confirmar(){
  if(!resultado)return;
  const destino=$('ia-destino').value,ids=[...new Set(cidades.filter(c=>c.marcada&&c.cidade_id).map(c=>Number(c.cidade_id)))];
  if(!ids.length){aviso('Selecione pelo menos uma cidade válida.',true);return;}
  if(destino==='nova'&&$('ia-nome').value.trim().length<2){aviso('Confirme o nome da transportadora.',true);return;}
  const naoMarcadas=cidades.filter(c=>!c.marcada).length;
  if(naoMarcadas&&!confirm(naoMarcadas+' cidade(s) ficaram de fora. Gravar somente as selecionadas?'))return;
  if(!confirm('Gravar '+ids.length+' cidade(s) na transportadora selecionada?'))return;
  const botao=$('ia-confirmar');botao.disabled=true;
  try{
    const salvo=await json(API+'/confirmar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      modo:destino==='nova'?'nova':'existente',transportadora_id:destino.startsWith('existente:')?Number(destino.split(':')[1]):null,
      nome:$('ia-nome').value.trim(),telefone:$('ia-telefones').value.trim(),telefone_principal:$('ia-principal').value.trim(),
      sobrescrever_telefones:$('ia-sobrescrever').checked,cidade_ids:ids
    })});
    aviso('Cadastro salvo: '+salvo.transportadora.nome+'. '+salvo.cidades_adicionadas+' cidade(s) adicionada(s); '+
      salvo.cidades_ja_vinculadas+' já vinculada(s).');
    const todas=await json('/api/transportadoras');
    if(typeof window.selecionarTransportadora==='function'){
      const alvo=todas.find(t=>Number(t.id)===Number(salvo.transportadora.id));
      if(alvo)window.selecionarTransportadora(alvo);
    }else if(typeof window.carregarTransportadoras==='function')await window.carregarTransportadoras();
  }catch(e){aviso(e.message,true);botao.disabled=false;}
}
window.abrirImportacaoIA=abrir;
})();