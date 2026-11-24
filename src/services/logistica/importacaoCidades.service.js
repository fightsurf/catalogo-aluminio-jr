'use strict';

const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const { chave } = require('./importacaoExcursoesUtils');
const { vincularCidadePorId } = require('./logisticaService');

const MAX_CIDADES = 300;
const MAX_TOKEN_BYTES = 128 * 1024;
const VALIDADE_MS = 20 * 60 * 1000;
const UFS = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const CONTEXTO_ASSINATURA = 'logistica-importacao-cidades:v1:';

function erro(mensagem, status = 400) {
  const e = new Error(mensagem);
  e.status = status;
  e.isValidation = true;
  return e;
}
function objeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}
function idValido(valor) {
  return typeof valor === 'number' && Number.isSafeInteger(valor) && valor > 0;
}
function usuarioValido(contexto) {
  const usuario = contexto && contexto.usuario;
  if (typeof usuario !== 'string' || !usuario.trim() || usuario.length > 200) {
    throw erro('Autenticação administrativa necessária para importar cidades.', 401);
  }
  return usuario;
}
function segredo() {
  const valor = process.env.ADMIN_SESSION_SECRET;
  if (!valor) throw erro('A importação está indisponível: segredo da sessão administrativa não configurado.', 503);
  return valor;
}
function codigoCatalogo(valor) {
  return valor == null || String(valor).trim() === '' ? null : String(valor).trim();
}
function cidadeCanonica(row) {
  return {
    cidade_id: Number(row.id),
    codigo_ibge: codigoCatalogo(row.codigo_ibge),
    nome: String(row.nome || '').trim(),
    uf: String(row.estado || '').trim().toUpperCase()
  };
}
function cidadeCanonicaValida(cidade) {
  return objeto(cidade) && idValido(cidade.cidade_id) &&
    typeof cidade.nome === 'string' && cidade.nome.trim().length > 0 && cidade.nome.length <= 120 &&
    UFS.has(cidade.uf) && (cidade.codigo_ibge === null || /^\d{7}$/.test(cidade.codigo_ibge));
}
function normalizarEntrada(payload) {
  if (!objeto(payload) || !idValido(payload.transportadora_id)) {
    throw erro('Informe o código de uma transportadora existente.');
  }
  if (!Array.isArray(payload.cidades) || payload.cidades.length < 1 || payload.cidades.length > MAX_CIDADES) {
    throw erro('Informe entre 1 e 300 cidades por importação.');
  }
  return payload.cidades.map((cidade, indice) => {
    if (!objeto(cidade) || typeof cidade.nome !== 'string' || cidade.nome.length > 120 ||
        (cidade.uf != null && (typeof cidade.uf !== 'string' || cidade.uf.length > 32)) ||
        (cidade.codigo_ibge != null && !['string', 'number'].includes(typeof cidade.codigo_ibge))) {
      throw erro('Cidade ' + (indice + 1) + ': informe nome (até 120 caracteres), UF e código IBGE opcional.');
    }
    const codigo = codigoCatalogo(cidade.codigo_ibge);
    if (codigo && codigo.length > 20) throw erro('Código IBGE inválido na cidade ' + (indice + 1) + '.');
    return { nome: cidade.nome.trim(), uf: String(cidade.uf || '').trim().toUpperCase(), codigo_ibge: codigo };
  });
}
function assinar(conteudo) {
  return crypto.createHmac('sha256', segredo()).update(CONTEXTO_ASSINATURA + conteudo).digest('hex');
}
function criarToken(usuario, transportadora, cidades, agora) {
  const payload = {
    versao: 1, usuario, transportadora, cidades,
    emitido_em: agora, expira_em: agora + VALIDADE_MS
  };
  const conteudo = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const token = conteudo + '.' + assinar(conteudo);
  if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
    throw erro('A prévia excedeu o tamanho permitido. Divida a lista em lotes menores.', 413);
  }
  return token;
}
function lerToken(token, usuario) {
  const invalida = () => erro('Prévia inválida ou expirada. Gere uma nova prévia antes de importar.', 409);
  if (typeof token !== 'string' || Buffer.byteLength(token) > MAX_TOKEN_BYTES) throw invalida();
  const partes = token.split('.');
  if (partes.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(partes[0]) || !/^[a-f0-9]{64}$/.test(partes[1])) {
    throw invalida();
  }
  const esperado = assinar(partes[0]);
  if (!crypto.timingSafeEqual(Buffer.from(esperado, 'hex'), Buffer.from(partes[1], 'hex'))) throw invalida();
  let payload;
  try {
    const bytes = Buffer.from(partes[0], 'base64url');
    if (bytes.toString('base64url') !== partes[0]) throw invalida();
    payload = JSON.parse(bytes.toString('utf8'));
  } catch { throw invalida(); }
  const agora = Date.now();
  if (!objeto(payload) || payload.versao !== 1 || !Number.isSafeInteger(payload.emitido_em) ||
      !Number.isSafeInteger(payload.expira_em) || payload.expira_em - payload.emitido_em !== VALIDADE_MS ||
      payload.emitido_em > agora + 30000 || payload.expira_em <= agora ||
      !objeto(payload.transportadora) || !idValido(payload.transportadora.id) ||
      typeof payload.transportadora.nome !== 'string' || !payload.transportadora.nome.trim() ||
      payload.transportadora.nome.length > 300 ||
      !Array.isArray(payload.cidades) || !payload.cidades.length || payload.cidades.length > MAX_CIDADES ||
      !payload.cidades.every(cidadeCanonicaValida) ||
      new Set(payload.cidades.map(c => c.cidade_id)).size !== payload.cidades.length) {
    throw invalida();
  }
  if (payload.usuario !== usuario) throw erro('Esta prévia pertence a outra conta administrativa.', 403);
  return payload;
}

