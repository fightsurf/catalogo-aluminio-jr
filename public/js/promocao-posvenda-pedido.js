'use strict';
(function () {
  const API = '/api/legado/pedidos-insercao-v2/promocao-posvenda';
  const PREFERENCIAS = '/api/legado/pedidos/resumo-ia/config-voz';
  const ELEVEN = '/api/whatsapp/elevenlabs-jr';
  let pedido = null, produtos = [], config = null, salvando = false;
  let previewId = '', previewUrl = '', versaoAudio = 0, versaoTexto = 0;

  const css = document.createElement('style');
  css.textContent = '.pp-overlay{position:fixed;inset:0;background:#0009;z-index:9999;display:none;align-items:center;justify-content:center;padding:15px}' +
    '.pp-overlay.aberto{display:flex}.pp-modal{background:white;max-width:700px;width:100%;max-height:90vh;overflow:auto;border-radius:12px;padding:24px;color:#111827;font:14px system-ui,Arial,sans-serif}' +
    '.pp-modal h2{margin:0 0 12px}.pp-modal input:not([type=checkbox]),.pp-modal select,.pp-modal textarea{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;background:white;color:#111827}' +
    '.pp-modal textarea{min-height:114px;resize:vertical;line-height:1.5}.pp-modal label{display:block;margin-top:14px;font-weight:bold}.pp-modal button{margin:10px 8px 0 0;padding:9px 12px;border-radius:7px;cursor:pointer}' +
    '.pp-modal button:disabled{opacity:.55;cursor:not-allowed}.pp-info{display:flex;gap:12px;align-items:center;margin-top:14px;background:#f1f5f9;padding:12px;border-radius:8px}' +
    '.pp-info img{max-width:120px;max-height:100px}.pp-erro{color:#b91c1c;white-space:pre-wrap}.pp-resultado{white-space:pre-wrap}.pp-config{margin-top:12px;padding:12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc}' +
    '.pp-config[hidden],.pp-modal audio[hidden]{display:none}.pp-modal audio{width:100%;margin-top:12px}.pp-help{color:#475569;font-size:12px;margin-top:8px}';
  document.head.appendChild(css);

  const overlay = document.createElement('div');
  overlay.className = 'pp-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = '<section class="pp-modal" role="dialog" aria-modal="true" aria-labelledby="pp-titulo">' +
    '<h2 id="pp-titulo">Promoção especial após o pedido</h2><p id="pp-cliente"></p>' +
    '<label for="pp-busca">Buscar produto</label><input id="pp-busca" type="search" placeholder="Nome do produto">' +
    '<label for="pp-produto">Produto</label><select id="pp-produto"></select><div id="pp-info" class="pp-info"></div>' +
    '<label for="pp-preco">Preço promocional (R$)</label><input id="pp-preco" type="number" min="0.01" step="0.01">' +
    '<div id="pp-margem"></div>' +
    '<label for="pp-texto">Texto da promoção (editável)</label><textarea id="pp-texto" maxlength="800" placeholder="Clique em Gerar texto com IA ou escreva a sua mensagem."></textarea>' +
    '<p class="pp-help">O preço promocional é acrescentado automaticamente ao final do texto e também será falado no áudio.</p>' +
    '<button type="button" id="pp-gerar-texto" class="secundario">Gerar texto com IA</button>' +
    '<button type="button" id="pp-configurar" class="secundario">⚙ Configurar ElevenLabs</button>' +
    '<div id="pp-config-painel" class="pp-config" hidden>' +
    '<strong>Configuração de voz (salva para os próximos pedidos)</strong>' +
    '<label for="pp-voz">Voz da ElevenLabs</label><select id="pp-voz"><option value="">Carregando vozes...</option></select>' +
    '<label for="pp-modelo">Modelo da ElevenLabs</label><select id="pp-modelo"><option value="">Carregando modelos...</option></select>' +
    '<button type="button" id="pp-salvar-config" class="acao-principal">Salvar configuração</button>' +
    '<button type="button" id="pp-fechar-config" class="secundario">Fechar configuração</button>' +
    '<p id="pp-config-status" role="status"></p></div>' +
    '<div><button type="button" id="pp-gerar-audio" class="secundario">Gerar áudio ElevenLabs</button></div>' +
    '<audio id="pp-player" controls hidden></audio>' +
    '<p class="pp-help">Ouça a prévia antes de agendar. A prévia expira em 10 minutos; alterações no texto, preço ou voz exigem gerar o áudio novamente.</p>' +
    '<p><label style="font-weight:normal"><input id="pp-consentimento" type="checkbox"> Confirmo que o cliente autorizou o recebimento de ofertas pelo WhatsApp.</label></p>' +
    '<p id="pp-status" class="pp-resultado" role="status" aria-live="polite"></p>' +
    '<button id="pp-agendar" type="button" class="acao-principal">Agendar oferta</button>' +
    '<button id="pp-fechar" type="button" class="secundario">Fechar</button></section>';
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector('#' + id);
  const moeda = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function status(msg, bad) {
    $('pp-status').textContent = msg || '';
    $('pp-status').className = bad ? 'pp-erro' : 'pp-resultado';
  }
  async function ler(url, options) {
    const response = await fetch(url, Object.assign({ credentials: 'same-origin' }, options || {}));
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.sucesso === false || body.success === false) {
      throw new Error(body.erro || body.detalhe || body.mensagem || 'Falha na requisição.');
    }
    return body;
  }
  const enviarJson = (url, body, method) => ler(url, {
    method: method || 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  function invalidarAudio(mensagem) {
    versaoAudio++;
    previewId = '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    const player = $('pp-player');
    player.pause(); player.removeAttribute('src'); player.hidden = true;
    if (mensagem) status(mensagem);
  }
  function produtoAtual() { return produtos.find(p => Number(p.id) === Number($('pp-produto').value)); }
  function precoAtual() { return Number($('pp-preco').value); }
  function mensagemAtual() {
    const texto = $('pp-texto').value.replace(/\r\n?/g, '\n').trim();
    const preco = precoAtual();
    if (!texto || texto.length > 800) throw new Error('Informe um texto de até 800 caracteres.');
    if (!Number.isFinite(preco) || preco <= 0 || !Number.isInteger(Math.round(preco * 100))) {
      throw new Error('Informe o preço promocional antes de gerar o áudio.');
    }
    return texto + '\nPreço promocional: ' + moeda(preco);
  }
  function margem() {
    const p = produtoAtual(), preco = precoAtual();
    $('pp-margem').textContent = p && preco > 0 && !p.semCusto
      ? 'Margem bruta estimada: ' + (((preco - p.custo) / preco) * 100).toFixed(1).replace('.', ',') + '%' : '';
    $('pp-margem').style.color = p && preco < Number(p.custo) ? '#b91c1c' : '#475569';
  }
  function detalhe() {
    const p = produtoAtual(), lugar = $('pp-info');
    lugar.replaceChildren();
    if (!p) { lugar.textContent = 'Selecione um produto.'; margem(); return; }
    if (p.foto) {
      const img = document.createElement('img'); img.src = p.foto; img.alt = p.nome; lugar.appendChild(img);
    }
    const d = document.createElement('div');
    d.textContent = p.nome + ' | Preço: ' + moeda(p.preco) +
      ' | Custo: ' + (p.semCusto ? 'indisponível' : moeda(p.custo)) + (p.foto ? '' : ' | SEM FOTO');
    lugar.appendChild(d); margem();
  }
  function filtrar() {
    const termo = $('pp-busca').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const select = $('pp-produto'), anterior = select.value;
    select.replaceChildren();
    select.add(new Option('Selecione', ''));
    produtos.filter(p => p.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(termo))
      .slice(0, 120).forEach(p => select.add(new Option(p.nome + ' — ' + moeda(p.preco), String(p.id))));
    if ([...select.options].some(o => o.value === anterior)) select.value = anterior;
    detalhe();
  }
  async function atualizarConfiguracao() {
    const res = await ler(PREFERENCIAS);
    config = res.data || { voz: '', modelo: 'eleven_multilingual_v2' };
    return config;
  }
  async function abrirConfiguracao() {
    $('pp-config-painel').hidden = false;
    $('pp-salvar-config').disabled = true;
    $('pp-config-status').textContent = 'Carregando vozes, modelos e preferências salvas...';
    try {
      const [preferencias, vozes, modelos] = await Promise.all([
        atualizarConfiguracao(), ler(ELEVEN + '/vozes'), ler(ELEVEN + '/modelos')
      ]);
      if (!overlay.classList.contains('aberto') || $('pp-config-painel').hidden) return;
      const preencher = (elemento, lista, campo, escolhido, nome) => {
        const select = $(elemento); select.replaceChildren(); select.add(new Option('Selecione ' + nome, ''));
        lista.forEach(item => select.add(new Option(item.name + (item.category ? ' (' + item.category + ')' : ''), item[campo])));
        select.value = lista.some(item => item[campo] === escolhido) ? escolhido : '';
      };
      const listaVozes = Array.isArray(vozes.vozes) ? vozes.vozes : [];
      const listaModelos = Array.isArray(modelos.modelos) ? modelos.modelos : [];
      preencher('pp-voz', listaVozes, 'voice_id', preferencias.voz, 'uma voz');
      preencher('pp-modelo', listaModelos, 'model_id', preferencias.modelo, 'um modelo');
      $('pp-salvar-config').disabled = !listaVozes.length || !listaModelos.length;
      $('pp-config-status').textContent = 'A configuração será mantida para os próximos áudios e também no modal Apresentar pedido com IA.';
    } catch (e) { $('pp-config-status').textContent = e.message; }
  }
  async function salvarConfiguracao() {
    const voz = $('pp-voz').value, modelo = $('pp-modelo').value;
    if (!voz || !modelo) { $('pp-config-status').textContent = 'Selecione uma voz e um modelo.'; return; }
    const btn = $('pp-salvar-config'); btn.disabled = true;
    $('pp-config-status').textContent = 'Salvando configuração...';
    try {
      const res = await enviarJson(PREFERENCIAS, { voz, modelo }, 'PUT');
      config = res.data;
      invalidarAudio();
      $('pp-config-status').textContent = 'Voz e modelo salvos para os próximos áudios.';
    } catch (e) { $('pp-config-status').textContent = e.message; }
    finally { btn.disabled = false; }
  }
  function validarOferta() {
    if (!pedido) throw new Error('Nenhum pedido salvo foi selecionado.');
    const p = produtoAtual(), preco = precoAtual();
    if (!p?.foto) throw new Error('Escolha um produto com foto cadastrada.');
    if (!Number.isFinite(preco) || preco <= 0 || Math.round(preco * 100) / 100 !== preco) {
      throw new Error('Informe um preço promocional válido com até duas casas decimais.');
    }
    if (preco >= Number(p.preco)) throw new Error('O preço promocional precisa ser inferior ao preço de tabela.');
    if (p.semCusto) throw new Error('O custo do produto ainda não foi calculado. Atualize a composição antes de oferecer.');
    return { p, preco };
  }
  async function gerarTexto() {
    let oferta;
    try { oferta = validarOferta(); } catch (e) { return status(e.message, true); }
    const versao = ++versaoTexto, btn = $('pp-gerar-texto');
    btn.disabled = true; invalidarAudio();
    status('Gerando mensagem curta com IA...');
    try {
      const resposta = await enviarJson(API + '/texto-ia', {
        pedidoId: pedido.idMestre || pedido.saida, produtoId: oferta.p.id,
        precoPromocional: oferta.preco
      });
      if (versao !== versaoTexto || !overlay.classList.contains('aberto')) return;
      $('pp-texto').value = resposta.dados?.texto || '';
      status('Texto gerado. Revise, configure a voz e gere o áudio.');
    } catch (e) { if (versao === versaoTexto) status(e.message, true); }
    finally { btn.disabled = false; }
  }
  async function gerarAudio() {
    try { validarOferta(); mensagemAtual(); } catch (e) { return status(e.message, true); }
    const btn = $('pp-gerar-audio'); btn.disabled = true;
    invalidarAudio();
    const versao = versaoAudio;
    status('Consultando a configuração da ElevenLabs...');
    try {
      const preferencias = await atualizarConfiguracao();
      if (versao !== versaoAudio || !overlay.classList.contains('aberto')) return;
      if (!preferencias.voz || !preferencias.modelo) throw new Error('Clique em Configurar ElevenLabs e salve a voz e o modelo.');
      status('Gerando prévia do áudio na ElevenLabs...');
      const resposta = await fetch(ELEVEN + '/gerar', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: mensagemAtual(), voz: preferencias.voz, modelo: preferencias.modelo })
      });
      if (!resposta.ok) {
        const erroBody = await resposta.json().catch(() => ({}));
        throw new Error(erroBody.erro || 'Não foi possível gerar o áudio.');
      }
      const id = resposta.headers.get('X-Preview-Id');
      if (!id) throw new Error('Prévia não identificada. Gere o áudio novamente.');
      const blob = await resposta.blob();
      if (versao !== versaoAudio || !overlay.classList.contains('aberto')) return;
      previewId = id;
      previewUrl = URL.createObjectURL(blob);
      $('pp-player').src = previewUrl; $('pp-player').hidden = false;
      status('Áudio gerado. Ouça a prévia e depois agende a oferta.');
    } catch (e) { if (versao === versaoAudio) status(e.message, true); }
    finally { btn.disabled = false; }
  }
  async function agendar() {
    if (salvando) return;
    let oferta;
    try {
      oferta = validarOferta();
      mensagemAtual();
      if (!previewId) throw new Error('Gere e confira primeiro o áudio ElevenLabs.');
      if (!$('pp-consentimento').checked) throw new Error('Confirme a autorização do cliente para receber ofertas.');
    } catch (e) { return status(e.message, true); }
    if (oferta.preco < Number(oferta.p.custo) &&
        !window.confirm('Preço inferior ao custo atualizado. Continuar?')) return;
    const btn = $('pp-agendar'); btn.disabled = true; salvando = true;
    status('Salvando foto, texto e áudio para envio automático...');
    try {
      const res = await enviarJson(API + '/agendar', {
        pedidoId: pedido.idMestre || pedido.saida, pedidoSalvoEm: pedido.salvoEm,
        produtoId: oferta.p.id, precoPromocional: oferta.preco,
        texto: $('pp-texto').value, previewId, autorizadoWhatsApp: true
      });
      btn.textContent = 'Oferta agendada';
      status('Foto, texto e áudio agendados para ' +
        new Date(res.dados.enviarEm).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) +
        '.\n\nMensagem:\n' + res.dados.mensagem);
    } catch (e) { status(e.message + ' Se a prévia expirou, gere o áudio novamente.', true); btn.disabled = false; }
    finally { salvando = false; }
  }
  async function abrir(p) {
    if (!p?.numero || !(p.idMestre || p.saida)) return;
    try {
      const auth = await ler('/auth/status');
      if (!auth.autenticado) {
        alert('Somente um administrador pode agendar promoções. Entre com sua conta administrativa.');
        return;
      }
    } catch (e) { alert('Não foi possível verificar a autorização administrativa: ' + e.message); return; }
    pedido = p; produtos = []; config = null; versaoTexto++;
    invalidarAudio();
    overlay.classList.add('aberto'); overlay.setAttribute('aria-hidden', 'false');
    $('pp-cliente').textContent = 'Pedido ' + p.numero + ' — ' +
      (p.cliente?.nome || 'Cliente') + '. A oferta será enviada aproximadamente uma hora após salvar.';
    $('pp-busca').value = ''; $('pp-preco').value = ''; $('pp-texto').value = '';
    $('pp-consentimento').checked = false; $('pp-config-painel').hidden = true;
    $('pp-agendar').disabled = false; $('pp-agendar').textContent = 'Agendar oferta';
    status('Carregando produtos...');
    try {
      const dados = await ler(API + '/produtos');
      if (pedido !== p) return;
      produtos = Array.isArray(dados.dados) ? dados.dados : [];
      filtrar();
      status('Escolha um produto e informe o preço promocional.');
      void atualizarConfiguracao().catch(() => {});
    } catch (e) { status(e.message, true); }
  }
  function fechar() {
    if (salvando) return;
    versaoTexto++; invalidarAudio();
    overlay.classList.remove('aberto'); overlay.setAttribute('aria-hidden', 'true');
    pedido = null;
  }
  $('pp-fechar').addEventListener('click', fechar);
  overlay.addEventListener('click', e => { if (e.target === overlay) fechar(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('aberto')) fechar(); });
  $('pp-busca').addEventListener('input', filtrar);
  $('pp-produto').addEventListener('change', () => { versaoTexto++; $('pp-texto').value = ''; invalidarAudio(); detalhe(); });
  $('pp-preco').addEventListener('input', () => { versaoTexto++; invalidarAudio(); margem(); });
  $('pp-texto').addEventListener('input', () => { versaoTexto++; invalidarAudio(); });
  $('pp-gerar-texto').addEventListener('click', gerarTexto);
  $('pp-configurar').addEventListener('click', abrirConfiguracao);
  $('pp-salvar-config').addEventListener('click', salvarConfiguracao);
  $('pp-fechar-config').addEventListener('click', () => { $('pp-config-painel').hidden = true; });
  $('pp-gerar-audio').addEventListener('click', gerarAudio);
  $('pp-agendar').addEventListener('click', agendar);
  window.promocaoPosVenda = { abrir: p => { if (p?.numero) void abrir(p); } };
})();
