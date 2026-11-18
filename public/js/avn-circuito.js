/* AVN: treino em circuito por tempo, independente da execução tradicional. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = seconds => {
    const s = Math.max(0, Math.ceil(seconds));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  let dialog, session = null, interval = null, audio = null, audioOutput = null, wakeLock = null;
  const CHAVE_PREPARO = 'avn_circuito_preparo_seg';
  const CHAVE_VOZ = 'avn_circuito_anuncio_voz';
  let falaTimer = null;
  function vozAnterior() {
    try { return localStorage.getItem(CHAVE_VOZ) !== 'false'; }
    catch (_) { return true; }
  }

  // SpeechSynthesis usa a voz pt-BR disponível no navegador/dispositivo.
  function cancelarFala() {
    if (falaTimer !== null) { clearTimeout(falaTimer); falaTimer = null; }
    try { window.speechSynthesis?.cancel(); } catch (_) { /* Recurso opcional. */ }
  }

  function anunciarExercicio(s, indice, fase, primeiro = false) {
    cancelarFala();
    if (!s.voice || document.visibilityState !== 'visible') return;
    const nome = s.exercises[indice]?.name;
    if (!nome || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
    const remaining = Math.max(0, s.endsAt - Date.now());
    // Após os sinos, dá um pequeno intervalo antes de anunciar a próxima atividade.
    const delay = Math.min(1200, Math.max(0, remaining - 800));
    falaTimer = window.setTimeout(() => {
      falaTimer = null;
      if (session !== s || s.paused || s.phase !== fase ||
          document.visibilityState !== 'visible') return;
      try {
        const utterance = new window.SpeechSynthesisUtterance(
          (primeiro ? 'Primeiro exercício: ' : 'Próximo exercício: ') + s.exercises[indice].name
        );
        utterance.lang = 'pt-BR';
        utterance.rate = 0.93;
        utterance.volume = 1;
        const voices = window.speechSynthesis.getVoices();
        const voice = voices.find(v => v.lang.toLowerCase() === 'pt-br') ||
                      voices.find(v => v.lang.toLowerCase().startsWith('pt'));
        if (voice) utterance.voice = voice;
        window.speechSynthesis.speak(utterance);
      } catch (_) { /* Sem suporte de voz, mantém o cronômetro normalmente. */ }
    }, delay);
  }
  function preparoAnterior() {
    try {
      const salvo = localStorage.getItem(CHAVE_PREPARO);
      const value = salvo === null ? 10 : Number(salvo);
      return Number.isInteger(value) && value >= 0 && value <= 3600 ? value : 10;
    } catch (_) { return 10; }
  }

  function instalarBotao() {
    const normal = byId('iniciarExecucaoWeb');
    if (!normal || byId('iniciarCircuitoWeb')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'iniciarCircuitoWeb';
    button.className = 'btn primary';
    button.textContent = '🥊 Iniciar treino em circuito';
    button.onclick = () => abrirConfiguracao(button);
    normal.insertAdjacentElement('afterend', button);
  }

  function obterDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'avn-modal-circuito';
    dialog.className = 'avn-circuito-modal';
    dialog.setAttribute('aria-label', 'Treino em circuito');
    dialog.addEventListener('cancel', evt => {
      evt.preventDefault();
      fechar();
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  function erro(message) {
    const target = byId('avnCircuitoErro');
    if (target) target.textContent = message;
    else window.alert(message);
  }

  async function abrirConfiguracao(button) {
    const planoId = byId('selectPlano')?.value;
    const dia = Number(byId('selectDia')?.value);
    if (!/^\d+$/.test(String(planoId || '')) || !Number.isInteger(dia) || dia < 0 || dia > 6) {
      return erro('Selecione um plano e um dia válidos.');
    }
    button.disabled = true;
    try {
      const response = await fetch('/avn/sistema/api/treinos/planos/' + encodeURIComponent(planoId), {
        credentials: 'same-origin', headers: {Accept:'application/json'}
      });
      if (!response.ok) throw Error('Não foi possível carregar os exercícios deste treino.');
      const plan = await response.json();
      const day = (plan.dias || []).find(d => Number(d.dia_semana) === dia);
      const exercises = (day?.exercicios || []).map(x => ({
        id: Number(x.exercicio_id),
        name: String(x.exercicio_nome || 'Exercício ' + x.exercicio_id),
        mediaUrl: String(x.midia_url || ''),
        mediaType: String(x.midia_tipo || '')
      }));
      if (!exercises.length) throw Error('O dia selecionado não contém exercícios.');
      configurar(plan.nome, exercises);
    } catch (e) {
      window.alert(e.message || 'Não foi possível preparar o circuito.');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function configurar(planName, exercises) {
    if (session) return;
    const modal = obterDialog();
    modal.classList.remove('avn-circuito-executando');
    const list = exercises.map((ex, i) =>
      '<li><span class="avn-circuito-num">' + (i + 1) + '</span><span>' + escapeHtml(ex.name) + '</span></li>'
    ).join('');
    modal.innerHTML =
      '<header class="avn-circuito-topo"><div><small>AVN · REGISTRAR TREINO</small><h2>Treino em circuito</h2><p>' + escapeHtml(planName || '') + ' · ' + exercises.length + ' exercícios</p></div>' +
      '<button type="button" class="avn-circuito-fechar" id="avnCircuitoFechar" aria-label="Fechar">×</button></header>' +
      '<div class="avn-circuito-config-grid"><section class="avn-circuito-lista"><h3>Sequência dos exercícios</h3><ol>' + list + '</ol></section>' +
      '<form class="avn-circuito-controles" id="avnCircuitoFormulario"><h3>Configurar tempos</h3>' +
      '<label>Preparo antes de cada exercício (segundos)<input id="avnCircuitoPreparoSeg" name="preparo" type="number" min="0" max="3600" step="1" value="' + preparoAnterior() + '" required inputmode="numeric"></label>' +
      '<label>Tempo de exercício (segundos)<input id="avnCircuitoExercicioSeg" name="exercicio" type="number" min="1" max="3600" step="1" value="60" required inputmode="numeric"></label>' +
      '<label>Tempo de descanso (segundos)<input id="avnCircuitoDescansoSeg" name="descanso" type="number" min="0" max="3600" step="1" value="15" required inputmode="numeric"></label>' +
      '<label class="avn-circuito-voz"><input id="avnCircuitoVoz" type="checkbox"' + (vozAnterior() ? ' checked' : '') + '> 🔊 Anunciar próximo exercício por voz</label>' +
      '<p class="avn-circuito-nota">O anúncio utiliza a voz em português disponível no navegador. O volume depende do aparelho.</p>' +
      '<p class="avn-circuito-nota">Sequência: preparo → exercício → descanso → preparo. O circuito seguirá os ' + exercises.length + ' exercícios uma vez, sem descanso após o último.</p>' +
      '<div id="avnCircuitoErro" class="avn-circuito-erro" role="alert"></div>' +
      '<button class="avn-circuito-iniciar" type="submit">▶ Iniciar circuito</button></form></div>';
    byId('avnCircuitoFechar').onclick = fechar;
    byId('avnCircuitoFormulario').onsubmit = evt => {
      evt.preventDefault();
      const prep = Number(byId('avnCircuitoPreparoSeg').value);
      const work = Number(byId('avnCircuitoExercicioSeg').value);
      const rest = Number(byId('avnCircuitoDescansoSeg').value);
      const voz = byId('avnCircuitoVoz').checked;
      if (!Number.isInteger(prep) || prep < 0 || prep > 3600) return erro('Informe um preparo entre 0 e 3.600 segundos.');
      if (!Number.isInteger(work) || work < 1 || work > 3600) return erro('Informe um tempo de exercício entre 1 e 3.600 segundos.');
      if (!Number.isInteger(rest) || rest < 0 || rest > 3600) return erro('Informe um descanso entre 0 e 3.600 segundos.');
      try {
        localStorage.setItem(CHAVE_PREPARO, String(prep));
        localStorage.setItem(CHAVE_VOZ, String(voz));
      } catch (_) { /* Preferências opcionais. */ }
      iniciar(exercises, work, rest, prep, voz);
    };
    if (!modal.open) modal.showModal();
  }

  function iniciarAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audio || audio.state === 'closed') {
        audio = new AudioContextClass();
        // Amplifica os sinos e limita picos para reduzir distorção.
        audioOutput = audio.createGain();
        audioOutput.gain.value = 2.8;
        const limiter = audio.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 16;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        audioOutput.connect(limiter);
        limiter.connect(audio.destination);
      }
      audio.resume().catch(() => {});
    } catch (_) {
      audio = null;
      audioOutput = null;
    }
  }

  // Sino metálico original: três golpes na entrada de cada exercício.
  function tocarSino(batidas) {
    if (!audio || !audioOutput || audio.state === 'closed') return;
    try {
      const origin = audio.currentTime + 0.015;
      for (let strike = 0; strike < batidas; strike++) {
        const at = origin + strike * 0.38;
        [[585,0.17],[874,0.12],[1172,0.10],[1648,0.055]].forEach(([freq, gain]) => {
          const oscillator = audio.createOscillator();
          const envelope = audio.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(freq, at);
          oscillator.frequency.exponentialRampToValueAtTime(freq * 0.995, at + 0.72);
          envelope.gain.setValueAtTime(0.0001, at);
          envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
          envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.94);
          oscillator.connect(envelope);
          envelope.connect(audioOutput);
          oscillator.start(at);
          oscillator.stop(at + 0.96);
          oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
        });
      }
    } catch (_) { /* O cronômetro continua mesmo sem áudio. */ }
  }

  async function manterTelaAcordada() {
    try {
      if (!wakeLock && session && !session.paused && document.visibilityState === 'visible' && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { /* Recurso opcional, depende do navegador. */ }
  }

  function soltarTela() {
    if (wakeLock) {
      const old = wakeLock;
      wakeLock = null;
      old.release().catch(() => {});
    }
  }

  function iniciar(exercises, work, rest, prep, voz) {
    if (session) return;
    iniciarAudio(); // Gesto de clique libera o som no navegador.
    session = { exercises, work, rest, prep, voice: voz, index: 0, phase: prep > 0 ? 'prepare' : 'exercise',
      endsAt: Date.now() + (prep > 0 ? prep : work) * 1000, paused: false, remainingMs: 0, editing: false };
    obterDialog().classList.add('avn-circuito-executando');
    if (prep === 0) tocarSino(3);
    desenhar();
    interval = window.setInterval(atualizar, 150);
    manterTelaAcordada();
    if (prep > 0) anunciarExercicio(session, 0, 'prepare', true);
  }


  function segundosExercicio(s) {
    const value = Number(s.exercises[s.index]?.workSec);
    return Number.isInteger(value) && value >= 1 && value <= 3600 ? value : s.work;
  }

  function navegarExercicio(direcao) {
    const s = session;
    if (!s || s.editing || ![-1, 1].includes(direcao)) return;
    cancelarFala();
    const index = s.phase === 'rest' ? (direcao === -1 ? s.index : s.index + 1) : s.index + direcao;
    if (index < 0 || index >= s.exercises.length) return;
    s.index = index;
    s.phase = s.prep > 0 ? 'prepare' : 'exercise';
    s.remainingMs = (s.phase === 'prepare' ? s.prep : segundosExercicio(s)) * 1000;
    s.endsAt = Date.now() + s.remainingMs;
    if (!s.paused && s.phase === 'exercise') tocarSino(3);
    desenhar();
    if (!s.paused && s.phase === 'prepare') anunciarExercicio(s, index, 'prepare');
  }

  function abrirEdicao() {
    if (!session || !session.paused) return;
    cancelarFala();
    session.editing = true;
    desenhar();
  }

  function desenharEdicao(modal) {
    const s = session;
    if (!s || !s.paused || !s.editing) return;
    const index = s.phase === 'rest' ? Math.min(s.index + 1, s.exercises.length - 1) : s.index;
    const ex = s.exercises[index];
    const tempo = Number(ex.workSec);
    const dur = Number.isInteger(tempo) && tempo >= 1 && tempo <= 3600 ? tempo : s.work;
    const overlay = document.createElement('div');
    overlay.className = 'avn-circuito-editor-overlay';
    overlay.innerHTML = '<form id="avnCircuitoEditor" class="avn-circuito-editor">' +
      '<h3>Editar treino pausado</h3><p>Alterações nesta execução; o plano salvo não será modificado.</p>' +
      '<label>Nome do ' + (s.phase === 'rest' ? 'próximo' : 'atual') + ' exercício<input type="text" id="avnEditarNome" maxlength="160" required value="' + escapeHtml(ex.name) + '"></label>' +
      '<label>Tempo deste exercício (segundos)<input type="number" id="avnEditarExercicio" min="1" max="3600" step="1" required value="' + dur + '"></label>' +
      '<label>Descanso entre exercícios (segundos)<input type="number" id="avnEditarDescanso" min="0" max="3600" step="1" required value="' + s.rest + '"></label>' +
      '<label>Preparo antes de cada exercício (segundos)<input type="number" id="avnEditarPreparo" min="0" max="3600" step="1" required value="' + s.prep + '"></label>' +
      '<label>Tempo restante da etapa pausada (segundos)<input type="number" id="avnEditarRestante" min="0" max="3600" step="1" required value="' + Math.ceil(s.remainingMs / 1000) + '"></label>' +
      '<div id="avnEditorErro" class="avn-circuito-erro" role="alert"></div>' +
      '<div class="avn-circuito-editor-acoes"><button type="button" id="avnEditorCancelar">Cancelar</button><button type="submit">Salvar ajustes</button></div></form>';
    modal.append(overlay);
    overlay.querySelector('#avnEditorCancelar').onclick = () => { s.editing = false; desenhar(); };
    overlay.querySelector('form').onsubmit = event => {
      event.preventDefault();
      if (session !== s || !s.paused) return;
      const nome = byId('avnEditarNome').value.trim();
      const work = Number(byId('avnEditarExercicio').value);
      const rest = Number(byId('avnEditarDescanso').value);
      const prep = Number(byId('avnEditarPreparo').value);
      const rem = Number(byId('avnEditarRestante').value);
      const valid = (v, min) => Number.isInteger(v) && v >= min && v <= 3600;
      if (!nome || nome.length > 160 || !valid(work, 1) || !valid(rest, 0) || !valid(prep, 0) || !valid(rem, 0)) {
        byId('avnEditorErro').textContent = 'Verifique nome e tempos (0–3600 segundos; exercício mínimo de 1 segundo).';
        return;
      }
      ex.name = nome;
      ex.workSec = work;
      s.rest = rest;
      s.prep = prep;
      s.remainingMs = rem * 1000;
      s.endsAt = Date.now() + s.remainingMs;
      if (s.phase === 'prepare' && prep === 0) {
        s.phase = 'exercise';
        s.remainingMs = segundosExercicio(s) * 1000;
        s.endsAt = Date.now() + s.remainingMs;
      }
      try { localStorage.setItem(CHAVE_PREPARO, String(prep)); } catch (_) {}
      s.editing = false;
      desenhar();
    };
    overlay.querySelector('#avnEditarNome').focus();
  }

  function enderecoImagem(raw) {
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.origin);
      if (url.protocol !== 'https:' && url.origin !== window.location.origin) return '';
      return url.href;
    } catch (_) { return ''; }
  }

  function foto(ex) {
    const src = enderecoImagem(ex.mediaUrl);
    if (!src) return '<div class="avn-circuito-sem-foto">Imagem não cadastrada</div>';
    if (ex.mediaType === 'video') {
      return '<video class="avn-circuito-foto" src="' + escapeHtml(src) + '" autoplay muted loop playsinline></video>';
    }
    // O catálogo Workout Guide usa imagens claras/translúcidas. Repete o filtro
    // de silhueta preta do treino tradicional e a animação frame-1/2/3.
    const catalogo = /^\/avn\/sistema\/midias\/[a-z0-9-]+\/frame-1\.(?:png|svg)$/.test(ex.mediaUrl);
    const svgAnimado = catalogo && ex.mediaUrl.endsWith('.svg');
    const classes = 'avn-circuito-foto' + (catalogo ? ' avn-circuito-ilustracao' : '') + (svgAnimado ? ' avn-animated' : '');
    const base = catalogo ? ' data-base="' + escapeHtml(ex.mediaUrl) + '"' : '';
    return '<img class="' + classes + '" src="' + escapeHtml(src) + '"' + base +
      ' alt="' + escapeHtml(ex.name) + '" loading="eager" decoding="async">';
  }

  function desenhar() {
    if (!session) return;
    const s = session, modal = obterDialog();
    const podeVoltar = s.phase === 'rest' || s.index > 0;
    const podeAvancar = s.index < s.exercises.length - 1;
    const controls = '<div class="avn-circuito-acoes">' +
      '<button type="button" id="avnCircuitoAnterior" aria-label="Exercício anterior"' + (podeVoltar ? '' : ' disabled') + '>← Anterior</button>' +
      '<button type="button" id="avnCircuitoSeguinte" aria-label="Próximo exercício"' + (podeAvancar ? '' : ' disabled') + '>Próximo →</button>' +
      '<button type="button" id="avnCircuitoPausar">' + (s.paused ? '▶ Continuar' : 'Ⅱ Pausar') + '</button>' +
      (s.paused ? '<button type="button" id="avnCircuitoEditar">✏️ Editar treino</button>' : '') +
      '<button type="button" id="avnCircuitoSair">Encerrar ×</button></div>';
    if (s.phase === 'prepare') {
      const first = s.exercises[s.index];
      modal.innerHTML = '<section class="avn-circuito-painel avn-circuito-em-preparo">' +
        '<div class="avn-circuito-barra"><span>PREPARAÇÃO · EXERCÍCIO ' + (s.index + 1) + ' DE ' + s.exercises.length + '</span>' + controls + '</div>' +
        '<h2>' + escapeHtml(first.name) + '</h2>' +
        '<div class="avn-circuito-area-foto">' + foto(first) + '</div>' +
        '<div class="avn-circuito-tempo" id="avnCircuitoRelogio" role="timer">00:00</div>' +
        '<span class="avn-circuito-pausado" id="avnCircuitoEstado">' + (s.paused ? 'PAUSADO' : 'PREPARE-SE') + '</span>' +
        '</section>';
    } else if (s.phase === 'exercise') {
      const ex = s.exercises[s.index];
      modal.innerHTML = '<section class="avn-circuito-painel">' +
        '<div class="avn-circuito-barra"><span>EXERCÍCIO ' + (s.index + 1) + ' DE ' + s.exercises.length + '</span>' + controls + '</div>' +
        '<h2>' + escapeHtml(ex.name) + '</h2>' +
        '<div class="avn-circuito-area-foto">' + foto(ex) + '</div>' +
        '<div class="avn-circuito-tempo" id="avnCircuitoRelogio" role="timer">00:00</div>' +
        '<span class="avn-circuito-pausado" id="avnCircuitoEstado">' + (s.paused ? 'PAUSADO' : '') + '</span>' +
        '</section>';
    } else {
      const seguinte = s.exercises[s.index + 1];
      modal.innerHTML = '<section class="avn-circuito-painel avn-circuito-em-descanso">' +
        '<div class="avn-circuito-barra"><span>DESCANSO · ' + (s.index + 1) + ' DE ' + s.exercises.length + '</span>' + controls + '</div>' +
        '<div class="avn-circuito-descanso-corpo"><h2>DESCANSO</h2><div class="avn-circuito-tempo" id="avnCircuitoRelogio" role="timer">00:00</div>' +
        '<div class="avn-circuito-proximo"><span>PRÓXIMO EXERCÍCIO</span><strong>' + escapeHtml(seguinte?.name || 'Fim do circuito') + '</strong></div>' +
        '<span class="avn-circuito-pausado" id="avnCircuitoEstado">' + (s.paused ? 'PAUSADO' : '') + '</span></div></section>';
    }
    const imagem = modal.querySelector('img.avn-circuito-foto');
    if (imagem) imagem.onerror = () => {
      imagem.onerror = null;
      const aviso = document.createElement('div');
      aviso.className = 'avn-circuito-sem-foto';
      aviso.textContent = 'Imagem indisponível';
      imagem.replaceWith(aviso);
    };
    byId('avnCircuitoAnterior').onclick = () => navegarExercicio(-1);
    byId('avnCircuitoSeguinte').onclick = () => navegarExercicio(1);
    byId('avnCircuitoPausar').onclick = pausarOuContinuar;
    if (s.paused) byId('avnCircuitoEditar').onclick = abrirEdicao;
    if (s.editing) desenharEdicao(modal);
    byId('avnCircuitoSair').onclick = fechar;
    atualizarRelogio();
  }

  function atualizarRelogio() {
    if (!session) return;
    const ms = session.paused ? session.remainingMs : Math.max(0, session.endsAt - Date.now());
    const element = byId('avnCircuitoRelogio');
    if (element) element.textContent = fmt(ms / 1000);
  }

  function atualizar() {
    const s = session;
    if (!s || s.paused) return;
    const now = Date.now();
    let advanced = false;
    let safety = s.exercises.length * 3 + 3;
    while (session && !s.paused && now >= s.endsAt && safety-- > 0) {
      if (s.phase === 'prepare') {
        cancelarFala();
        s.phase = 'exercise';
        s.endsAt += segundosExercicio(s) * 1000;
        if (now < s.endsAt && document.visibilityState === 'visible') tocarSino(3);
      } else if (s.phase === 'exercise' && s.rest > 0 && s.index < s.exercises.length - 1) {
        s.phase = 'rest';
        s.endsAt += s.rest * 1000;
        if (now < s.endsAt && document.visibilityState === 'visible') {
          tocarSino(2);
          anunciarExercicio(s, s.index + 1, 'rest');
        }
      } else {
        s.index++;
        if (s.index >= s.exercises.length) {
          concluir();
          return;
        }
        cancelarFala();
        s.phase = s.prep > 0 ? 'prepare' : 'exercise';
        s.endsAt += (s.phase === 'prepare' ? s.prep : segundosExercicio(s)) * 1000;
        if (now < s.endsAt && document.visibilityState === 'visible') {
          if (s.phase === 'exercise') tocarSino(3);
          else if (s.rest === 0) anunciarExercicio(s, s.index, 'prepare');
        }
      }
      advanced = true;
    }
    if (advanced) desenhar();
    else atualizarRelogio();
  }

  function pausarOuContinuar() {
    const s = session;
    if (!s || s.editing) return;
    if (s.paused) {
      s.endsAt = Date.now() + s.remainingMs;
      s.paused = false;
      manterTelaAcordada();
      if (s.phase === 'rest') anunciarExercicio(s, s.index + 1, 'rest');
    } else {
      cancelarFala();
      s.remainingMs = Math.max(0, s.endsAt - Date.now());
      s.paused = true;
      soltarTela();
    }
    desenhar();
  }

  function concluir() {
    if (!session) return;
    cancelarFala();
    const total = session.exercises.length;
    clearInterval(interval); interval = null;
    soltarTela();
    session = null;
    tocarSino(3);
    obterDialog().innerHTML = '<section class="avn-circuito-concluido"><h2>Circuito concluído</h2>' +
      '<p>' + total + ' exercícios concluídos.</p><button type="button" id="avnCircuitoConcluir">Fechar</button></section>';
    byId('avnCircuitoConcluir').onclick = fechar;
  }

  function fechar() {
    if (session && !window.confirm('Encerrar o circuito antes de completar todos os exercícios?')) return;
    cancelarFala();
    clearInterval(interval); interval = null;
    session = null;
    soltarTela();
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
    audio = null; audioOutput = null;
    const modal = obterDialog();
    if (modal.open) modal.close();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      atualizar();
      manterTelaAcordada();
    } else {
      cancelarFala();
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalarBotao, {once: true});
  } else instalarBotao();
  new MutationObserver(instalarBotao).observe(document.documentElement, {subtree:true, childList:true});
})();
