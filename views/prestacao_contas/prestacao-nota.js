/* Importação de notas: recortar/colar, múltiplas fotos, prévia editável e gravação confirmada. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const painel = $('nota-painel');
  const area = $('nota-area');
  const tabela = $('nota-itens');
  const revisao = $('nota-revisao');
  const status = $('nota-status');
  const tipos = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const LIMITE_IMAGENS = 5, LIMITE_BYTES = 7 * 1024 * 1024;
  let arquivos = [];
  let urls = [];
  let avisos = [];
  let busy = false;
  let idAtivo = null;
  let imagemRevisada = false;

  function mostrarStatus(mensagem, erro = false) {
    status.textContent = mensagem;
    status.style.color = erro ? 'var(--pc-danger, #b42318)' : 'var(--pc-text)';
  }
  async function lerRespostaApi(res, mensagemPadrao) {
    const caminhoFinal = res.redirected ? new URL(res.url, window.location.href).pathname : '';
    if (caminhoFinal === '/login' || caminhoFinal === '/login/') {
      throw new Error('Sua sessão administrativa expirou. Faça login novamente e repita a importação.');
    }
    const tipo = String(res.headers.get('content-type') || '').toLowerCase();
    if (!tipo.includes('application/json') && !tipo.includes('+json')) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('Faça login administrativo para importar notas por IA.');
      }
      if (res.status === 413) {
        throw new Error('O envio excedeu o limite de tamanho. Reduza as imagens e tente novamente.');
      }
      if ([502, 503, 504].includes(res.status)) {
        throw new Error('O servidor não conseguiu concluir a operação (HTTP ' + res.status + '). Tente novamente e, se persistir, verifique os logs do Render.');
      }
      throw new Error('O servidor retornou uma resposta inesperada (HTTP ' + res.status + '). Atualize a página e tente novamente.');
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error('O servidor retornou uma resposta JSON incompleta (HTTP ' + res.status + '). Tente novamente.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Faça login administrativo para importar notas por IA.');
    }
    if (!res.ok || !json || json.success !== true) {
      const detalhe = json && (json.message || json.erro || json.error);
      throw new Error(typeof detalhe === 'string' && detalhe.trim()
        ? detalhe : mensagemPadrao + ' (HTTP ' + res.status + ').');
    }
    return json;
  }
  function revogarUrls() { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; }
  function limparRevisao() {
    revisao.hidden = true;
    tabela.innerHTML = '';
    $('nota-avisos').textContent = '';
    avisos = [];
    imagemRevisada = false;
  }
  function limparTudo() {
    revogarUrls();
    arquivos = [];
    $('nota-miniaturas').replaceChildren();
    $('nota-arquivos').value = '';
    limparRevisao();
    mostrarStatus('');
  }
  function abrir() {
    if (!prestacaoAtualId || prestacaoAtualResumo && isConcluida(prestacaoAtualResumo.cabecalho)) {
      showMsg('Abra uma prestação ainda não concluída.', 'erro');
      return false;
    }
    painel.hidden = false;
    return true;
  }
  function fechar() { painel.hidden = true; limparTudo(); }
  function adicionarArquivos(lista) {
    const imagens = Array.from(lista || []);
    if (!imagens.length) return;
    for (const arquivo of imagens) {
      if (!tipos.has(arquivo.type)) {
        mostrarStatus('Formato inválido. Selecione imagens JPG, PNG ou WEBP.', true);
        continue;
      }
      if (arquivo.size > LIMITE_BYTES || arquivo.size === 0) {
        mostrarStatus('Cada imagem precisa ter até 7 MB e não pode estar vazia.', true);
        continue;
      }
      if (arquivos.length >= LIMITE_IMAGENS) {
        mostrarStatus('Limite de 5 imagens por interpretação.', true);
        break;
      }
      arquivos.push(arquivo);
    }
    limparRevisao();
    montarMiniaturas();
  }
  function montarMiniaturas() {
    revogarUrls();
    const container = $('nota-miniaturas');
    container.replaceChildren();
    arquivos.forEach((arquivo, indice) => {
      const card = document.createElement('div');
      card.className = 'nota-thumb';
      const url = URL.createObjectURL(arquivo);
      urls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Página ' + (indice + 1);
      const titulo = document.createElement('small');
      titulo.textContent = 'Página ' + (indice + 1) + ' · ' + (arquivo.name || 'imagem colada');
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.textContent = 'Remover';
      remover.addEventListener('click', () => {
        if (busy) return;
        arquivos.splice(indice, 1);
        limparRevisao();
        montarMiniaturas();
      });
      card.append(img, titulo, remover);
      container.appendChild(card);
    });
    if (arquivos.length) mostrarStatus(arquivos.length + ' imagem(ns) pronta(s) para interpretar.');
  }
  function formato(n) {
    return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function lerCampo(tr, nome) { return tr.querySelector('[name="' + nome + '"]'); }
  function campoNumerico(valor) {
    if (valor === '' || valor === null || valor === undefined) return null;
    const num = Number(String(valor).replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }
  function criarLinha(item = {}) {
    const tr = document.createElement('tr');
    tr.dataset.subtotal = item.subtotal_informado === null || item.subtotal_informado === undefined ? '' : String(item.subtotal_informado);
    tr.dataset.alertas = JSON.stringify(item.alertas || []);
    tr.innerHTML = `
      <td><input name="material" aria-label="Descrição do material" maxlength="120" value="${escapeHtml(item.material || '')}" />
          <div class="nota-linha-alertas"></div></td>
      <td><input name="quantidade" aria-label="Quantidade" type="number" min="0.001" step="0.001" value="${item.quantidade ?? ''}" /></td>
      <td><select name="unidade" aria-label="Unidade">
        <option value="" ${!item.unidade ? 'selected' : ''}>Escolher</option>
        <option value="KG" ${item.unidade === 'KG' ? 'selected' : ''}>KG</option>
        <option value="UN" ${item.unidade === 'UN' ? 'selected' : ''}>UN</option>
      </select></td>
      <td><input name="preco" aria-label="Preço unitário" type="number" min="0" step="0.01" value="${item.preco_unitario ?? ''}" /></td>
      <td class="nota-lido">${item.subtotal_informado == null ? '—' : 'R$ ' + formato(item.subtotal_informado)}</td>
      <td class="nota-calculado">—</td>
      <td><button type="button" class="nota-excluir" aria-label="Excluir linha">Excluir</button></td>`;
    tr.querySelector('.nota-linha-alertas').textContent = (item.alertas || []).join(' ');
    tr.querySelector('.nota-excluir').addEventListener('click', () => {
      tr.remove();
      recalcular();
    });
    tr.querySelectorAll('input,select').forEach(inp => inp.addEventListener('input', recalcular));
    tabela.appendChild(tr);
    recalcular();
  }
  function recalcular() {
    for (const tr of tabela.rows) {
      const quantidade = campoNumerico(lerCampo(tr, 'quantidade').value);
      const preco = campoNumerico(lerCampo(tr, 'preco').value);
      tr.querySelector('.nota-calculado').textContent =
        quantidade !== null && quantidade > 0 && preco !== null && preco >= 0
          ? 'R$ ' + formato(Math.round((quantidade * preco + Number.EPSILON) * 100) / 100)
          : '—';
    }
  }
  function lerItens() {
    return Array.from(tabela.rows).map((tr, indice) => {
      const item = {
        material: lerCampo(tr, 'material').value.trim(),
        quantidade: campoNumerico(lerCampo(tr, 'quantidade').value),
        unidade: lerCampo(tr, 'unidade').value,
        preco_unitario: campoNumerico(lerCampo(tr, 'preco').value)
      };
      if (!item.material || !item.unidade || item.quantidade === null || item.quantidade <= 0 ||
          item.preco_unitario === null || item.preco_unitario < 0 ||
          (item.unidade === 'UN' && !Number.isInteger(item.quantidade)) ||
          Math.abs(item.quantidade * 1000 - Math.round(item.quantidade * 1000)) > 0.00001 ||
          Math.abs(item.preco_unitario * 100 - Math.round(item.preco_unitario * 100)) > 0.00001) {
        throw new Error('Revise descrição, quantidade, unidade e preço do item ' + (indice + 1) + '. Para UN, use quantidade inteira.');
      }
      if (item.material.length > 120) throw new Error('Descrição muito longa no item ' + (indice + 1) + '.');
      return item;
    });
  }
  async function interpretar() {
    if (busy || !arquivos.length || !abrir()) return;
    busy = true;
    const id = prestacaoAtualId;
    $('nota-interpretar').disabled = true;
    $('nota-confirmar').disabled = true;
    limparRevisao();
    mostrarStatus('Lendo as imagens com IA…');
    const dados = new FormData();
    arquivos.forEach(a => dados.append('imagens', a, a.name || 'nota.png'));
    try {
      const res = await fetch('/api/prestacoes/' + encodeURIComponent(id) + '/interpretar-nota', {
        method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin', body: dados
      });
      const json = await lerRespostaApi(res, 'Falha na interpretação');
      if (String(prestacaoAtualId) !== String(id)) return;
      avisos = json.data.avisos || [];
      const itens = json.data.itens || [];
      if (!itens.length) {
        mostrarStatus('Nenhum item encontrado. Fotografe com mais nitidez.', true);
        return;
      }
      for (const item of itens) criarLinha(item);
      $('nota-avisos').replaceChildren();
      avisos.forEach(aviso => {
        const p = document.createElement('p'); p.textContent = 'Atenção: ' + aviso;
        $('nota-avisos').appendChild(p);
      });
      revisao.hidden = false;
      imagemRevisada = true;
      mostrarStatus(itens.length + ' item(ns) reconhecido(s). Corrija os campos e confirme a importação.');
      revisao.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      mostrarStatus(err.message || 'Falha ao interpretar nota.', true);
    } finally {
      busy = false;
      $('nota-interpretar').disabled = false;
      $('nota-confirmar').disabled = false;
    }
  }
  async function confirmar() {
    if (busy || !imagemRevisada || !prestacaoAtualId) return;
    let itens;
    try {
      itens = lerItens();
      if (!itens.length) throw new Error('Não há itens para importar.');
      if (itens.length > 200) throw new Error('Limite de 200 itens.');
    } catch (err) { mostrarStatus(err.message, true); return; }
    const divergencias = Array.from(tabela.rows).filter(tr => {
      const informado = campoNumerico(tr.dataset.subtotal);
      if (informado === null) return false;
      const quantidade = campoNumerico(lerCampo(tr, 'quantidade').value);
      const preco = campoNumerico(lerCampo(tr, 'preco').value);
      return Math.abs(Math.round((quantidade * preco + Number.EPSILON) * 100) / 100 - informado) > .02;
    }).length;
    const alertasExtraidos = Array.from(tabela.rows).filter(tr => {
      try { return JSON.parse(tr.dataset.alertas).length > 0; } catch { return false; }
    }).length;
    let aviso = 'Confirmar inclusão de ' + itens.length + ' item(ns) na prestação?';
    if (divergencias) aviso += '\nATENÇÃO: ' + divergencias + ' subtotal(is) diferente(s) do impresso.';
    if (alertasExtraidos || avisos.length) aviso += '\nConfira os alertas de leitura da IA.';
    if (!window.confirm(aviso)) return;
    busy = true;
    const id = prestacaoAtualId;
    $('nota-confirmar').disabled = true;
    $('nota-interpretar').disabled = true;
    mostrarStatus('Gravando os itens revisados…');
    try {
      const res = await fetch('/api/prestacoes/' + encodeURIComponent(id) + '/itens/importar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin', body: JSON.stringify({ itens })
      });
      const json = await lerRespostaApi(res, 'Não foi possível importar os itens');
      fechar();
      await carregarResumo(id);
      await carregarLista();
      showMsg(json.data.quantidade + ' item(ns) importado(s) com sucesso!', 'sucesso');
    } catch (err) {
      mostrarStatus(err.message || 'Falha ao importar.', true);
    } finally {
      busy = false;
      $('nota-confirmar').disabled = false;
      $('nota-interpretar').disabled = false;
    }
  }

  $('btn-importar-nota').addEventListener('click', () => {
    if (painel.hidden) { if (abrir()) area.focus(); }
    else fechar();
  });
  $('nota-fechar').addEventListener('click', () => { if (!busy) fechar(); });
  $('nota-limpar').addEventListener('click', () => { if (!busy) limparTudo(); });
  $('nota-escolher').addEventListener('click', e => { e.stopPropagation(); $('nota-arquivos').click(); });
  area.addEventListener('click', e => { if (e.target === area || e.target.tagName === 'STRONG' || e.target.tagName === 'P') $('nota-arquivos').click(); });
  area.addEventListener('keydown', e => {
    if (e.target === area && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); $('nota-arquivos').click();
    }
  });
  $('nota-arquivos').addEventListener('change', e => { if (!busy) adicionarArquivos(e.target.files); e.target.value = ''; });
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('nota-arrastando'); });
  area.addEventListener('dragleave', () => area.classList.remove('nota-arrastando'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('nota-arrastando');
    if (!busy) adicionarArquivos(e.dataTransfer.files);
  });
  window.addEventListener('paste', e => {
    if (busy || !prestacaoAtualId || (prestacaoAtualResumo && isConcluida(prestacaoAtualResumo.cabecalho))) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const lista = Array.from(e.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).filter(Boolean);
    if (!lista.length) return;
    e.preventDefault();
    if (abrir()) { adicionarArquivos(lista); area.focus(); }
  });
  $('nota-interpretar').addEventListener('click', interpretar);
  $('nota-confirmar').addEventListener('click', confirmar);
  $('nota-adicionar').addEventListener('click', () => criarLinha({ unidade: 'KG' }));
  window.onPrestacaoNotaAtualizada = (cabecalho) => {
    if (idAtivo !== null && String(idAtivo) !== String(cabecalho?.id)) fechar();
    idAtivo = cabecalho?.id || null;
    if (cabecalho && isConcluida(cabecalho)) fechar();
  };
})();
