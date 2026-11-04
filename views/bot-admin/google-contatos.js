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
      let info = '';
      if (!dados.configurado) {
        info = 'Configure a API do Google no Render para habilitar a conexão.';
      } else if (!dados.bot_ligado) {
        info = 'Sem consultas nem sincronização automáticas com o bot desligado.';
      } else if (dados.conectado) {
        const data = dados.sincronizado_em ? new Date(dados.sincronizado_em).toLocaleString('pt-BR') : 'pendente';
        info = 'Telefones sincronizados: ' + dados.quantidade + '. Última sincronização: ' + data + '.';
        if (!dados.apto) info += ' Saudações automáticas suspensas até sincronização válida.';
      } else {
        info = 'Autorize sua conta para evitar falsos leads e saudações.';
      }
      if (dados.ultimo_erro) info += ' Erro: ' + dados.ultimo_erro;
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
    aviso.textContent = 'Sincronizando contatos...';
    try {
      const dados = await requisitar('/sincronizar', { method: 'POST' });
      aviso.textContent = 'Sincronizados ' + dados.quantidade + ' telefones.';
    } catch (e) { aviso.textContent = e.message; }
    await atualizar();
  });
  desconectar.addEventListener('click', async () => {
    if (!confirm('Desconectar sua conta Google e apagar os contatos sincronizados da JR?')) return;
    desconectar.disabled = true;
    try {
      await requisitar('/desconectar', { method: 'POST' });
      aviso.textContent = 'Google Contatos desconectado.';
    } catch (e) { aviso.textContent = e.message; }
    await atualizar();
  });

  const retorno = new URLSearchParams(location.search).get('google_contatos');
  if (retorno === 'conectado') aviso.textContent = 'Conta autorizada. Confira a sincronização abaixo.';
  if (retorno === 'erro') aviso.textContent = 'Falha na autorização. Verifique a configuração OAuth e tente novamente.';
  atualizar();
  document.getElementById('btn-autonomia')?.addEventListener('click', () => setTimeout(atualizar, 900));
  setInterval(atualizar, 60000);
})();
