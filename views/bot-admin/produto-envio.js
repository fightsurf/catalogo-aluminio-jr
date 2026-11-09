(() => {
  'use strict';
  const API = '/api/whatsapp/status';
  const el = id => document.getElementById(id);
  const abrirBtn = el('btn-enviar-produto');
  const modal = el('modal-enviar-produto');
  const categoriaEl = el('produto-envio-categoria');
  const produtoEl = el('produto-envio-produto');
  const destinoEl = el('produto-envio-destino');
  const resumoEl = el('produto-envio-resumo');
  const feedbackEl = el('produto-envio-feedback');
  const confirmarBtn = el('produto-envio-confirmar');
  const cancelarBtn = el('produto-envio-cancelar');
  if (!abrirBtn || !modal || !categoriaEl || !produtoEl) return;

  let enviando = false;
  let carregando = false;
  let midias = [];
  let produtoSelecionado = null;
  let telefoneInicial = '';
  let sequencia = 0;

  const telefoneAtivo = () => String(window.BotAdmin?.getTelefoneAtivo?.() || '').trim();
  const telefoneValido = telefone => /^55\d{10,11}$/.test(telefone);
  const mensagem = (texto, erro = false) => {
    feedbackEl.textContent = texto;
    feedbackEl.dataset.estado = erro ? 'erro' : 'normal';
  };

  function atualizarEstado() {
    abrirBtn.disabled = enviando || !telefoneValido(telefoneAtivo());
    abrirBtn.title = abrirBtn.disabled
      ? 'Selecione uma conversa com número brasileiro confirmado (55 + DDD).'
      : 'Enviar todas as fotos e vídeos de um produto à conversa selecionada.';
    categoriaEl.disabled = enviando || carregando;
    produtoEl.disabled = enviando || carregando || !categoriaEl.value;
    confirmarBtn.disabled = enviando || carregando || !produtoSelecionado ||
      !midias.length || telefoneAtivo() !== telefoneInicial;
    cancelarBtn.disabled = enviando;
  }

  async function requisitar(caminho, opcoes = {}) {
    const res = await fetch(API + caminho, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(opcoes.body ? {'Content-Type': 'application/json'} : {}) },
      ...opcoes
    });
    let json;
    try { json = await res.json(); }
    catch (_) { throw new Error('Resposta inválida do servidor. Verifique seu login.'); }
    if (!res.ok || json?.success !== true) throw new Error(json?.error || json?.message || 'HTTP ' + res.status);
    return json.data;
  }

  const opcao = (texto, valor = '') => new Option(texto, valor);

  async function abrirModal() {
    if (enviando || !telefoneValido(telefoneAtivo())) return;
    telefoneInicial = telefoneAtivo();
    categoriaEl.replaceChildren(opcao('Carregando categorias...'));
    produtoEl.replaceChildren(opcao('Selecione uma categoria'));
    produtoSelecionado = null;
    midias = [];
    resumoEl.textContent = '';
    destinoEl.textContent = 'Cliente selecionado: ' + telefoneInicial;
    mensagem('');
    modal.showModal();
    carregando = true;
    atualizarEstado();
    try {
      const categorias = await requisitar('/categorias');
      if (!modal.open) return;
      categoriaEl.replaceChildren(opcao('Selecione uma categoria'));
      for (const categoria of categorias || []) {
        categoriaEl.add(opcao(categoria.nome, String(categoria.id)));
      }
      if (!categorias?.length) mensagem('Não há categorias cadastradas.', true);
    } catch (erro) {
      mensagem('Erro ao carregar categorias: ' + erro.message, true);
      categoriaEl.replaceChildren(opcao('Categorias indisponíveis'));
    } finally {
      carregando = false;
      atualizarEstado();
    }
  }

  async function selecionarCategoria() {
    const atual = ++sequencia;
    const id = categoriaEl.value;
    produtoSelecionado = null;
    midias = [];
    resumoEl.textContent = '';
    produtoEl.replaceChildren(opcao(id ? 'Carregando produtos...' : 'Selecione uma categoria'));
    mensagem('');
    if (!id) { atualizarEstado(); return; }
    carregando = true;
    atualizarEstado();
    try {
      const dados = await requisitar('/produtos?categoriaId=' + encodeURIComponent(id));
      if (atual !== sequencia || categoriaEl.value !== id || !modal.open) return;
      produtoEl.replaceChildren(opcao('Selecione um produto'));
      for (const produto of dados?.produtos || []) {
        // Incluir também produtos sem foto principal ou preço: podem possuir outras fotos/vídeos.
        produtoEl.add(opcao(produto.nome, String(produto.id)));
      }
      if (!(dados?.produtos || []).length) mensagem('Esta categoria não possui produtos ativos.', true);
    } catch (erro) {
      if (atual === sequencia) mensagem('Erro ao carregar produtos: ' + erro.message, true);
    } finally {
      if (atual === sequencia) { carregando = false; atualizarEstado(); }
    }
  }

  async function selecionarProduto() {
    const atual = ++sequencia;
    const produtoId = produtoEl.value;
    const categoriaId = categoriaEl.value;
    produtoSelecionado = null;
    midias = [];
    resumoEl.textContent = '';
    mensagem('');
    if (!produtoId) { atualizarEstado(); return; }
    carregando = true;
    atualizarEstado();
    try {
      const dados = await requisitar('/produto-midias?produtoId=' +
        encodeURIComponent(produtoId) + '&categoriaId=' + encodeURIComponent(categoriaId));
      if (atual !== sequencia || !modal.open ||
        produtoEl.value !== produtoId || categoriaEl.value !== categoriaId) return;
      produtoSelecionado = dados.produto;
      midias = dados.midias || [];
      resumoEl.textContent = produtoSelecionado.nome + ' — ' +
        dados.total_fotos + ' foto(s), ' + dados.total_videos + ' vídeo(s). ' +
        (midias.length ? 'Envio em sequência, uma mídia por vez.' : 'Nenhuma mídia cadastrada.');
    } catch (erro) {
      if (atual === sequencia) mensagem('Erro ao consultar mídias: ' + erro.message, true);
    } finally {
      if (atual === sequencia) { carregando = false; atualizarEstado(); }
    }
  }

  async function enviar() {
    if (enviando || carregando || !produtoSelecionado || !midias.length) return;
    const telefone = telefoneInicial;
    const categoriaId = categoriaEl.value;
    const produtoId = produtoEl.value;
    if (!telefoneValido(telefone) || telefoneAtivo() !== telefone) {
      mensagem('A conversa foi alterada. Feche o modal e selecione novamente.', true);
      atualizarEstado();
      return;
    }
    const total = midias.length;
    if (!confirm('Enviar ' + total + ' mídia(s) (' + midias.filter(m => m.tipo === 'foto').length +
      ' fotos e ' + midias.filter(m => m.tipo === 'video').length + ' vídeos) de "' +
      produtoSelecionado.nome + '" para ' + telefone + '?')) return;

    enviando = true;
    atualizarEstado();
    categoriaEl.disabled = true;
    produtoEl.disabled = true;
    const lote = 'botmidias-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    const falhas = [];
    let enviados = 0;
    try {
      mensagem('Conferindo conexão da Z-API...');
      const conexao = await requisitar('/conexao');
      if (!conexao?.connected || !conexao?.smartphoneConnected) {
        throw new Error(conexao?.error || 'WhatsApp desconectado.');
      }
      for (let i = 0; i < total; i++) {
        if (telefoneAtivo() !== telefone) {
          falhas.push('Conversa alterada; envio interrompido para evitar destinatário incorreto.');
          break;
        }
        const midia = midias[i];
        mensagem('Enviando ' + (i + 1) + '/' + total + ': ' +
          (midia.tipo === 'foto' ? 'Foto ' : 'Vídeo ') + midia.posicao + '...');
        try {
          await requisitar('/produto-midia', {
            method: 'POST',
            body: JSON.stringify({
              requestId: lote + ':' + midia.tipo + midia.posicao,
              telefone, categoriaId, produtoId, tipo: midia.tipo, posicao: midia.posicao
            })
          });
          enviados++;
        } catch (erro) {
          falhas.push((midia.tipo === 'foto' ? 'Foto ' : 'Vídeo ') + midia.posicao + ': ' + erro.message);
        }
        if (i < total - 1) await new Promise(resolver => setTimeout(resolver, 1800));
      }
      if (falhas.length) {
        mensagem('Enviadas ' + enviados + '/' + total + ' mídias. ' +
          falhas.join(' | ') + ' Não repita envios com erro sem conferir a conversa.', true);
      } else {
        mensagem('Concluído: ' + enviados + ' mídia(s) enviadas para ' + telefone + '.');
      }
    } catch (erro) {
      mensagem('Envio interrompido após ' + enviados + '/' + total + ': ' + erro.message, true);
    } finally {
      enviando = false;
      atualizarEstado();
    }
  }

  abrirBtn.addEventListener('click', abrirModal);
  categoriaEl.addEventListener('change', selecionarCategoria);
  produtoEl.addEventListener('change', selecionarProduto);
  confirmarBtn.addEventListener('click', enviar);
  cancelarBtn.addEventListener('click', () => { if (!enviando) modal.close(); });
  modal.addEventListener('cancel', evento => { if (enviando) evento.preventDefault(); });
  window.BotAdmin = window.BotAdmin || {};
  window.BotAdmin.atualizarEnvioProduto = atualizarEstado;
  atualizarEstado();
})();
