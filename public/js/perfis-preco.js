(function(window) {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const token = params.has('perfil_venda') ? params.get('perfil_venda') : null;
  let chaveEmAndamento = null;
  let enviando = false;
  const COM_PARAM = () => token === null ? '' : `perfil_venda=${encodeURIComponent(token)}`;
  const link = (path, opts = '') => `${path}?${[COM_PARAM(), opts].filter(Boolean).join('&')}`;
  async function produtos(tipo) {
    if (token === null) throw new Error('Perfil ausente.');
    const resposta = await fetch(`/api/perfis-preco/t/${encodeURIComponent(token)}/produtos?tipo=${tipo}`, {
      cache:'no-store', credentials: 'omit', referrerPolicy:'no-referrer'
    });
    const json = await resposta.json().catch(()=>({}));
    if (!resposta.ok || !json.success) throw new Error(json.message || 'Este link não está ativo. Solicite um novo link à fábrica.');
    return json.data;
  }
  function itensSelecionados() {
    return Array.from(document.querySelectorAll('.chk:checked')).map(chk=>({
      id:Number(chk.dataset.id),
      qtd:Number(document.querySelector(`.qtd[data-id="${chk.dataset.id}"]`)?.value || 0)
    }));
  }
  // Feedback discreto: sem caixas de confirmação ou alertas bloqueantes.
  function feedbackEnvio(mensagem, erro = false) {
    const painel = document.querySelector('.painel');
    if (!painel) return;
    let aviso = document.getElementById('feedback-envio-perfil');
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.id = 'feedback-envio-perfil';
      aviso.setAttribute('role', 'status');
      aviso.setAttribute('aria-live', 'polite');
      aviso.style.cssText = 'margin:8px 0 0;padding:8px 10px;border-radius:6px;font-size:13px;white-space:pre-line;';
      painel.appendChild(aviso);
    }
    aviso.style.background = erro ? '#fff0ef' : '#edf8f0';
    aviso.style.color = erro ? '#9d2020' : '#17652f';
    aviso.textContent = mensagem;
  }
  // Após a confirmação de aceite das mensagens pela Z-API, abre o WhatsApp
  // do próprio dispositivo. Sem destinatário predefinido e sem reenviar pedidos.
  // A navegação ocorre na mesma aba: após uma requisição assíncrona, abrir uma
  // nova aba poderia ser bloqueado pelo navegador como popup.
  function urlWhatsAppDoUsuario() {
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator?.userAgent || '');
    return mobile ? 'whatsapp://app' : 'https://web.whatsapp.com/';
  }
  function prepararAberturaWhatsApp() {
    const destino = urlWhatsAppDoUsuario();
    // Caso o navegador bloqueie a abertura automática após o retorno da API,
    // disponibiliza um link para o próprio usuário abrir com um toque.
    const aviso = document.getElementById('feedback-envio-perfil');
    if (aviso) {
      const abrir = document.createElement('a');
      abrir.href = destino;
      abrir.textContent = 'Abrir WhatsApp';
      abrir.style.cssText = 'display:block;margin-top:8px;font-weight:bold;text-decoration:underline;';
      aviso.appendChild(abrir);
    }
    return destino;
  }
  async function enviar(modulo) {
    if (token === null) return;
    if (enviando) return;
    const itens = itensSelecionados();
    if (!itens.length) {feedbackEnvio('Selecione ao menos um produto.', true);return;}
    if (itens.some(p=>!Number.isSafeInteger(p.qtd)||p.qtd<1||p.qtd>10000)) {
      feedbackEnvio('Verifique as quantidades.', true);return;
    }
    enviando = true;
    feedbackEnvio('Enviando pedido e comissão...');
    const botao = document.querySelector('.painel button');
    if (botao) {botao.disabled=true;botao.dataset.textoOriginal=botao.textContent;botao.textContent='Enviando mensagens...';}
    // A chave permanece ao falhar. Assim um novo clique consulta o MESMO pedido, sem enviar duplicatas.
    if (!chaveEmAndamento) chaveEmAndamento = crypto.randomUUID();
    try {
      const resposta = await fetch(`/api/perfis-preco/t/${encodeURIComponent(token)}/enviar`,{
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({modulo, itens, chave:chaveEmAndamento}),
        cache:'no-store',referrerPolicy:'no-referrer'
      });
      const json = await resposta.json().catch(()=>({}));
      if (!resposta.ok || !json.success || json.data?.concluido !== true) {
        throw new Error(json.message || 'O envio não foi concluído.');
      }
      const chaveExibida = json.data.id;
      feedbackEnvio(`Pedido nº ${chaveExibida}: mensagens aceitas pela Z-API.`);
      chaveEmAndamento = null;
      // O usuário confirma o aviso; em seguida o WhatsApp do aparelho é aberto.
      const urlWhatsApp = prepararAberturaWhatsApp();
      window.alert('PEDIDO ENVIADO');
      try {
        window.location.assign(urlWhatsApp);
      } catch (_) {
        // Bloqueio de protocolo/aplicativo: pedido já enviado, não enviar novamente.
        // O link manual preparado acima permanece no aviso da página.
      }
    } catch(error) {
      feedbackEnvio(`${error.message}\nSe houve falha de rede, tente novamente pelo MESMO botão. Não crie outro pedido antes de conferir os envios.`, true);
    } finally {
      enviando=false;
      if (botao) {botao.disabled=false;botao.textContent=botao.dataset.textoOriginal;}
    }
  }
  function ajustarRetomada(html, path) {
    if (token === null) return html;
    // Só é utilizado para os links estáticos das mensagens existentes no módulo.
    return html.split(`href="${path}"`).join(`href="${link(path)}"`);
  }
  window.PrecosVendedor = {token, produtos, enviar, link, ajustarRetomada};
})(window);
