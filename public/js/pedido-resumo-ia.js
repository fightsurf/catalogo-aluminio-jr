'use strict';
// Modal reutilizado na inserção e na consulta de pedidos.
(() => {
  let atual = null;
  let previewId = '';
  let audioUrl = '';
  let enviando = false;
  let versaoResumo = 0;
  let versaoAudio = 0;
  let modal = null;
  const $ = id => document.getElementById(id);
  const endpoint = '/api/whatsapp/elevenlabs-jr';
  function mostrarStatus(mensagem, erro) {
    const el = $('resumoIaStatus');
    el.textContent = mensagem || '';
    el.style.color = erro ? '#b42318' : '#355268';
  }
  async function jsonResposta(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.erro || data.detalhe || data.mensagem || 'Falha na requisição.');
    return data;
  }
  function limparAudio() {
    versaoAudio++;
    previewId = '';
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = '';
    const player = $('resumoIaPlayer');
    if (player) { player.pause(); player.removeAttribute('src'); player.hidden = true; }
    if ($('resumoIaEnviar')) $('resumoIaEnviar').disabled = true;
  }
  function montar() {
    if (modal) return;
    const css = document.createElement('style');
    css.textContent = '.resumo-ia-fundo{position:fixed;inset:0;z-index:9999;background:#0009;display:flex;align-items:center;justify-content:center;padding:14px}' +
      '.resumo-ia-janela{width:min(680px,100%);max-height:92vh;overflow:auto;background:#fff;color:#182230;border-radius:12px;padding:20px;box-shadow:0 16px 48px #0005;font:14px system-ui,Arial,sans-serif}' +
      '.resumo-ia-cabecalho{display:flex;align-items:center;justify-content:space-between;gap:14px}' +
      '.resumo-ia-janela h2{font-size:21px;margin:0 0 10px}' +
      '.resumo-ia-janela label{display:block;font-weight:600;margin:10px 0 6px}' +
      '.resumo-ia-janela select,.resumo-ia-janela textarea{box-sizing:border-box;width:100%;font:inherit;padding:10px;border:1px solid #98a2b3;border-radius:7px;background:white;color:#182230}' +
      '.resumo-ia-janela textarea{min-height:168px;resize:vertical;line-height:1.5}' +
      '.resumo-ia-acoes{display:flex;gap:9px;flex-wrap:wrap;margin-top:14px}' +
      '.resumo-ia-acoes button,.resumo-ia-fechar{padding:10px 12px;border:1px solid #b9c3cf;background:#f5f7fa;color:#182230;border-radius:7px;cursor:pointer}' +
      '.resumo-ia-acoes button:disabled{opacity:.5;cursor:not-allowed}' +
      '.resumo-ia-acoes .resumo-ia-principal{background:#155eef;color:white;border-color:#155eef}' +
      '.resumo-ia-janela small{display:block;color:#667085;margin-top:10px}' +
      '.resumo-ia-janela audio{width:100%;margin-top:12px}' +
      '#resumoIaStatus{margin:12px 0;min-height:18px;white-space:pre-wrap}';
    document.head.appendChild(css);
    modal = document.createElement('div');
    modal.className = 'resumo-ia-fundo';
    modal.hidden = true;
    modal.style.display = 'none';
    modal.setAttribute('role','presentation');
    modal.innerHTML =
      '<section class="resumo-ia-janela" role="dialog" aria-modal="true" aria-labelledby="resumoIaTitulo">' +
      '<div class="resumo-ia-cabecalho"><h2 id="resumoIaTitulo">Apresentação do pedido com IA</h2><button class="resumo-ia-fechar" id="resumoIaFechar" type="button" aria-label="Fechar">Fechar ✕</button></div>' +
      '<label for="resumoIaTipo">Tipo de pedido</label><select id="resumoIaTipo">' +
      '<option value="automatico">Detectar automaticamente</option><option value="kit-feirinha">Kit Feirinha</option><option value="orcamento">Orçamento normal</option></select>' +
      '<div id="resumoIaStatus" role="status" aria-live="polite"></div>' +
      '<label for="resumoIaTexto">Texto da apresentação (editável)</label><textarea id="resumoIaTexto" maxlength="1000" placeholder="Clique em Gerar resumo com IA."></textarea>' +
      '<div class="resumo-ia-acoes">' +
      '<button type="button" id="resumoIaGerar" class="resumo-ia-principal">Gerar resumo com IA</button>' +
      '<button type="button" id="resumoIaCopiar">Copiar texto</button>' +
      '<button type="button" id="resumoIaAudio">Gerar áudio ElevenLabs</button>' +
      '<button type="button" id="resumoIaEnviar" disabled>Enviar áudio pelo WhatsApp</button></div>' +
      '<audio id="resumoIaPlayer" controls hidden></audio>' +
      '<small>Confira o texto antes do envio. O WhatsApp só recebe o áudio após confirmação. Áudio de prévia expira em 10 minutos. Se a carrada não tiver data, não será inventada uma previsão.</small></section>';
    document.body.appendChild(modal);
    $('resumoIaFechar').addEventListener('click', fechar);
    modal.addEventListener('click', e => { if (e.target === modal) fechar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) fechar(); });
    $('resumoIaGerar').addEventListener('click', gerar);
    $('resumoIaAudio').addEventListener('click', gerarAudio);
    $('resumoIaEnviar').addEventListener('click', enviar);
    $('resumoIaCopiar').addEventListener('click', copiar);
    $('resumoIaTexto').addEventListener('input', limparAudio);
    $('resumoIaTipo').addEventListener('change', () => {
      versaoResumo++;
      $('resumoIaTexto').value = '';
      limparAudio();
      mostrarStatus('Tipo alterado. Clique em Gerar resumo com IA para atualizar o texto.');
    });
  }
  function fechar() {
    if (!modal || enviando) return;
    versaoResumo++;
    modal.hidden = true; modal.style.display = 'none';
    limparAudio();
  }
  function abrir({idMestre, telefone} = {}) {
    if (!idMestre) { window.alert('Salve ou selecione um pedido antes de gerar o resumo.'); return; }
    montar();
    versaoResumo++;
    atual = {idMestre, telefone:String(telefone||'')};
    $('resumoIaTitulo').textContent = 'Apresentação do pedido ' + String(idMestre) + ' com IA';
    $('resumoIaTipo').value = 'automatico';
    $('resumoIaTexto').value = '';
    limparAudio();
    mostrarStatus('O resumo será criado com base nos dados reais do pedido salvo.');
    modal.hidden = false; modal.style.display = 'flex';
    $('resumoIaGerar').focus();
    void gerar();
  }
  async function gerar() {
    if (enviando || !atual) return;
    const numeroId = atual.idMestre;
    const versao = ++versaoResumo;
    const btn = $('resumoIaGerar'); btn.disabled = true;
    $('resumoIaTexto').value = ''; limparAudio();
    mostrarStatus('Consultando o pedido e gerando apresentação com IA...');
    try {
      const data = await jsonResposta(await fetch('/api/legado/pedidos/' + encodeURIComponent(numeroId) + '/resumo-ia',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tipo:$('resumoIaTipo').value})
      }));
      if (versao !== versaoResumo || modal.hidden) return;
      const resumo = data.data;
      if (!resumo || !resumo.texto) throw new Error('O serviço não retornou o texto.');
      $('resumoIaTitulo').textContent = 'Apresentação do pedido ' + String(resumo.pedidoNumero || numeroId) + ' com IA';
      $('resumoIaTexto').value = resumo.texto;
      atual.telefone = String(resumo.telefone || atual.telefone || '');
      const tipo = resumo.tipo==='kit-feirinha'?'Kit Feirinha':'orçamento normal';
      mostrarStatus('Resumo gerado (' + tipo + '). ' + (resumo.observacao || 'Revise o texto, gere o áudio e confirme o envio.'));
    } catch(e) {if (versao === versaoResumo) mostrarStatus(e.message,true);} finally {if (versao === versaoResumo) btn.disabled = false;}
  }
  async function copiar() {
    const texto = $('resumoIaTexto').value.trim();
    if (!texto) return mostrarStatus('Gere um resumo antes de copiar.',true);
    try { await navigator.clipboard.writeText(texto); mostrarStatus('Texto copiado.'); }
    catch(_) { $('resumoIaTexto').select(); mostrarStatus('Selecione o texto e copie manualmente.'); }
  }
  async function gerarAudio() {
    const texto = $('resumoIaTexto').value.trim();
    if (!texto || texto.length>1000) return mostrarStatus('O texto precisa ter entre 1 e 1000 caracteres.',true);
    const btn = $('resumoIaAudio'); btn.disabled = true;
    limparAudio();
    const versao = versaoAudio;
    mostrarStatus('Gerando áudio na ElevenLabs...');
    try {
      const response = await fetch(endpoint+'/gerar',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texto})
      });
      if (!response.ok) {
        const json = await response.json().catch(()=>({}));
        throw new Error(json.erro || 'Não foi possível gerar o áudio na ElevenLabs.');
      }
      const novoId = response.headers.get('X-Preview-Id');
      if (!novoId) throw new Error('A prévia não foi identificada. Gere novamente.');
      const blob = await response.blob();
      if (versao !== versaoAudio || modal.hidden) return;
      previewId = novoId;
      audioUrl = URL.createObjectURL(blob);
      $('resumoIaPlayer').src = audioUrl; $('resumoIaPlayer').hidden = false;
      $('resumoIaEnviar').disabled = false;
      mostrarStatus('Áudio gerado. Ouça a prévia. Enviar pelo WhatsApp requer confirmação.');
    } catch(e){if (versao === versaoAudio) mostrarStatus(e.message,true);} finally {btn.disabled=false;}
  }
  async function enviar() {
    if (!previewId || enviando) return mostrarStatus('Gere primeiro o áudio.',true);
    const telefone = String(atual?.telefone || '').replace(/\D/g,'');
    if (!telefone) return mostrarStatus('O pedido não possui telefone do cliente.',true);
    if (!window.confirm('Enviar agora o áudio do resumo pelo WhatsApp para o telefone final ' + telefone.slice(-4) + '?')) return;
    enviando = true; const btn=$('resumoIaEnviar');btn.disabled=true;
    mostrarStatus('Enviando áudio pelo WhatsApp...');
    try {
      const data = await jsonResposta(await fetch(endpoint+'/enviar-teste',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previewId,telefone})
      }));
      mostrarStatus(data.aceitoPelaZapi ? 'Áudio aceito pela Z-API para envio. A entrega depende do WhatsApp.' : 'Solicitação enviada. Confira o WhatsApp.');
      limparAudio();
    } catch(e){mostrarStatus(e.message,true);btn.disabled=false;}
    finally {enviando=false;}
  }
  window.PedidoResumoIA = {abrir};
})();