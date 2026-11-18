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
      '<label>Tempo de preparo (segundos)<input id="avnCircuitoPreparoSeg" name="preparo" type="number" min="0" max="3600" step="1" value="' + preparoAnterior() + '" required inputmode="numeric"></label>' +
      '<label>Tempo de exercício (segundos)<input id="avnCircuitoExercicioSeg" name="exercicio" type="number" min="1" max="3600" step="1" value="60" required inputmode="numeric"></label>' +
      '<label>Tempo de descanso (segundos)<input id="avnCircuitoDescansoSeg" name="descanso" type="number" min="0" max="3600" step="1" value="15" required inputmode="numeric"></label>' +
      '<p class="avn-circuito-nota">O circuito seguirá os ' + exercises.length + ' exercícios uma vez, na ordem do plano. Sem descanso após o último.</p>' +
      '<div id="avnCircuitoErro" class="avn-circuito-erro" role="alert"></div>' +
      '<button class="avn-circuito-iniciar" type="submit">▶ Iniciar circuito</button></form></div>';
    byId('avnCircuitoFechar').onclick = fechar;
    byId('avnCircuitoFormulario').onsubmit = evt => {
      evt.preventDefault();
      const prep = Number(byId('avnCircuitoPreparoSeg').value);
      const work = Number(byId('avnCircuitoExercicioSeg').value);
      const rest = Number(byId('avnCircuitoDescansoSeg').value);
      if (!Number.isInteger(prep) || prep < 0 || prep > 3600) return erro('Informe um preparo entre 0 e 3.600 segundos.');
      if (!Number.isInteger(work) || work < 1 || work > 3600) return erro('Informe um tempo de exercício entre 1 e 3.600 segundos.');
      if (!Number.isInteger(rest) || rest < 0 || rest > 3600) return erro('Informe um descanso entre 0 e 3.600 segundos.');
      try { localStorage.setItem(CHAVE_PREPARO, String(prep)); } catch (_) { /* Preferência opcional. */ }
      iniciar(exercises, work, rest, prep);
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

  function iniciar(exercises, work, rest, prep) {
    if (session) return;
    iniciarAudio(); // Gesto de clique libera o som no navegador.
    session = { exercises, work, rest, prep, index: 0, phase: prep > 0 ? 'prepare' : 'exercise',
      endsAt: Date.now() + (prep > 0 ? prep : work) * 1000, paused: false, remainingMs: 0 };
    obterDialog().classList.add('avn-circuito-executando');
    if (prep === 0) tocarSino(3);
    desenhar();
    interval = window.setInterval(atualizar, 150);
    manterTelaAcordada();
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
    const controls = '<div class="avn-circuito-acoes"><button type="button" id="avnCircuitoPausar">' +
      (s.paused ? '▶ Continuar' : 'Ⅱ Pausar') +
      '</button><button type="button" id="avnCircuitoSair">Encerrar ×</button></div>';
    if (s.phase === 'prepare') {
      const first = s.exercises[0];
      modal.innerHTML = '<section class="avn-circuito-painel avn-circuito-em-preparo">' +
        '<div class="avn-circuito-barra"><span>PREPARAÇÃO · O TREINO COMEÇA EM</span>' + controls + '</div>' +
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
    byId('avnCircuitoPausar').onclick = pausarOuContinuar;
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
    let safety = s.exercises.length * 2 + 2;
    while (session && !s.paused && now >= s.endsAt && safety-- > 0) {
      if (s.phase === 'prepare') {
        s.phase = 'exercise';
        s.endsAt += s.work * 1000;
        if (now < s.endsAt && document.visibilityState === 'visible') tocarSino(3);
      } else if (s.phase === 'exercise' && s.rest > 0 && s.index < s.exercises.length - 1) {
        s.phase = 'rest';
        s.endsAt += s.rest * 1000;
        if (now < s.endsAt && document.visibilityState === 'visible') tocarSino(2);
      } else {
        s.index++;
        if (s.index >= s.exercises.length) {
          concluir();
          return;
        }
        s.phase = 'exercise';
        s.endsAt += s.work * 1000;
        if (now < s.endsAt && document.visibilityState === 'visible') tocarSino(3);
      }
      advanced = true;
    }
    if (advanced) desenhar();
    else atualizarRelogio();
  }

  function pausarOuContinuar() {
    const s = session;
    if (!s) return;
    if (s.paused) {
      s.endsAt = Date.now() + s.remainingMs;
      s.paused = false;
      manterTelaAcordada();
    } else {
      s.remainingMs = Math.max(0, s.endsAt - Date.now());
      s.paused = true;
      soltarTela();
    }
    desenhar();
  }

  function concluir() {
    if (!session) return;
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
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalarBotao, {once: true});
  } else instalarBotao();
  new MutationObserver(instalarBotao).observe(document.documentElement, {subtree:true, childList:true});
})();
