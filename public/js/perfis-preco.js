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
  async function enviar(modulo) {
    if (token === null) return;
    if (enviando) return;
    const itens = itensSelecionados();
    if (!itens.length) {alert('Selecione ao menos um produto.');return;}
    if (itens.some(p=>!Number.isSafeInteger(p.qtd)||p.qtd<1||p.qtd>10000)) {
      alert('Verifique as quantidades.');return;
    }
    if (!window.confirm('Enviar o pedido e o demonstrativo de comissão para os WhatsApps da fábrica e do perfil?')) return;
    enviando = true;
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
      if (!resposta.ok || !json.success) throw new Error(json.message || 'O envio não foi concluído.');
      const chaveExibida = json.data?.id;
      alert(`Pedido nº ${chaveExibida} enviado. As mensagens foram aceitas pela Z-API.\nComissão registrada como prevista.`);
      chaveEmAndamento = null;
    } catch(error) {
      alert(`${error.message}\nSe houve falha de rede, tente novamente pelo MESMO botão. Não crie outro pedido antes de conferir os envios.`);
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
