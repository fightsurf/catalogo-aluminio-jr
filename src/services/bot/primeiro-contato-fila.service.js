'use strict';
// Fila duravel de saudacoes: guarda apenas telefone e estado, nunca conversas.
const pool = require('../../../db/connection');
const autonomia = require('./botAutonomia.services');
const contatos = require('./google-contatos.service');
const fluxo = require('./botFluxo.services');
const malaDireta = require('./primeiro-contato-mala-direta.service');

const INTERVALO_MS = 30000;
let timer;
let ocupado = false;

async function preparar() {
  await pool.query(`CREATE TABLE IF NOT EXISTS bot_primeiro_contato_fila (
    chave TEXT PRIMARY KEY,
    telefone TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendente',
    tentativas INTEGER NOT NULL DEFAULT 0,
    proxima_tentativa TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    motivo TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS bot_primeiro_contato_fila_pendentes_idx
    ON bot_primeiro_contato_fila (proxima_tentativa)
    WHERE estado IN ('pendente', 'validando')`);
}

function identidade(telefone) {
  const tel = String(telefone || '').trim();
  if (!/^\d{10,15}$/.test(tel)) return { chave: null, variantes: [tel] };
  const normal = contatos.normalizarTelefone(tel);
  if (!normal) return { chave: null, variantes: [tel] };
  const chave = /^55\d{2}9\d{8}$/.test(normal)
    ? normal.slice(0, 4) + normal.slice(5) : normal;
  const variantes = /^55\d{2}\d{8}$/.test(chave)
    ? [chave, chave.slice(0, 4) + '9' + chave.slice(4)] : [chave];
  return { chave, variantes: [...new Set([tel, ...variantes, ...variantes.filter(n => n.startsWith('55')).map(n => n.slice(2))])] };
}

// O primeiro registro e a pendencia sao atomicos. Contatos antigos e entradas
// recebidas com o bot desligado continuam sem saudacao, como antes.
async function registrarContato(telefone, executor = pool) {
  const tel = String(telefone || '').trim();
  const { chave, variantes } = identidade(tel);
  const r = await executor.query(`WITH novo AS (
    INSERT INTO bot_contatos (telefone, criado_em, atualizado_em, fluxo_primeiro_contato_enviado)
    VALUES ($1, NOW(), NOW(), true)
    ON CONFLICT (telefone) DO NOTHING RETURNING telefone
  )
  INSERT INTO bot_primeiro_contato_fila (chave, telefone)
  SELECT $2, novo.telefone FROM novo
  WHERE $2::text IS NOT NULL
    AND EXISTS (SELECT 1 FROM bot_config WHERE chave = 'autonomia_ativa' AND lower(valor::text) = 'true')
    AND NOT EXISTS (SELECT 1 FROM bot_contatos WHERE telefone = ANY($3::text[]))
  ON CONFLICT (chave) DO NOTHING RETURNING chave`, [tel, chave, variantes]);
  return r.rowCount > 0;
}

// Lease somente antes de enviar: uma reinicializacao pode recuperar a consulta,
// mas jamais repete automaticamente um envio de resultado desconhecido.
async function reivindicar(chave = null) {
  const r = await pool.query(`WITH candidato AS (
    SELECT chave FROM bot_primeiro_contato_fila
    WHERE estado IN ('pendente', 'validando') AND proxima_tentativa <= NOW()
      AND ($1::text IS NULL OR chave = $1)
    ORDER BY proxima_tentativa, criado_em
    LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE bot_primeiro_contato_fila f SET estado = 'validando',
    tentativas = f.tentativas + 1, proxima_tentativa = NOW() + INTERVAL '2 minutes',
    atualizado_em = NOW()
  FROM candidato c WHERE f.chave = c.chave RETURNING f.*`, [chave]);
  return r.rows[0] || null;
}

async function transicao(item, estadoAnterior, estado, motivo, atraso = 0) {
  const r = await pool.query(`UPDATE bot_primeiro_contato_fila
    SET estado = $4, motivo = $5, proxima_tentativa = NOW() + $6::integer * INTERVAL '1 second',
      atualizado_em = NOW()
    WHERE chave = $1 AND tentativas = $2 AND estado = $3 RETURNING chave`,
  [item.chave, item.tentativas, estadoAnterior, estado, motivo, atraso]);
  return r.rowCount > 0;
}

async function adiar(item, motivo) {
  const atraso = Math.min(300, 30 * 2 ** Math.min(4, Math.max(0, item.tentativas - 1)));
  await transicao(item, 'validando', 'pendente', motivo, atraso);
  console.warn('[Fila saudacao] Identificacao pendente:', motivo, 'nova tentativa em', atraso, 's');
}

async function concluirEnvio(item) {
  try {
    const r = await fluxo.executarPrimeiroContatoAutomatico(item.telefone);
    const status = r?.status || 'resultado_desconhecido';
    const estado = status === 'fluxo_concluido' ? 'concluido'
      : status === 'nenhuma_acao' ? 'bloqueado' : 'revisao';
    await transicao(item, 'enviando', estado, status);
    console.log('[Fila saudacao] Fluxo finalizado:', status);
  } catch (erro) {
    await transicao(item, 'enviando', 'revisao', 'resultado_envio_incerto');
    console.error('[Fila saudacao] Envio incerto; sem repeticao automatica.');
  }
}

async function processar(item, aguardarEnvio = true) {
  try {
    const r = await contatos.avaliarPrimeiroContato(item.telefone);
    if (r.estado === 'pendente' || r.estado === 'pausado') {
      await adiar(item, r.motivo);
      return false;
    }
    if (r.estado !== 'autorizado') {
      await transicao(item, 'validando', 'bloqueado', r.motivo);
      return false;
    }
    if (await malaDireta.abordadoPelaMalaDireta(item.telefone)) {
      await transicao(item, 'validando', 'bloqueado', 'mala_direta');
      return false;
    }
    if (!(await autonomia.getAutonomiaAtiva())) {
      await adiar(item, 'bot_desligado');
      return false;
    }
  } catch (erro) {
    await adiar(item, 'falha_validacao');
    return false;
  }
  if (!(await transicao(item, 'validando', 'enviando', 'validado'))) return false;
  const envio = concluirEnvio(item);
  if (aguardarEnvio) await envio;
  else envio.catch(() => console.error('[Fila saudacao] Falha ao registrar resultado do envio.'));
  return true;
}

async function processarTelefone(telefone) {
  const { chave } = identidade(telefone);
  if (!chave) return false;
  const item = await reivindicar(chave);
  return item ? processar(item, false) : false;
}

async function executar() {
  if (ocupado) return;
  ocupado = true;
  try {
    if (!(await autonomia.getAutonomiaAtiva())) return;
    for (let i = 0; i < 10; i++) {
      if (!(await autonomia.getAutonomiaAtiva())) break;
      const item = await reivindicar();
      if (!item) break;
      await processar(item);
    }
  } catch (erro) {
    console.error('[Fila saudacao] Erro no trabalhador; novas tentativas continuam agendadas.');
  } finally {
    ocupado = false;
  }
}

function iniciar() {
  if (timer) return;
  timer = setInterval(executar, INTERVALO_MS);
  timer.unref?.();
  void executar();
  console.log('[Fila saudacao] Trabalhador iniciado.');
}

module.exports = { preparar, registrarContato, processarTelefone, iniciar, executar };
