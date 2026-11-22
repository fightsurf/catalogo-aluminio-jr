(() => {
  'use strict';
  const base = '/bot/admin/google-contatos';
  const estado = document.getElementById('google-contatos-status');
  const detalhe = document.getElementById('google-contatos-detalhe');
  const conectar = document.getElementById('google-contatos-conectar');
  const sync = document.getElementById('google-contatos-sync');
  const desconectar = document.getElementById('google-contatos-desconectar');
  const aviso = document.getElementById('google-contatos-feedback');

  async function requisitar(path, options) {
    const res = await fetch(base + path, { credentials: 'same-origin',
      headers: { Accept: 'application/json' }, ...options });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || 'Erro HTTP ' + res.status);
    return json;
  }

  async function atualizar() {
    try {
      const dados = await requisitar('/status');
      const modo = dados.bot_ligado ? 'Bot ON' : 'Bot OFF';
      const conexao = dados.conectado ? 'conectado' : 'não conectado';
      estado.textContent = 'Google Contatos: ' + conexao + ' · ' + modo;
      let info = 'Contatos preservados no histórico local: ' + (dados.historico_quantidade || 0) + '.';
      if (dados.sincronizado_em) {
        info += ' Última cópia do Google: ' + new Date(dados.sincronizado_em).toLocaleString('pt-BR') + '.';
      }
      if (!dados.apto) {
        info += dados.bot_ligado
          ? ' Saudações bloqueadas até existir uma cópia local de contatos.'
          : ' Bot desligado: saudações automáticas desativadas.';
      }
      if (!dados.configurado) info += ' Configure a API Google no Render para fazer novas importações.';
      if (!dados.conectado) info += ' O histórico local continua disponível sem conexão Google.';
      if (dados.ultimo_erro) info += ' Erro da última importação: ' + dados.ultimo_erro;
      detalhe.textContent = info;
      conectar.disabled = !dados.bot_ligado || !dados.configurado;
      sync.disabled = !dados.bot_ligado || !dados.configurado || !dados.conectado;
      desconectar.disabled = !dados.conectado;
    } catch (e) {
      estado.textContent = 'Google Contatos: indisponível';
      detalhe.textContent = e.message;
      conectar.disabled = true;
      sync.disabled = true;
      desconectar.disabled = true;
    }
  }

  conectar.addEventListener('click', () => { location.assign(base + '/conectar'); });
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    aviso.textContent = 'Copiando contatos para o histórico local...';
    try {
      const dados = await requisitar('/sincronizar', { method: 'POST' });
      aviso.textContent = 'Copiados nesta importação: ' + dados.quantidade +
        '. Total preservado no histórico: ' + dados.historico_quantidade + '.';
    } catch (e) { aviso.textContent = e.message; }
    await atualizar();
  });
  desconectar.addEventListener('click', async () => {
    if (!confirm('Desconectar a conta Google? Os contatos copiados continuarão no histórico da JR.')) return;
    desconectar.disabled = true;
    try {
      await requisitar('/desconectar', { method: 'POST' });
      aviso.textContent = 'Google desconectado. Histórico de contatos preservado.';
    } catch (e) { aviso.textContent = e.message; }
    await atualizar();
  });

  const retorno = new URLSearchParams(location.search).get('google_contatos');
  if (retorno === 'conectado') aviso.textContent = 'Google autorizado. Confira o total de contatos copiados abaixo.';
  if (retorno === 'erro') aviso.textContent = 'Falha na autorização. Verifique a configuração OAuth e tente novamente.';
  atualizar();
  document.getElementById('btn-autonomia')?.addEventListener('click', () => setTimeout(atualizar, 900));
  setInterval(atualizar, 60000);
})();
