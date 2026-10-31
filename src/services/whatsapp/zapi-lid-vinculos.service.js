'use strict';

// Mapeamento apenas quando o telefone e o LID aparecem juntos em um webhook
// ou quando a Z-API confirma o LID para um numero conhecido.
// Nao e possivel deduzir um telefone a partir de um @lid isolado.
const pool = require('../../../db/connection');
let estruturaPromise;

function ehLid(valor) {
  return /^\d+@lid$/i.test(String(valor || '').trim());
}

function limparTelefone(valor) {
  const texto = String(valor || '').trim();
  if (!/^\+?[\d\s()-]+$/.test(texto)) return '';
  const digitos = texto.replace(/\D/g, '');
  return /^\d{10,15}$/.test(digitos) ? digitos : '';
}

function extrairLid(payload) {
  if (ehLid(payload?.chatLid)) return String(payload.chatLid).trim().toLowerCase();
  // Em mensagens enviadas pela fabrica, senderLid pode representar a fabrica.
  if (payload?.fromMe === false && ehLid(payload?.senderLid)) {
    return String(payload.senderLid).trim().toLowerCase();
  }
  return '';
}

function instanciaAtual() {
  const explicita = String(process.env.ZAPI_WEBHOOK_INSTANCE_ID || '').trim();
  if (explicita) return explicita;
  const base = String(process.env.ZAPI_URL || '');
  const encontrada = base.match(/\/instances\/([^/]+)\/token\//i);
  return encontrada ? encontrada[1] : '';
}

async function prepararEstrutura() {
  if (!estruturaPromise) {
    estruturaPromise = (async () => {
      await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_lid_vinculos (
        instancia TEXT NOT NULL,
        lid TEXT NOT NULL,
        telefone TEXT NOT NULL,
        origem TEXT NOT NULL,
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (instancia, lid)
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_whatsapp_lid_vinculos_telefone ON whatsapp_lid_vinculos(telefone)');
    })().catch(e => { estruturaPromise = null; throw e; });
  }
  return estruturaPromise;
}

async function vincular({ instancia, telefone, lid, origem }) {
  const numero = limparTelefone(telefone);
  if (!instancia || !numero || !ehLid(lid)) return false;
  await prepararEstrutura();
  const ident = lid.toLowerCase();
  // NUNCA remapear um mesmo LID para outro numero sem validacao explicita.
  const resultado = await pool.query(`INSERT INTO whatsapp_lid_vinculos
      (instancia, lid, telefone, origem) VALUES ($1,$2,$3,$4)
      ON CONFLICT (instancia, lid) DO UPDATE
        SET atualizado_em = NOW()
      WHERE whatsapp_lid_vinculos.telefone = EXCLUDED.telefone
      RETURNING lid`,
    [instancia, ident, numero, origem || 'webhook']);
  return resultado.rowCount > 0;
}

async function resolverRecebimento(payload) {
  const original = String(payload?.phone || '').trim();
  if (payload?.isGroup === true || payload?.isNewsletter === true) return original;
  const instancia = String(payload?.instanceId || '').trim();
  const numero = limparTelefone(original);
  const lid = extrairLid(payload);

  if (numero && lid && instancia) {
    await vincular({ instancia, telefone: numero, lid, origem: 'webhook' });
    return numero;
  }
  if (ehLid(original) && instancia) {
    await prepararEstrutura();
    const dados = await pool.query(
      'SELECT telefone FROM whatsapp_lid_vinculos WHERE instancia=$1 AND lid=$2',
      [instancia, original.toLowerCase()]
    );
    return dados.rows[0]?.telefone || original;
  }
  return original;
}

// Conferencia sob demanda, sem disparar mensagem pelo WhatsApp.
async function conferirNumero(telefone) {
  const numero = limparTelefone(telefone);
  if (!numero) {
    const e = new Error('Informe um telefone com DDI e DDD, somente numeros.');
    e.status = 400;
    throw e;
  }
  const instancia = instanciaAtual();
  const base = String(process.env.ZAPI_URL || '').trim().replace(/\/+$/, '');
  const clientToken = String(process.env.ZAPI_TOKEN || '').trim();
  if (!instancia || !base || !clientToken) {
    const e = new Error('Configuracao da Z-API incompleta para consultar LID.');
    e.status = 503;
    throw e;
  }
  let resposta;
  try {
    resposta = await fetch(`${base}/phone-exists/${encodeURIComponent(numero)}`, {
      method: 'GET',
      headers: { 'Client-Token': clientToken },
      signal: AbortSignal.timeout(12000)
    });
  } catch (_) {
    const e = new Error('Nao foi possivel consultar a Z-API neste momento.');
    e.status = 502;
    throw e;
  }
  if (!resposta.ok) {
    const e = new Error(`Consulta Z-API falhou (HTTP ${resposta.status}).`);
    e.status = 502;
    throw e;
  }
  const corpo = await resposta.json().catch(() => null);
  const item = Array.isArray(corpo) ? corpo[0] : corpo;
  if (!item || (item.exists !== true && item.exists !== 'true')) {
    return { telefone: numero, lid: null, vinculado: false, motivo: 'numero_nao_confirmado' };
  }
  // A Z-API pode formatar um numero de forma diferente, entao nao criaremos
  // vinculo com telefone divergente (risco de mesclar clientes errados).
  if (limparTelefone(item.phone) !== numero) {
    return { telefone: numero, lid: null, vinculado: false, motivo: 'telefone_divergente' };
  }
  if (!ehLid(item.lid)) {
    return { telefone: numero, lid: null, vinculado: false, motivo: 'lid_nao_disponivel' };
  }
  const lid = String(item.lid).trim().toLowerCase();
  const vinculado = await vincular({ instancia, telefone: numero, lid, origem: 'phone-exists' });
  return { telefone: numero, lid, vinculado, motivo: vinculado ? 'confirmado' : 'conflito_de_identidade' };
}

module.exports = {
  ehLid, limparTelefone, extrairLid, instanciaAtual, prepararEstrutura,
  vincular, resolverRecebimento, conferirNumero
};
