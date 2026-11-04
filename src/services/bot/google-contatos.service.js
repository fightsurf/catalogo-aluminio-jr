'use strict';
// Google People API: acesso somente-leitura com OAuth independente do ChatGPT.
// Nenhuma consulta ou sincronizacao acontece quando a autonomia do bot esta OFF.
const crypto = require('crypto');
const pool = require('../../../db/connection');
const autonomia = require('./botAutonomia.services');
const clientes = require('../legado/clientes/clientes.service');

const REDIRECT_URI = process.env.GOOGLE_CONTACTS_REDIRECT_URI ||
  'https://catalogo-aluminio-jr.onrender.com/bot/admin/google-contatos/callback';
const ESCOPO = 'https://www.googleapis.com/auth/contacts.readonly';
const INTERVALO_MS = 60 * 60 * 1000;
const VALIDADE_MS = 24 * 60 * 60 * 1000;
let preparoPendente;
let syncPendente;
let agendadorIniciado = false;

function configurado() {
  return Boolean(process.env.GOOGLE_CONTACTS_CLIENT_ID &&
    process.env.GOOGLE_CONTACTS_CLIENT_SECRET &&
    (process.env.GOOGLE_CONTACTS_ENCRYPTION_KEY || process.env.ADMIN_SESSION_SECRET));
}

function chaveDeCriptografia() {
  const segredo = process.env.GOOGLE_CONTACTS_ENCRYPTION_KEY || process.env.ADMIN_SESSION_SECRET || '';
  if (segredo.length < 32) throw new Error('Chave de criptografia do Google Contatos nao configurada ou muito curta.');
  return crypto.createHash('sha256').update('aluminio-jr/google-contatos/v1:').update(segredo).digest();
}

function criptografar(valor) {
  const nonce = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', chaveDeCriptografia(), nonce);
  const dados = Buffer.concat([cifra.update(valor, 'utf8'), cifra.final()]);
  return [nonce, cifra.getAuthTag(), dados].map(b => b.toString('base64url')).join('.');
}

function descriptografar(valor) {
  const partes = String(valor || '').split('.');
  if (partes.length !== 3) throw new Error('Credencial Google invalida, reconecte a conta.');
  const decifra = crypto.createDecipheriv('aes-256-gcm', chaveDeCriptografia(),
    Buffer.from(partes[0], 'base64url'));
  decifra.setAuthTag(Buffer.from(partes[1], 'base64url'));
  return Buffer.concat([decifra.update(Buffer.from(partes[2], 'base64url')), decifra.final()]).toString('utf8');
}

function normalizarTelefone(valor) {
  const texto = String(valor || '').trim();
  const digitos = texto.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(texto) || !/^\d{10,15}$/.test(digitos)) return '';
  // Numero brasileiro sem DDI; nao inventar digitos (ex.: nono digito).
  if (digitos.length === 10 || digitos.length === 11) {
    return '55' + digitos;
  }
  return digitos;
}

function numerosEquivalentes(a, b) {
  const n1 = normalizarTelefone(a);
  const n2 = normalizarTelefone(b);
  return Boolean(n1 && n2 && n1 === n2);
}

