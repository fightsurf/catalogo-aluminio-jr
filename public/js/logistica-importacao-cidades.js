/* global transportadoraSelecionada, carregarCidades */
'use strict';

(() => {
  const el = id => document.getElementById('importacao-cidades-' + id);
  const modal = el('modal');
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  const estado = { destino: null, cidades: [], previa: null, versao: 0, ocupado: null, controlador: null, timer: null };

  function opcoesUf(select, valor, padrao = false) {
    select.replaceChildren(new Option(padrao ? 'Não definir UF padrão' : 'UF', ''));
    UFS.forEach(uf => select.add(new Option(uf, uf)));
    if (valor && !UFS.includes(valor)) select.add(new Option(valor + ' (revisar)', valor));
    select.value = valor || '';
  }
  opcoesUf(el('uf'), '', true);

  function status(texto, classe = '') {
    el('status').textContent = texto;
    el('status').className = 'importacao-cidades-status' + (classe ? ' ' + classe : '');
  }

  function limparPrevia() {
    clearTimeout(estado.timer);
    estado.timer = null;
    estado.previa = null;
    el('previa').hidden = true;
    el('confirmar').disabled = true;
    el('confirmar').textContent = 'Importar cidades';
  }

  function controles() {
    const gravando = estado.ocupado === 'confirmar';
    modal.setAttribute('aria-busy', String(Boolean(estado.ocupado)));
    for (const campo of modal.querySelectorAll('input, textarea, select')) campo.disabled = gravando;
    for (const botao of el('linhas').querySelectorAll('button')) botao.disabled = gravando;
    el('fechar').disabled = gravando;
    el('cancelar').disabled = gravando;
    el('analisar').disabled = Boolean(estado.ocupado);
    el('conferir').disabled = Boolean(estado.ocupado) || !estado.cidades.length;
    el('adicionar').disabled = gravando || estado.cidades.length >= 300;
    el('confirmar').disabled = Boolean(estado.ocupado) || !estado.previa;
  }

  function invalidar(origemAlterada = false) {
    if (estado.ocupado === 'confirmar') return;
    estado.versao += 1;
    estado.controlador?.abort();
    estado.controlador = null;
    estado.ocupado = null;
    limparPrevia();
    if (origemAlterada) {
      estado.cidades = [];
      el('linhas').replaceChildren();
      el('editor').hidden = true;
      el('avisos').hidden = true;
      status('Clique em “Analisar com IA” para conferir o conteúdo atualizado.');
    } else {
      status('Lista alterada. Clique em “Conferir cidades” para atualizar a prévia.');
    }
    controles();
  }

  function destinoAtual() {
    return estado.destino && transportadoraSelecionada &&
      String(estado.destino.id) === String(transportadoraSelecionada.id);
  }

  function iniciar(tipo) {
    if (estado.ocupado) return null;
    if (!destinoAtual()) {
      limparPrevia();
      status('A transportadora selecionada mudou. Feche a importação e abra novamente para o cadastro correto.', 'erro');
      return null;
    }
    estado.versao += 1;
    estado.controlador = new AbortController();
    estado.ocupado = tipo;
    controles();
    return { versao: estado.versao, id: estado.destino.id, signal: estado.controlador.signal };
  }

  function atual(requisicao) {
    return modal.open && requisicao.versao === estado.versao &&
      String(requisicao.id) === String(estado.destino?.id) && destinoAtual();
  }

  function terminar(requisicao) {
    if (requisicao.versao !== estado.versao) return;
    estado.ocupado = null;
    estado.controlador = null;
    controles();
  }

  async function enviar(requisicao, acao, payload) {
    const multipart = payload instanceof FormData;
    const resposta = await fetch('/api/logistica/transportadoras/' + encodeURIComponent(requisicao.id) +
      '/importacao-cidades/' + acao, {
      method: 'POST', credentials: 'same-origin', signal: requisicao.signal,
      headers: multipart ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: multipart ? payload : JSON.stringify(payload)
    });
    if (resposta.status === 401 || resposta.redirected || !String(resposta.headers.get('content-type')).includes('application/json')) {
      throw new Error('Sua sessão expirou. Entre novamente como administrador e reabra a importação.');
    }
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || dados.error || 'Não foi possível concluir a importação.');
    return dados;
  }

  function mostrarLista(id, itens) {
    const lista = el(id);
    lista.replaceChildren();
    for (const item of itens) {
      const li = document.createElement('li');
      li.textContent = item;
      lista.appendChild(li);
    }
    lista.hidden = !itens.length;
  }

  function renderizarEditor() {
    const corpo = el('linhas');
    corpo.replaceChildren();
    el('editor').hidden = false;
    estado.cidades.forEach((cidade, indice) => {
      const tr = document.createElement('tr');
      const tdNome = document.createElement('td');
      const nome = document.createElement('input');
      nome.type = 'text';
      nome.maxLength = 120;
      nome.value = cidade.nome;
      nome.setAttribute('aria-label', 'Município ' + (indice + 1));
      nome.addEventListener('input', () => { cidade.nome = nome.value; invalidar(); });
      tdNome.appendChild(nome);
      const tdUf = document.createElement('td');
      tdUf.className = 'coluna-uf';
      const uf = document.createElement('select');
      uf.setAttribute('aria-label', 'UF do município ' + (indice + 1));
      opcoesUf(uf, cidade.uf);
      uf.addEventListener('change', () => { cidade.uf = uf.value; invalidar(); });
      tdUf.appendChild(uf);
      const tdRemover = document.createElement('td');
      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'btn-danger';
      remover.textContent = '×';
      remover.setAttribute('aria-label', 'Remover município ' + (indice + 1));
      remover.addEventListener('click', () => {
        estado.cidades.splice(indice, 1);
        invalidar();
        renderizarEditor();
        controles();
      });
      tdRemover.appendChild(remover);
      tr.append(tdNome, tdUf, tdRemover);
      corpo.appendChild(tr);
    });
  }

  function renderizarPrevia(dados, requisicao) {
    if (String(dados.transportadora?.id) !== String(requisicao.id)) throw new Error('A prévia não corresponde à transportadora selecionada. Confira novamente.');
    limparPrevia();
    el('previa').hidden = false;
    const resumo = dados.resumo || {};
    const resumoArea = el('resumo');
    resumoArea.replaceChildren();
    for (const [campo, texto] of [['novas', 'novas'], ['ja_vinculadas', 'já vinculadas'], ['repetidas', 'repetidas na lista'], ['pendentes', 'pendências']]) {
      const item = document.createElement('span');
      item.textContent = Number(resumo[campo] || 0) + ' ' + texto;
      resumoArea.appendChild(item);
    }
    mostrarLista('validadas', (dados.cidades || []).map(cidade => cidade.nome + ' - ' + cidade.uf +
      (cidade.situacao === 'ja_vinculada' ? ' · já vinculada, será preservada' : ' · será adicionada')));
    const pendencias = dados.pendencias || [];
    el('pendencias-area').hidden = !pendencias.length;
    mostrarLista('pendencias', pendencias.map(cidade => (cidade.nome || 'Município sem nome') +
      (cidade.uf ? ' - ' + cidade.uf : '') + ': ' + cidade.motivo));
    if (dados.pode_confirmar && typeof dados.token_previa === 'string' && !pendencias.length && Number(resumo.novas) > 0) {
      const validade = new Date(dados.expira_em).getTime();
      if (!Number.isFinite(validade) || validade <= Date.now()) throw new Error('A prévia expirou. Clique em “Conferir cidades” novamente.');
      estado.previa = { token: dados.token_previa, id: requisicao.id, novas: Number(resumo.novas) };
      el('confirmar').textContent = 'Importar ' + resumo.novas + (Number(resumo.novas) === 1 ? ' cidade' : ' cidades');
      estado.timer = setTimeout(() => {
        estado.previa = null;
        el('confirmar').disabled = true;
        if (estado.ocupado !== 'confirmar') status('A prévia expirou. Clique em “Conferir cidades” para atualizar.', 'erro');
      }, Math.min(validade - Date.now(), 2147483647));
      status('Confira a lista acima. A importação adicionará as novas cidades a ' + estado.destino.nome + '.');
    } else if (pendencias.length) {
      status('A importação está bloqueada até corrigir as pendências na lista de cidades identificadas.', 'erro');
    } else {
      status('Todas as cidades válidas da lista já estão vinculadas. Nenhuma alteração é necessária.', 'sucesso');
    }
  }

  async function conferir() {
    if (!estado.cidades.length) return status('Adicione pelo menos uma cidade para conferir.', 'erro');
    const cidades = estado.cidades.map(cidade => ({ nome: cidade.nome.trim(), uf: cidade.uf }));
    if (cidades.some(cidade => !cidade.nome)) return status('Preencha o nome das cidades ou remova as linhas vazias.', 'erro');
    limparPrevia();
    const requisicao = iniciar('previa');
    if (!requisicao) return;
    status('Conferindo municípios, UFs e vínculos já cadastrados...');
    try {
      const dados = await enviar(requisicao, 'previa', { cidades });
      if (atual(requisicao)) renderizarPrevia(dados, requisicao);
    } catch (erro) {
      if (atual(requisicao) && erro.name !== 'AbortError') status(erro.message, 'erro');
    } finally {
      terminar(requisicao);
    }
  }

  function arquivosValidos(arquivos) {
    if (arquivos.length > 5) throw new Error('Envie até 5 fotos ou apenas 1 PDF.');
    if (arquivos.reduce((total, arquivo) => total + arquivo.size, 0) > 10 * 1024 * 1024) throw new Error('Os arquivos devem somar no máximo 10 MB.');
    const tipos = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (arquivos.some(arquivo => !tipos.includes(arquivo.type))) throw new Error('Use fotos JPG, PNG ou WebP, ou um arquivo PDF.');
    if (arquivos.some(arquivo => arquivo.type === 'application/pdf') && arquivos.length !== 1) throw new Error('Envie apenas 1 PDF, sem misturar com fotos.');
    if (arquivos.some(arquivo => !arquivo.size)) throw new Error('Um dos arquivos está vazio. Selecione outro arquivo.');
  }

  async function analisar() {
    const texto = el('texto').value.trim();
    const arquivos = Array.from(el('arquivos').files || []);
    if (!texto && !arquivos.length) return status('Cole a lista de cidades ou selecione fotos ou um PDF.', 'erro');
    try { arquivosValidos(arquivos); } catch (erro) { return status(erro.message, 'erro'); }
    limparPrevia();
    const requisicao = iniciar('interpretar');
    if (!requisicao) return;
    status('A IA está identificando as cidades. Aguarde...');
    const dadosForm = new FormData();
    dadosForm.append('texto', texto);
    dadosForm.append('uf_padrao', el('uf').value);
    arquivos.forEach(arquivo => dadosForm.append('arquivos', arquivo));
    let conferirDepois = false;
    try {
      const dados = await enviar(requisicao, 'interpretar', dadosForm);
      if (!atual(requisicao)) return;
      if (!Array.isArray(dados.cidades) || dados.cidades.length > 300) throw new Error('A IA retornou uma lista inválida ou com mais de 300 cidades. Divida a importação.');
      estado.cidades = dados.cidades.map(cidade => ({ nome: String(cidade.nome || ''), uf: String(cidade.uf || '').toUpperCase() }));
      renderizarEditor();
      mostrarLista('avisos', Array.isArray(dados.avisos) ? dados.avisos.map(String) : []);
      if (!estado.cidades.length) status('Nenhuma cidade foi identificada. Revise o texto ou use arquivos mais legíveis. Você também pode adicionar uma cidade à lista.', 'erro');
      else conferirDepois = true;
    } catch (erro) {
      if (atual(requisicao) && erro.name !== 'AbortError') status(erro.message, 'erro');
    } finally {
      terminar(requisicao);
    }
    if (conferirDepois && atual(requisicao)) await conferir();
  }

  async function confirmar() {
    const previa = estado.previa;
    if (!previa || String(previa.id) !== String(estado.destino?.id)) return;
    const requisicao = iniciar('confirmar');
    if (!requisicao) return;
    clearTimeout(estado.timer);
    status('Importando as cidades para ' + estado.destino.nome + '...');
    try {
      const dados = await enviar(requisicao, 'confirmar', { token_previa: previa.token });
      if (!atual(requisicao)) return;
      if (dados.status !== 'concluido' || String(dados.transportadora?.id) !== String(requisicao.id)) throw new Error('A resposta da gravação precisa ser conferida. Consulte as cidades vinculadas e gere uma nova prévia.');
      limparPrevia();
      status('Importação concluída: ' + Number(dados.adicionadas || 0) + ' cidade(s) adicionada(s), ' +
        Number(dados.ja_vinculadas || 0) + ' vínculo(s) já existente(s) preservado(s). Total: ' +
        Number(dados.total_vinculadas || 0) + ' cidade(s) vinculada(s) a ' + estado.destino.nome + '.', 'sucesso');
      el('cancelar').textContent = 'Concluir';
      // O cadastro permanece capturado durante toda a operação. Só recarregamos o destino correto.
      if (destinoAtual()) {
        try { await carregarCidades(); } catch (_) { status('Importação concluída, mas a lista da página não atualizou. Feche este painel e selecione novamente a transportadora.', 'sucesso'); }
      }
    } catch (erro) {
      if (atual(requisicao)) {
        limparPrevia();
        status(erro.message + ' Confira os vínculos e gere uma nova prévia antes de tentar novamente.', 'erro');
      }
    } finally {
      terminar(requisicao);
    }
  }

  function fechar() {
    if (estado.ocupado === 'confirmar') return;
    estado.versao += 1;
    estado.controlador?.abort();
    estado.controlador = null;
    estado.ocupado = null;
    limparPrevia();
    modal.close();
  }

  function abrir() {
    if (!transportadoraSelecionada?.id) {
      alert('Selecione uma transportadora na lista antes de importar as cidades.');
      return;
    }
    estado.versao += 1;
    estado.destino = { id: transportadoraSelecionada.id, nome: String(transportadoraSelecionada.nome || '') };
    estado.cidades = [];
    estado.ocupado = null;
    limparPrevia();
    el('texto').value = '';
    el('arquivos').value = '';
    el('uf').value = '';
    el('editor').hidden = true;
    el('linhas').replaceChildren();
    el('avisos').hidden = true;
    el('cancelar').textContent = 'Cancelar';
    el('destino').textContent = 'Transportadora: ' + estado.destino.nome;
    status('');
    controles();
    modal.showModal();
    el('texto').focus();
  }

  document.getElementById('abrir-importacao-cidades').addEventListener('click', abrir);
  el('fechar').addEventListener('click', fechar);
  el('cancelar').addEventListener('click', fechar);
  modal.addEventListener('cancel', event => { event.preventDefault(); fechar(); });
  el('texto').addEventListener('input', () => invalidar(true));
  el('arquivos').addEventListener('change', () => invalidar(true));
  el('uf').addEventListener('change', () => invalidar(true));
  el('analisar').addEventListener('click', analisar);
  el('conferir').addEventListener('click', conferir);
  el('confirmar').addEventListener('click', confirmar);
  el('adicionar').addEventListener('click', () => {
    if (estado.cidades.length >= 300) return;
    estado.cidades.push({ nome: '', uf: el('uf').value });
    invalidar();
    renderizarEditor();
    controles();
    el('linhas').lastElementChild?.querySelector('input')?.focus();
  });
})();
