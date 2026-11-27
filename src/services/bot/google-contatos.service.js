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
let preparoPendente;
let syncPendente;

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
  // A autorizacao Google e substituida, mas o historico local nunca e apagado.
}

async function status() {
  await preparar();
  const [resultado, historico] = await Promise.all([
    pool.query('SELECT sincronizado_em, quantidade, ultimo_erro FROM bot_google_contatos_conexao WHERE id=1'),
    pool.query('SELECT COUNT(*)::integer AS quantidade FROM bot_google_contatos')
  ]);
  const dados = resultado.rows[0];
  const ligado = await botLigado();
  const totalHistorico = Number(historico.rows[0]?.quantidade || 0);
  return {
    bot_ligado: ligado,
    configurado: configurado(),
    conectado: Boolean(dados),
    sincronizado_em: dados?.sincronizado_em || null,
    quantidade: dados?.quantidade || 0,
    historico_quantidade: totalHistorico,
    ultimo_erro: dados?.ultimo_erro || null,
    // O bot consulta a copia permanente local, sem exigir OAuth ou sincronizacao recente.
    apto: Boolean(ligado && totalHistorico > 0),
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
      // Importacao acumulativa: numeros removidos do Google continuam conhecidos localmente.
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
          colunas.join(',') +
          " ON CONFLICT (telefone) DO UPDATE SET " +
          "nome=COALESCE(NULLIF(EXCLUDED.nome, ''), bot_google_contatos.nome), " +
          "recurso=COALESCE(NULLIF(EXCLUDED.recurso, ''), bot_google_contatos.recurso), " +
          "atualizado_em=NOW()", params);
      }
      await client.query('UPDATE bot_google_contatos_conexao SET ' +
        'sincronizado_em=NOW(), quantidade=$1, ultimo_erro=NULL, atualizado_em=NOW() WHERE id=1', [entradas.length]);
      const total = await client.query('SELECT COUNT(*)::integer AS quantidade FROM bot_google_contatos');
      await client.query('COMMIT');
      return { quantidade: entradas.length, historico_quantidade: Number(total.rows[0]?.quantidade || 0) };
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
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10000)
      });
    } catch (erro) { console.warn('[Google Contatos JR] Revogacao remota:', erro.message); }
  }
  // Desconecta a autorizacao, sem excluir o historico de numeros ja importados.
  await pool.query('DELETE FROM bot_google_contatos_conexao');
}

function telefonesEquivalentes(telefone) {
  const numero = normalizarTelefone(telefone);
  if (!numero) return [];
  // O WhatsApp pode omitir o nono digito de numeros brasileiros.
  if (/^55\d{2}\d{8}$/.test(numero)) {
    return [numero, numero.slice(0, 4) + '9' + numero.slice(4)];
  }
  if (/^55\d{2}9\d{8}$/.test(numero)) {
    return [numero, numero.slice(0, 4) + numero.slice(5)];
  }
  return [numero];
}

function jaConhecidoGoogle(telefone) {
  const telefones = telefonesEquivalentes(telefone);
  if (!telefones.length) return Promise.resolve(true);
  return pool.query('SELECT 1 FROM bot_google_contatos WHERE telefone=ANY($1::text[]) LIMIT 1',
    [telefones]).then(r => r.rowCount > 0);
}

function camposTelefone(cliente) {
  return [cliente.telefonePrincipal, cliente.telefone_principal, cliente.telefone,
    cliente.fone1, cliente.fone2, cliente.celular, cliente.whatsapp];
}

async function existeNoLegado(telefone) {
  const numero = normalizarTelefone(telefone);
  if (!numero) return true;
  const equivalentes = telefonesEquivalentes(numero);
  const variantes = [...new Set(equivalentes.flatMap(n => n.startsWith('55') ? [n.slice(2), n] : [n]))];
  for (const busca of variantes) {
    const resultado = await Promise.race([
      clientes.listarClientes({ telefone: busca, limite: 10, status: 'todos' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout de consulta ao legado')), 2500))
    ]);
    if (!Array.isArray(resultado)) throw new Error('Busca no legado nao retornou lista.');
    if (resultado.some(c => camposTelefone(c).some(t =>
      telefonesEquivalentes(t).some(n => equivalentes.includes(n))))) return true;
  }
  return false;
}

// Fail-closed: so saudar um numero realmente novo apos consultar o historico
// importado no PostgreSQL e o cadastro legado; nunca exigir conexao OAuth ativa.
async function avaliarPrimeiroContato(telefone) {
  const tel = normalizarTelefone(telefone);
  if (!tel) return { estado: 'bloqueado', motivo: 'telefone_invalido' };
  try {
    if (!(await autonomia.getAutonomiaAtiva())) return { estado: 'pausado', motivo: 'bot_desligado' };
    await preparar();
    const historico = await pool.query('SELECT EXISTS (SELECT 1 FROM bot_google_contatos) AS disponivel');
    if (historico.rows[0]?.disponivel !== true) return { estado: 'pendente', motivo: 'historico_indisponivel' };
    if (await jaConhecidoGoogle(tel)) return { estado: 'bloqueado', motivo: 'google_conhecido' };
    if (await existeNoLegado(tel)) return { estado: 'bloqueado', motivo: 'cliente_legado' };
    if (!(await autonomia.getAutonomiaAtiva())) return { estado: 'pausado', motivo: 'bot_desligado' };
    return { estado: 'autorizado', motivo: 'novo' };
  } catch (erro) {
    console.warn('[Google Contatos JR] Sem saudacao por falha de identificacao:', erro.message);
    return { estado: 'pendente', motivo: 'falha_identificacao' };
  }
}

async function autorizarPrimeiroContato(telefone) {
  return (await avaliarPrimeiroContato(telefone)).estado === 'autorizado';
}

function iniciarSincronizador() {
  // Sem sincronizacao automatica: apenas Conectar Google e Sincronizar agora importam contatos.
}

module.exports = {
  configurado, normalizarTelefone, preparar, exigirBot, urlAutorizacao,
  conectarCodigo, status, sincronizar, desconectar,
  autorizarPrimeiroContato, avaliarPrimeiroContato, iniciarSincronizador
};
