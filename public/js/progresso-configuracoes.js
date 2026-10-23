'use strict';
// Aba Texto/Áudio da matriz. Nenhum texto é enviado do navegador: o backend renderiza templates.
(()=>{
 const raiz=document.getElementById('modalConfigProgressoBackdrop');
 const botao=document.getElementById('btnConfigProgresso');
 if(!raiz||!botao)return;
 const $=(id)=>document.getElementById(id);
 const API='/api/legado/progresso-configuracoes';
 let dados=null, faseCodigo='',aba='audio',bloqueado=false,recorder=null,stream=null,chunks=[],gravado=null,previewUrl=null;
 let listaVozes=[],listaModelos=[],vozesCarregadas=false;
 const o={geralTexto:$('cfgGeralTexto'),geralAudio:$('cfgGeralAudio'),
 fase:$('cfgFase'),texto:$('cfgTexto'),faseTexto:$('cfgFaseTexto'),faseAudio:$('cfgFaseAudio'),
 painelTexto:$('cfgPainelTexto'),painelAudio:$('cfgPainelAudio'),
 previewTexto:$('cfgPreviewTexto'),var:$('cfgVariavel'),
 btnSalvar:$('cfgSalvar'),feedback:$('cfgFeedback'),
 audioPlayer:$('cfgAudioPlayer'),audioInfo:$('cfgAudioInfo'),
 voz:$('cfgVoz'),modelo:$('cfgModelo'),fala:$('cfgFala'),
 btnGerar:$('cfgGerar'),btnGravar:$('cfgGravar'),btnSalvarGravacao:$('cfgSalvarGravacao'),
 btnExcluirAudio:$('cfgExcluirAudio'),gravacaoAviso:$('cfgGravacaoAviso'),
 abaAudio:$('cfgAbaAudio'),abaTexto:$('cfgAbaTexto')};
 function feed(msg,erro=false){o.feedback.textContent=msg;o.feedback.className='feedback'+(erro?' error':'');}
 async function chamar(url,options={}){
   const resp=await fetch(API+url,{credentials:'same-origin',...options});
   const json=await resp.json().catch(()=>null);
   if(!resp.ok||json?.success===false)throw new Error(json?.message||`Erro HTTP ${resp.status}. Verifique login administrativo.`);
   return json?.data;
 }
 const jsonOpt=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const atual=()=>dados?.fases?.find(f=>f.codigo===faseCodigo);
 function preencherSelect(select,opcoes,value){select.replaceChildren();for(const item of opcoes){const op=document.createElement('option');op.value=item.value;op.textContent=item.label;select.append(op);}if(value)select.value=value;}
 function audioSrc(){return `${API}/fases/${encodeURIComponent(faseCodigo)}/audio?cache=${Date.now()}`;}
 function soltarPreview(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
 function desenharFase(){
   const f=atual();if(!f)return;
   o.faseTexto.checked=Boolean(f.texto_ativo);o.faseAudio.checked=Boolean(f.audio_ativo);
   o.texto.value=f.texto||'';o.previewTexto.hidden=true;
   o.fala.value=f.audio_texto||'';
   gravado=null;soltarPreview();o.btnSalvarGravacao.disabled=true;o.gravacaoAviso.textContent='';
   if(f.audio_chave){o.audioInfo.textContent=`Áudio salvo permanentemente • ${f.audio_origem==='elevenlabs'?'ElevenLabs':'Microfone'}${f.audio_voz_nome?' • '+f.audio_voz_nome:''}`;
     o.audioPlayer.hidden=false;o.audioPlayer.src=audioSrc();o.btnExcluirAudio.disabled=false;}
   else{o.audioInfo.textContent='Nenhum áudio associado a esta fase.';o.audioPlayer.hidden=true;o.audioPlayer.removeAttribute('src');o.audioPlayer.load();o.btnExcluirAudio.disabled=true;}
   if(f.audio_voz_id&&Array.from(o.voz.options).some(opt=>opt.value===f.audio_voz_id))o.voz.value=f.audio_voz_id;
   if(f.audio_modelo&&Array.from(o.modelo.options).some(opt=>opt.value===f.audio_modelo))o.modelo.value=f.audio_modelo;
 }
 function mostrarAba(nova){
   aba=nova;const texto=nova==='texto';
   o.painelTexto.hidden=!texto;o.painelAudio.hidden=texto;
   o.abaTexto.classList.toggle('active',texto);o.abaAudio.classList.toggle('active',!texto);
   o.abaTexto.setAttribute('aria-selected',String(texto));o.abaAudio.setAttribute('aria-selected',String(!texto));
   feed('');if(!texto)carregarVozes().catch(e=>feed(e.message,true));
 }
 async function carregarVozes(){
   if(vozesCarregadas)return;
   const [vozes,modelos]=await Promise.all([chamar('/elevenlabs/vozes'),chamar('/elevenlabs/modelos')]);
   listaVozes=Array.isArray(vozes)?vozes:[];listaModelos=Array.isArray(modelos)?modelos:[];
   preencherSelect(o.voz,listaVozes.map(v=>({value:v.voice_id,label:`${v.name}${v.category?' ('+v.category+')':''}`})),atual()?.audio_voz_id);
   preencherSelect(o.modelo,listaModelos.map(m=>({value:m.model_id,label:m.name})),atual()?.audio_modelo||'eleven_multilingual_v2');
   vozesCarregadas=true;
   if(!listaVozes.length||!listaModelos.length)feed('Sem vozes ou modelos disponíveis nesta conta ElevenLabs.',true);
 }
 function ocupar(ocupado){bloqueado=ocupado;for(const el of [o.geralTexto,o.geralAudio,o.fase,o.texto,o.faseTexto,o.faseAudio,o.btnSalvar,o.btnGerar,o.btnGravar,o.btnExcluirAudio,o.voz,o.modelo,o.fala])el.disabled=ocupado;
  o.btnSalvarGravacao.disabled=ocupado||!gravado;
 }
 async function abrir(){raiz.classList.add('open');feed('Carregando configurações...');ocupar(true);
  try{dados=await chamar('/');o.geralTexto.checked=Boolean(dados.geral.texto_ativo);o.geralAudio.checked=Boolean(dados.geral.audio_ativo);
   preencherSelect(o.fase,dados.fases.filter(f=>f.codigo!=='PAGAMENTO_QUITADO').map(f=>({value:f.codigo,label:f.nome})),faseCodigo||'EM_PRODUCAO');
   faseCodigo=o.fase.value;
   preencherSelect(o.var,dados.variaveis.map(v=>({value:v.codigo,label:v.nome+' {'+v.codigo+'}'})));
   desenharFase();mostrarAba(aba);feed('As alterações são globais para todas as carradas.');
  }catch(e){feed(e.message,true)}finally{ocupar(false)}
 }
 async function recarregarFase(){
   const codigo=faseCodigo;const novo=await chamar('/');dados=novo;faseCodigo=codigo;
   desenharFase();
 }
 async function salvarGeral(){if(!dados||bloqueado)return;
  ocupar(true);try{dados.geral=await chamar('/geral',jsonOpt('PUT',{textoAtivo:o.geralTexto.checked,audioAtivo:o.geralAudio.checked}));feed('Seletores gerais salvos.');}
  catch(e){feed(e.message,true);o.geralTexto.checked=Boolean(dados.geral.texto_ativo);o.geralAudio.checked=Boolean(dados.geral.audio_ativo)}finally{ocupar(false)}
 }
 async function salvarFase(){if(!dados||bloqueado)return;
  ocupar(true);try{const f=await chamar(`/fases/${encodeURIComponent(faseCodigo)}`,jsonOpt('PUT',{
   texto:o.texto.value,textoAtivo:o.faseTexto.checked,audioAtivo:o.faseAudio.checked
  }));const index=dados.fases.findIndex(i=>i.codigo===faseCodigo);dados.fases[index]=f;
   feed('Mensagem e controles individuais salvos.');}
  catch(e){feed(e.message,true)}finally{ocupar(false)}
 }
 function montarPrevia(){const demo={cliente:'José da Silva',pedido:'12345',carrada:'1654',fase:atual()?.nome,
 data:'23/10/2026',data_carrada:'30/10/2026',descricao_carrada:'Entrega prevista',previsao:'30/10/2026 - Entrega prevista',
 valor_pedido:'R$ 1.250,00',quantidade_itens:'120',volumes:'5',vendedor:'Carlos',cidade:'Catolé do Rocha',empresa:'Alumínio JR',
 data_expedicao:'23/10/2026',etiqueta_texto:'Destinatário: José da Silva',detalhes_entrega:'Transportadora: Exemplo',
 pedido_anterior:'12000',transportadora_anterior:'Exemplo',redespacho_anterior:'não informado',agencia_anterior:'não informada'};
 o.previewTexto.textContent=o.texto.value.replace(/\{([^{}]+)\}/g,(match,v)=>Object.prototype.hasOwnProperty.call(demo,v)?demo[v]:match);
 o.previewTexto.hidden=false;
 }
 async function gerarAudio(){if(bloqueado)return;
  if(!o.fala.value.trim())return feed('Escreva uma mensagem para gerar o áudio.',true);
  if(!o.voz.value||!o.modelo.value)return feed('Selecione a voz e o modelo.',true);
  if(!confirm('Gerar e salvar permanentemente este áudio? Isso substituirá o áudio associado à fase.'))return;
  ocupar(true);feed('Gerando e armazenando áudio no Cloudflare R2...');
  try{await chamar(`/fases/${encodeURIComponent(faseCodigo)}/gerar-audio`,jsonOpt('POST',{
    texto:o.fala.value,voz:o.voz.value,modelo:o.modelo.value
  }));await recarregarFase();feed('Áudio ElevenLabs gerado e salvo permanentemente.');}
  catch(e){feed(e.message,true)}finally{ocupar(false)}
 }
 function limparMicrofone(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}recorder=null;}
 async function gravar(){if(bloqueado)return;
  if(recorder?.state==='recording'){recorder.stop();o.btnGravar.textContent='Iniciar gravação';return;}
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return feed('Gravação não suportada neste navegador; é necessário HTTPS e microfone autorizado.',true);
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:true});
   const tipos=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
   const mime=tipos.find(t=>MediaRecorder.isTypeSupported(t));
   recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);chunks=[];gravado=null;o.btnSalvarGravacao.disabled=true;
   recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
   recorder.onstop=()=>{
     const m=recorder?.mimeType||mime||'audio/webm';gravado=new Blob(chunks,{type:m});limparMicrofone();
     if(gravado.size>5*1024*1024){feed('Gravação maior que 5 MB; grave uma mensagem mais curta.',true);gravado=null;return;}
     soltarPreview();previewUrl=URL.createObjectURL(gravado);o.audioPlayer.src=previewUrl;o.audioPlayer.hidden=false;
     o.btnSalvarGravacao.disabled=false;o.gravacaoAviso.textContent='Prévia da gravação. Clique em Salvar gravação para gravá-la permanentemente.';
   };
   recorder.start();o.btnGravar.textContent='Parar gravação';feed('Gravando pelo microfone...');
  }catch(e){limparMicrofone();feed('Não foi possível usar o microfone: '+e.message,true)}
 }
 async function salvarGravacao(){if(!gravado||bloqueado)return;
  if(!confirm('Salvar esta gravação permanentemente como áudio desta fase?'))return;
  ocupar(true);feed('Convertendo e salvando gravação...');
  try{
   const resposta=await fetch(`${API}/fases/${encodeURIComponent(faseCodigo)}/gravar-audio`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':gravado.type||'audio/webm'},body:gravado});
   const j=await resposta.json().catch(()=>null);if(!resposta.ok||j?.success===false)throw new Error(j?.message||`Falha HTTP ${resposta.status}`);
   await recarregarFase();feed('Gravação salva permanentemente em MP3.');
  }catch(e){feed(e.message,true)}finally{ocupar(false)}
 }
 async function excluirAudio(){if(!atual()?.audio_chave||bloqueado)return;
  if(!confirm('Desvincular o áudio desta fase? Não haverá envio de áudio até cadastrar outro.'))return;
  ocupar(true);try{await chamar(`/fases/${encodeURIComponent(faseCodigo)}/audio`,{method:'DELETE'});await recarregarFase();feed('Áudio desvinculado da fase.');}
  catch(e){feed(e.message,true)}finally{ocupar(false)}
 }
 botao.addEventListener('click',abrir);
 raiz.querySelectorAll('[data-config-close]').forEach(btn=>btn.addEventListener('click',()=>{
   if(bloqueado)return;if(recorder?.state==='recording')recorder.stop();limparMicrofone();raiz.classList.remove('open');
 }));
 raiz.addEventListener('click',e=>{if(e.target===raiz&&!bloqueado){if(recorder?.state==='recording')recorder.stop();limparMicrofone();raiz.classList.remove('open')}});
 o.abaTexto.addEventListener('click',()=>mostrarAba('texto'));o.abaAudio.addEventListener('click',()=>mostrarAba('audio'));
 o.fase.addEventListener('change',()=>{if(recorder?.state==='recording')recorder.stop();limparMicrofone();faseCodigo=o.fase.value;desenharFase();feed('')});
 o.geralTexto.addEventListener('change',salvarGeral);o.geralAudio.addEventListener('change',salvarGeral);
 o.btnSalvar.addEventListener('click',salvarFase);o.btnGerar.addEventListener('click',gerarAudio);
 o.btnGravar.addEventListener('click',gravar);o.btnSalvarGravacao.addEventListener('click',salvarGravacao);
 o.btnExcluirAudio.addEventListener('click',excluirAudio);$('cfgBtnPrevia').addEventListener('click',montarPrevia);
 $('cfgInserirVariavel').addEventListener('click',()=>{
   const el=o.texto,start=el.selectionStart,end=el.selectionEnd,variavel='{'+o.var.value+'}';
   el.value=el.value.slice(0,start)+variavel+el.value.slice(end);el.focus();el.setSelectionRange(start+variavel.length,start+variavel.length);
 });
})();
