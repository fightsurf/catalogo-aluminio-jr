(() => {
  'use strict';

  const API = '/api/whatsapp/status';
  const INTERVALO_ENTRE_PRODUTOS_MS = 5000;
  const el = (id) => document.getElementById(id);
  const select = el('select-categoria-whatsapp');
  const botao = el('btn-enviar-categoria');
  const destinoEl = el('categoria-whatsapp-destino');
  const feedbackEl = el('categoria-whatsapp-feedback');

  if (!select || !botao || !destinoEl || !feedbackEl) return;

  let categorias = [];
  let carregando = true;
  let enviando = false;

  function telefoneSelecionado() {
    return String(window.BotAdmin?.getTelefoneAtivo?.() || '').trim();
  }

  function telefoneValido(telefone) {
    // Não remover "@lid": isso transformaria um ID interno em um número incorreto.
    // A operação atende aos contatos brasileiros com DDI 55 e DDD.
    return /^55\d{10,11}$/.test(telefone);
  }

  function informar(texto, estado = '') {
    feedbackEl.textContent = texto;
    feedbackEl.dataset.estado = estado;
  }

  function atualizarEstado() {
    const telefone = telefoneSelecionado();
    if (telefone.endsWith('@lid')) {
      destinoEl.textContent = 'Contato sem telefone confirmado (LID)';
    } else {
      destinoEl.textContent = telefone ? 'Destino: ' + telefone : 'Selecione uma conversa';
    }

    select.disabled = carregando || enviando || !categorias.length;
    botao.disabled = carregando || enviando || !select.value || !telefoneValido(telefone);

    if (telefone.endsWith('@lid')) {
      botao.title = 'Vincule um telefone real ao contato antes de enviar.';
    } else if (telefone && !telefoneValido(telefone)) {
      botao.title = 'O contato deve ter DDI 55 e DDD.';
    } else {
      botao.title = 'Enviar fotos, descrições e preços da categoria para a conversa selecionada.';
    }
  }

  async function requisitar(caminho, opcoes = {}) {
    const resposta = await fetch(API + caminho, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}) },
      ...opcoes
    });

    let corpo;
    try {
      corpo = await resposta.json();
    } catch (_) {
      throw new Error('Resposta inválida. Verifique se a sessão administrativa está ativa.');
    }

    if (!resposta.ok || corpo?.success !== true) {
      throw new Error(corpo?.error || corpo?.message || 'Falha HTTP ' + resposta.status);
    }

    return corpo.data;
  }

  async function carregarCategorias() {
    carregando = true;
    select.replaceChildren(new Option('Carregando categorias...', ''));
    atualizarEstado();

    try {
      const lista = await requisitar('/categorias');
      categorias = Array.isArray(lista) ? lista : [];
      select.replaceChildren(new Option('Selecione uma categoria', ''));

      for (const categoria of categorias) {
        const publicaveis = Number(categoria.total_publicaveis || 0);
        const opcao = new Option(categoria.nome + ' (' + publicaveis + ' com foto)', String(categoria.id));
        opcao.disabled = publicaveis === 0;
        select.add(opcao);
      }

      if (!categorias.length) informar('Nenhuma categoria cadastrada.', 'erro');
    } catch (erro) {
      categorias = [];
      select.replaceChildren(new Option('Não foi possível carregar categorias', ''));
      informar('Erro ao carregar categorias: ' + erro.message, 'erro');
    } finally {
      carregando = false;
      atualizarEstado();
    }
  }

  function aguardar(ms) {
    return new Promise((resolver) => setTimeout(resolver, ms));
  }

  async function enviarCategoria() {
    if (carregando || enviando) return;
    const telefone = telefoneSelecionado();
    const id = select.value;
    const categoria = categorias.find((item) => String(item.id) === id);

    if (!categoria || !telefoneValido(telefone)) {
      informar('Selecione uma conversa com telefone válido (55 + DDD) e uma categoria.', 'erro');
      return;
    }

    enviando = true;
    atualizarEstado();
    informar('Carregando os produtos da categoria...');

    try {
      const dados = await requisitar('/produtos?categoriaId=' + encodeURIComponent(id));
      const produtos = (Array.isArray(dados?.produtos) ? dados.produtos : [])
        .filter((produto) => produto.publicavel);
      const ignorados = (Array.isArray(dados?.produtos) ? dados.produtos.length : 0) - produtos.length;

      if (!produtos.length) throw new Error('A categoria não contém produtos ativos com foto e preço para enviar.');
      if (telefoneSelecionado() !== telefone) {
        throw new Error('A conversa selecionada mudou. Inicie novamente para evitar envio ao destinatário errado.');
      }

      const mensagem = 'Enviar ' + produtos.length + ' produto(s) da categoria "' +
        categoria.nome + '" para o WhatsApp ' + telefone +
        (ignorados ? '? (' + ignorados + ' sem requisitos para envio serão ignorados.)' : '?') +
        '\nSerão enviadas fotos com descrição e preço, uma por vez.';
      if (!window.confirm(mensagem)) {
        informar('Envio cancelado.');
        return;
      }

      informar('Verificando conexão do WhatsApp...');
      const conexao = await requisitar('/conexao');
      if (!conexao?.connected || !conexao?.smartphoneConnected) {
        throw new Error(conexao?.error || 'WhatsApp desconectado. Verifique a conexão da Z-API.');
      }

      const lote = 'botadmin-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      let sucessos = 0;
      const falhas = [];

      for (let indice = 0; indice < produtos.length; indice += 1) {
        const produto = produtos[indice];
        informar('Enviando ' + (indice + 1) + '/' + produtos.length + ' para ' + telefone +
          ': ' + produto.nome + '. Mantenha a tela aberta.');

        try {
          await requisitar('/produto', {
            method: 'POST',
            body: JSON.stringify({
              requestId: lote + ':' + produto.id,
              produtoId: produto.id,
              categoriaId: categoria.id,
              telefone: telefone
            })
          });
          sucessos += 1;
        } catch (erro) {
          falhas.push(produto.nome + ': ' + erro.message);
        }

        if (indice < produtos.length - 1) {
          informar('Concluídos ' + (indice + 1) + '/' + produtos.length +
            ' para ' + telefone + '. Aguardando próximo envio...');
          await aguardar(INTERVALO_ENTRE_PRODUTOS_MS);
        }
      }

      if (falhas.length) {
        informar('Enviados ' + sucessos + '/' + produtos.length + ' para ' + telefone +
          '; ' + falhas.length + ' falha(s). ' + falhas.slice(0, 3).join(' | '), 'erro');
      } else {
        informar('Categoria "' + categoria.nome + '": ' + sucessos +
          ' produto(s) enviados para ' + telefone + '.', 'sucesso');
      }
    } catch (erro) {
      informar('Envio não concluído: ' + erro.message, 'erro');
    } finally {
      enviando = false;
      atualizarEstado();
    }
  }

  window.BotAdmin = window.BotAdmin || {};
  window.BotAdmin.atualizarEnvioCategoria = atualizarEstado;

  select.addEventListener('change', () => {
    informar('');
    atualizarEstado();
  });
  botao.addEventListener('click', enviarCategoria);
  carregarCategorias();
})();