async function prepararImportacao(payload, contexto = {}) {
  const usuario = usuarioValido(contexto);
  const entradas = normalizarEntrada(payload);
  const t = await pool.query('SELECT id, nome FROM transportadoras WHERE id = $1', [payload.transportadora_id]);
  if (!t.rows[0]) throw erro('Transportadora não encontrada.', 404);
  const transportadora = { id: Number(t.rows[0].id), nome: String(t.rows[0].nome || '').trim() };
  if (!idValido(transportadora.id) || !transportadora.nome || transportadora.nome.length > 300) {
    throw erro('Confira o cadastro da transportadora antes de importar.', 409);
  }
  const [catalogo, vinculos] = await Promise.all([
    pool.query('SELECT id, codigo_ibge, nome, estado FROM cidades'),
    pool.query('SELECT cidade_id FROM transportadora_cidade WHERE transportadora_id = $1', [transportadora.id])
  ]);
  const porNomeUf = new Map();
  for (const row of catalogo.rows) {
    const cidade = cidadeCanonica(row);
    const key = chave(cidade.nome) + '|' + cidade.uf;
    if (!porNomeUf.has(key)) porNomeUf.set(key, []);
    porNomeUf.get(key).push(cidade);
  }
  const existentes = new Set(vinculos.rows.map(v => Number(v.cidade_id)));
  const entradasVistas = new Set(), cidadesVistas = new Set();
  const cidades = [], pendencias = [];
  let repetidas = 0;
  for (const entrada of entradas) {
    const nomeNormalizado = chave(entrada.nome);
    const key = nomeNormalizado + '|' + entrada.uf;
    const keyEntrada = key + '|' + (entrada.codigo_ibge || '');
    if (entradasVistas.has(keyEntrada)) { repetidas++; continue; }
    entradasVistas.add(keyEntrada);
    let motivo = '';
    let candidatas = porNomeUf.get(key) || [];
    if (!nomeNormalizado) motivo = 'Nome da cidade não informado.';
    else if (!UFS.has(entrada.uf)) motivo = 'Informe uma UF válida; o estado não será presumido.';
    else if (entrada.codigo_ibge && !/^\d{7}$/.test(entrada.codigo_ibge)) motivo = 'Código IBGE inválido; informe sete dígitos.';
    else if (!candidatas.length) motivo = 'Cidade e UF não encontradas no cadastro.';
    else if (entrada.codigo_ibge) {
      candidatas = candidatas.filter(c => c.codigo_ibge === entrada.codigo_ibge);
      if (!candidatas.length) motivo = 'O código IBGE não corresponde à cidade e UF cadastradas.';
    }
    if (!motivo && candidatas.length > 1) motivo = 'Mais de um cadastro corresponde a esta cidade e UF. Revise o cadastro ou informe o código IBGE correto.';
    if (!motivo && !cidadeCanonicaValida(candidatas[0])) motivo = 'O cadastro da cidade está incompleto ou inválido. Revise-o antes de importar.';
    if (motivo) { pendencias.push({ nome: entrada.nome, uf: entrada.uf, motivo }); continue; }
    const cidade = candidatas[0];
    if (cidadesVistas.has(cidade.cidade_id)) { repetidas++; continue; }
    cidadesVistas.add(cidade.cidade_id);
    cidades.push({ ...cidade, situacao: existentes.has(cidade.cidade_id) ? 'ja_vinculada' : 'nova' });
  }
  const pode_confirmar = cidades.length > 0 && pendencias.length === 0;
  const agora = Date.now();
  const canonicas = cidades.map(({ situacao, ...cidade }) => cidade);
  return {
    transportadora, cidades, pendencias,
    resumo: {
      informadas: entradas.length,
      novas: cidades.filter(c => c.situacao === 'nova').length,
      ja_vinculadas: cidades.filter(c => c.situacao === 'ja_vinculada').length,
      repetidas, pendentes: pendencias.length
    },
    token_previa: pode_confirmar ? criarToken(usuario, transportadora, canonicas, agora) : null,
    pode_confirmar,
    expira_em: pode_confirmar ? new Date(agora + VALIDADE_MS).toISOString() : null
  };
}

