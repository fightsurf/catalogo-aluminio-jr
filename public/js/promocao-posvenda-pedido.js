'use strict';
(function () {
  const API = '/api/legado/pedidos-insercao-v2/promocao-posvenda';
  let token = '', pedido = null, produtos = [], salvando = false;
  const css = document.createElement('style');
  css.textContent = '.pp-overlay{position:fixed;inset:0;background:#0009;z-index:9999;display:none;align-items:center;justify-content:center;padding:15px}.pp-overlay.aberto{display:flex}.pp-modal{background:white;max-width:700px;width:100%;max-height:90vh;overflow:auto;border-radius:12px;padding:24px;color:#111827}.pp-modal input:not([type=checkbox]),.pp-modal select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:8px}.pp-modal label{display:block;margin-top:14px;font-weight:bold}.pp-modal button{margin:12px 8px 0 0}.pp-info{display:flex;gap:12px;align-items:center;margin-top:14px;background:#f1f5f9;padding:12px;border-radius:8px}.pp-info img{max-width:120px;max-height:100px}.pp-erro{color:#b91c1c;white-space:pre-line}.pp-resultado{white-space:pre-line}';
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
    '<p><label style="font-weight:normal"><input id="pp-consentimento" type="checkbox"> Confirmo que o cliente autorizou o recebimento de ofertas pelo WhatsApp.</label></p>' +
    '<p id="pp-status" class="pp-resultado" role="status"></p>' +
    '<button id="pp-agendar" type="button" class="acao-principal">Agendar oferta</button>' +
    '<button id="pp-fechar" type="button" class="secundario">Fechar</button></section>';
  document.body.appendChild(overlay);
  const $ = id => overlay.querySelector('#' + id);
  const moeda = n => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function status(msg, bad) { $('pp-status').textContent = msg; $('pp-status').className = bad ? 'pp-erro' : 'pp-resultado'; }
  async function api(url, options) {
    const o = Object.assign({}, options || {});
    o.headers = Object.assign({ 'x-promocao-autorizacao': token }, o.headers || {});
    const response = await fetch(API + url, o);
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.sucesso) throw new Error(body.erro || 'Erro ao consultar promoção.');
    return body.dados;
  }
  function selecionado() { return produtos.find(p => p.id === Number($('pp-produto').value)); }
  function margem() {
    const p = selecionado(), preco = Number($('pp-preco').value);
    $('pp-margem').textContent = p && preco > 0 ? 'Margem bruta estimada: ' + (((preco - p.custo) / preco) * 100).toFixed(1).replace('.', ',') + '%' : '';
    $('pp-margem').style.color = p && preco < p.custo ? '#b91c1c' : '#475569';
  }
  function detalhe() {
    const p = selecionado(), lugar = $('pp-info'); lugar.replaceChildren();
    if (!p) { lugar.textContent = 'Selecione um produto.'; margem(); return; }
    if (p.foto) { const img = document.createElement('img'); img.src = p.foto; img.alt = p.nome; lugar.appendChild(img); }
    const d = document.createElement('div');
    d.textContent = p.nome + ' | Preço: ' + moeda(p.preco) + ' | Custo: ' + (p.semCusto ? 'indisponível' : moeda(p.custo)) + (p.foto ? '' : ' | SEM FOTO');
    lugar.appendChild(d); margem();
  }
  function filtrar() {
    const termo = $('pp-busca').value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const select = $('pp-produto'), anterior = select.value;
    select.replaceChildren();
    const vazio = document.createElement('option'); vazio.textContent = 'Selecione'; vazio.value = ''; select.appendChild(vazio);
    produtos.filter(p => p.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(termo)).slice(0, 120).forEach(p => {
      const opt = document.createElement('option'); opt.value = p.id; opt.textContent = p.nome + ' — ' + moeda(p.preco); select.appendChild(opt);
    });
    if ([...select.options].some(o => o.value === anterior)) select.value = anterior;
    detalhe();
  }
  async function abrir(p) {
    pedido = p; overlay.classList.add('aberto'); overlay.setAttribute('aria-hidden', 'false');
    $('pp-cliente').textContent = 'Pedido ' + p.numero + ' — ' + (p.cliente?.nome || 'Cliente') + '. A oferta será enviada uma hora após salvar.';
    $('pp-busca').value = ''; $('pp-preco').value = ''; $('pp-consentimento').checked = false;
    $('pp-agendar').disabled = false; $('pp-agendar').textContent = 'Agendar oferta'; status('Carregando produtos...');
    try { produtos = await api('/produtos'); filtrar(); status(''); }
    catch (e) { status(e.message, true); $('pp-agendar').disabled = true; }
  }
  function fechar() { overlay.classList.remove('aberto'); overlay.setAttribute('aria-hidden', 'true'); pedido = null; }
  $('pp-fechar').addEventListener('click', fechar);
  $('pp-busca').addEventListener('input', filtrar);
  $('pp-produto').addEventListener('change', detalhe);
  $('pp-preco').addEventListener('input', margem);
  $('pp-agendar').addEventListener('click', async () => {
    if (!pedido || salvando) return;
    const p = selecionado(), preco = Number($('pp-preco').value);
    if (!p?.foto) return status('Escolha um produto com foto cadastrada.', true);
    if (!(preco > 0)) return status('Informe um preço promocional válido.', true);
    if (preco >= p.preco) return status('O preço promocional precisa ser inferior ao preço de tabela.', true);
    if (p.semCusto) return status('O custo do produto ainda não foi calculado. Atualize a composição antes de oferecer.', true);
    if (!$('pp-consentimento').checked) return status('Confirme a autorização do cliente para receber ofertas.', true);
    if (preco < p.custo && !confirm('Preço inferior ao custo atualizado. Continuar?')) return;
    try {
      salvando = true; $('pp-agendar').disabled = true;
      status('Preparando texto com IA e áudio ElevenLabs...');
      const r = await api('/agendar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId: pedido.idMestre || pedido.saida, pedidoSalvoEm: pedido.salvoEm, produtoId: p.id, precoPromocional: preco, autorizadoWhatsApp: true })
      });
      $('pp-agendar').textContent = 'Oferta agendada';
      status('Envio programado para ' + new Date(r.enviarEm).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) + '.\n\nMensagem: ' + r.mensagem);
    } catch (e) { status(e.message, true); $('pp-agendar').disabled = false; }
    finally { salvando = false; }
  });
  // Sequência clássica de videogame: ↑ ↑ ↓ ↓ ← → ← →. Só as setas são observadas.
  const sequencia = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
  let pos = 0;
  document.addEventListener('keydown', async event => {
    if (!event.key.startsWith('Arrow') || event.repeat) return;
    pos = event.key === sequencia[pos] ? pos + 1 : (event.key === sequencia[0] ? 1 : 0);
    if (pos !== sequencia.length) return;
    pos = 0;
    const codigo = prompt('Digite o código secreto para habilitar a promoção após salvar pedidos:');
    if (!codigo) return;
    try {
      const res = await fetch(API + '/desbloquear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.sucesso) throw new Error(body.erro || 'Código incorreto.');
      token = body.dados.token;
      alert('Promoções habilitadas nesta aba. O modal aparecerá após salvar um pedido.');
    } catch (e) { alert(e.message); }
  });
  window.promocaoPosVenda = { aposSalvar: p => { if (token && p?.numero) void abrir(p); } };
})();