async function preparar() {
  if (!preparoPendente) {
    preparoPendente = (async () => {
      await pool.query('CREATE TABLE IF NOT EXISTS bot_google_contatos_conexao (' +
        'id SMALLINT PRIMARY KEY CHECK (id = 1), refresh_token TEXT NOT NULL, ' +
        'sincronizado_em TIMESTAMPTZ, quantidade INTEGER NOT NULL DEFAULT 0, ' +
        'ultimo_erro TEXT, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      await pool.query('CREATE TABLE IF NOT EXISTS bot_google_contatos (' +
        'telefone TEXT PRIMARY KEY, nome TEXT, recurso TEXT, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    })().catch(erro => { preparoPendente = null; throw erro; });
  }
  return preparoPendente;
}

async function botLigado() {
  try { return await autonomia.getAutonomiaAtiva(); }
  catch (_) { return false; }
}

function exigirConfig() {
  if (!configurado()) {
    const erro = new Error('Configure GOOGLE_CONTACTS_CLIENT_ID, GOOGLE_CONTACTS_CLIENT_SECRET e chave de criptografia no Render.');
    erro.status = 503;
    throw erro;
  }
  chaveDeCriptografia();
}

async function exigirBot() {
  if (!(await botLigado())) {
    const erro = new Error('Ligue o bot em /bot/admin para acessar o Google Contatos.');
    erro.status = 409;
    throw erro;
  }
}

function urlAutorizacao(state) {
  exigirConfig();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CONTACTS_CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ESCOPO);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

async function solicitarToken(parametros) {
  const resposta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({
      client_id: process.env.GOOGLE_CONTACTS_CLIENT_ID,
      client_secret: process.env.GOOGLE_CONTACTS_CLIENT_SECRET
    }, parametros)),
    signal: AbortSignal.timeout(15000)
  });
  if (!resposta.ok) throw new Error('Google OAuth recusou as credenciais (HTTP ' + resposta.status + ').');
  const json = await resposta.json();
  if (!json.access_token) throw new Error('Google OAuth nao retornou token de acesso.');
  return json;
}

async function conectarCodigo(codigo) {
  await exigirBot();
  exigirConfig();
  await preparar();
  const token = await solicitarToken({
    code: codigo, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code'
  });
  if (!token.refresh_token) throw new Error('Google nao retornou autorizacao offline. Revogue e autorize novamente.');
  await exigirBot();
  await pool.query(
    'INSERT INTO bot_google_contatos_conexao (id, refresh_token, sincronizado_em, quantidade, ultimo_erro) ' +
    'VALUES (1, $1, NULL, 0, NULL) ON CONFLICT (id) DO UPDATE SET ' +
    'refresh_token=EXCLUDED.refresh_token, sincronizado_em=NULL, quantidade=0, ultimo_erro=NULL, atualizado_em=NOW()',
    [criptografar(token.refresh_token)]
  );
  // Nao reutilizar numeros de uma conta antiga enquanto a nova conta sincroniza.
  await pool.query('DELETE FROM bot_google_contatos');
}

async function status() {
  await preparar();
  const resultado = await pool.query(
    'SELECT sincronizado_em, quantidade, ultimo_erro FROM bot_google_contatos_conexao WHERE id=1'
  );
  const dados = resultado.rows[0];
  const ligado = await botLigado();
  return {
    bot_ligado: ligado,
    configurado: configurado(),
    conectado: Boolean(dados),
    sincronizado_em: dados?.sincronizado_em || null,
    quantidade: dados?.quantidade || 0,
    ultimo_erro: dados?.ultimo_erro || null,
    apto: Boolean(ligado && configurado() && dados?.sincronizado_em &&
      new Date(dados.sincronizado_em).getTime() > Date.now() - VALIDADE_MS && dados.quantidade > 0),
    redirect_uri: REDIRECT_URI
  };
}

async function sincronizar() {
  if (syncPendente) return syncPendente;
  syncPendente = (async () => {
    await exigirBot();
    exigirConfig();
    await preparar();
    const resultado = await pool.query('SELECT refresh_token FROM bot_google_contatos_conexao WHERE id=1');
    if (!resultado.rows.length) throw new Error('Conecte sua conta Google primeiro.');
    const refresh = descriptografar(resultado.rows[0].refresh_token);
    const token = await solicitarToken({ refresh_token: refresh, grant_type: 'refresh_token' });
    const contatos = new Map();
    let pageToken = '';
    let paginas = 0;
    do {
      await exigirBot();
      const url = new URL('https://people.googleapis.com/v1/people/me/connections');
      url.searchParams.set('personFields', 'names,phoneNumbers');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const resposta = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token.access_token },
        signal: AbortSignal.timeout(15000)
      });
      if (!resposta.ok) throw new Error('Google People API falhou (HTTP ' + resposta.status + ').');
      const dados = await resposta.json();
      for (const pessoa of (dados.connections || [])) {
        const nome = String(pessoa.names?.[0]?.displayName || '').slice(0, 250);
        for (const numero of (pessoa.phoneNumbers || [])) {
          const telefone = normalizarTelefone(numero.canonicalForm || numero.value);
          if (telefone && !contatos.has(telefone)) {
            contatos.set(telefone, { nome, recurso: String(pessoa.resourceName || '').slice(0, 150) });
          }
        }
      }
      pageToken = dados.nextPageToken || '';
      if (++paginas > 500) throw new Error('Limite de paginas Google excedido.');
    } while (pageToken);
    await exigirBot();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Bloqueia troca de estado OFF no banco durante a gravacao do snapshot.
      const estado = await client.query("SELECT valor FROM bot_config WHERE chave='autonomia_ativa' FOR SHARE");
      if (String(estado.rows[0]?.valor).toLowerCase() !== 'true') {
        throw new Error('Bot desligado durante a sincronizacao.');
      }
      await client.query('DELETE FROM bot_google_contatos');
      const entradas = Array.from(contatos);
      for (let i = 0; i < entradas.length; i += 250) {
        const lote = entradas.slice(i, i + 250);
        const params = [];
        const colunas = [];
        lote.forEach(([numero, contato], j) => {
          colunas.push('($' + (j * 3 + 1) + ',$' + (j * 3 + 2) + ',$' + (j * 3 + 3) + ')');
          params.push(numero, contato.nome, contato.recurso);
        });
        await client.query('INSERT INTO bot_google_contatos (telefone,nome,recurso) VALUES ' +
          colunas.join(','), params);
      }
      await client.query('UPDATE bot_google_contatos_conexao SET ' +
        'sincronizado_em=NOW(), quantidade=$1, ultimo_erro=NULL, atualizado_em=NOW() WHERE id=1', [entradas.length]);
      await client.query('COMMIT');
      return { quantidade: entradas.length };
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally { client.release(); }
  })();
  try { return await syncPendente; }
  catch (erro) {
    console.warn('[Google Contatos JR] Sincronizacao: ' + erro.message);
    if (await botLigado()) {
      await pool.query('UPDATE bot_google_contatos_conexao SET ultimo_erro=$1 WHERE id=1',
        [String(erro.message).slice(0, 250)]).catch(() => {});
    }
    throw erro;
  } finally { syncPendente = null; }
}