async function confirmarImportacao(payload, contexto = {}) {
  const usuario = usuarioValido(contexto);
  if (!objeto(payload)) throw erro('Informe a prévia da importação.');
  const previa = lerToken(payload.token_previa, usuario);
  if (payload.transportadora_id !== undefined &&
      (!idValido(payload.transportadora_id) || payload.transportadora_id !== previa.transportadora.id)) {
    throw erro('A prévia pertence a outra transportadora. Gere uma nova prévia.', 409);
  }
  const client = await pool.connect();
  let iniciado = false;
  try {
    await client.query('BEGIN');
    iniciado = true;
    // Serializa importações para o mesmo alvo e impede sua exclusão durante o lote.
    const t = await client.query('SELECT id, nome FROM transportadoras WHERE id = $1 FOR UPDATE', [previa.transportadora.id]);
    if (!t.rows[0] || String(t.rows[0].nome || '').trim() !== previa.transportadora.nome) {
      throw erro('A transportadora mudou desde a prévia. Gere uma nova prévia.', 409);
    }
    const ids = previa.cidades.map(c => c.cidade_id);
    const catalogo = await client.query(
      'SELECT id, codigo_ibge, nome, estado FROM cidades WHERE id = ANY($1::bigint[]) ORDER BY id FOR SHARE', [ids]
    );
    const atuais = new Map(catalogo.rows.map(row => [Number(row.id), cidadeCanonica(row)]));
    for (const cidade of previa.cidades) {
      const atual = atuais.get(cidade.cidade_id);
      if (!atual || atual.nome !== cidade.nome || atual.uf !== cidade.uf || atual.codigo_ibge !== cidade.codigo_ibge) {
        throw erro('O cadastro de uma cidade mudou desde a prévia. Gere uma nova prévia.', 409);
      }
    }
    if (previa.expira_em <= Date.now()) {
      throw erro('A prévia expirou durante a conferência. Gere uma nova prévia.', 409);
    }
    let adicionadas = 0;
    for (const cidade of previa.cidades) {
      const criada = await vincularCidadePorId(previa.transportadora.id, cidade.cidade_id, null,
        { client, preservarExistente: true });
      if (criada) adicionadas++;
    }
    const total = await client.query(
      'SELECT COUNT(*)::integer AS total FROM transportadora_cidade WHERE transportadora_id = $1', [previa.transportadora.id]
    );
    await client.query('COMMIT');
    iniciado = false;
    return {
      status: 'concluido', transportadora: previa.transportadora,
      adicionadas, ja_vinculadas: previa.cidades.length - adicionadas,
      total_vinculadas: Number(total.rows[0].total)
    };
  } catch (e) {
    if (iniciado) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

module.exports = { prepararImportacao, confirmarImportacao };