async function desconectar() {
  await preparar();
  const resultado = await pool.query('SELECT refresh_token FROM bot_google_contatos_conexao WHERE id=1');
  // Revogar a autorizacao tambem pode ser solicitado com o bot desligado.
  if (resultado.rows[0] && configurado()) {
    try {
      const token = descriptografar(resultado.rows[0].refresh_token);
      await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(10000)
      });
    } catch (erro) { console.warn('[Google Contatos JR] Revogacao remota:', erro.message); }
  }
  await pool.query('DELETE FROM bot_google_contatos_conexao');
  await pool.query('DELETE FROM bot_google_contatos');
}

function jaConhecidoGoogle(telefone) {
  return pool.query('SELECT 1 FROM bot_google_contatos WHERE telefone=$1 LIMIT 1',
    [normalizarTelefone(telefone)]).then(r => r.rowCount > 0);
}

function camposTelefone(cliente) {
  return [cliente.telefonePrincipal, cliente.telefone_principal, cliente.telefone,
    cliente.fone1, cliente.fone2, cliente.celular, cliente.whatsapp];
}

async function existeNoLegado(telefone) {
  const numero = normalizarTelefone(telefone);
  if (!numero) return true;
  const variantes = numero.startsWith('55') ? [numero.slice(2), numero] : [numero];
  for (const busca of variantes) {
    const resultado = await Promise.race([
      clientes.listarClientes({ telefone: busca, limite: 10, status: 'todos' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de consulta ao legado')), 2500))
    ]);
    if (!Array.isArray(resultado)) throw new Error('Busca no legado nao retornou lista.');
    if (resultado.some(c => camposTelefone(c).some(t => numerosEquivalentes(t, numero)))) return true;
  }
  return false;
}

// Fail-closed: se Google/desconectado/desatualizado ou legado indisponivel,
// nunca chamar saudacao automatica por engano.
async function autorizarPrimeiroContato(telefone) {
  if (!(await botLigado())) return false;
  const tel = normalizarTelefone(telefone);
  if (!tel) return false;
  try {
    const situacao = await status();
    if (!situacao.apto) return false;
    if (await jaConhecidoGoogle(tel)) return false;
    if (await existeNoLegado(tel)) return false;
    return await botLigado();
  } catch (erro) {
    console.warn('[Google Contatos JR] Sem saudacao por falha de identificacao:', erro.message);
    return false;
  }
}

function iniciarSincronizador() {
  if (agendadorIniciado) return;
  agendadorIniciado = true;
  async function executar() {
    if (!(await botLigado())) return;
    try {
      const estado = await status();
      if (estado.conectado && estado.configurado &&
          (!estado.sincronizado_em || Date.now() - new Date(estado.sincronizado_em).getTime() > INTERVALO_MS)) {
        await sincronizar();
      }
    } catch (erro) { console.warn('[Google Contatos JR] Agendador:', erro.message); }
  }
  const inicial = setTimeout(executar, 30000);
  inicial.unref?.();
  const repetidor = setInterval(executar, 15 * 60 * 1000);
  repetidor.unref?.();
}

module.exports = {
  configurado, normalizarTelefone, preparar, exigirBot, urlAutorizacao,
  conectarCodigo, status, sincronizar, desconectar,
  autorizarPrimeiroContato, iniciarSincronizador
};
