'use strict';

// Somente a confirmação consome a ação. Não repetir efeitos externos em erro,
// timeout, reinício do servidor ou chamada concorrente.
const crypto = require('crypto');
const pool = require('../../../db/connection');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TIPOS = new Set(['alterar_pedido', 'cancelar_pedido', 'expedicao_pedido', 'whatsapp_pedido', 'whatsapp_pagamentos']);
let schemaPromise;

function falhar(mensagem) {
  const err = new Error(mensagem);
  err.isValidation = true;
  throw err;
}
function usuario(contexto) {
  const valor = contexto?.usuario;
  if (typeof valor !== 'string' || !valor.trim() || valor.length > 200) {
    falhar('A ação precisa de uma conta autenticada no MCP.');
  }
  return valor;
}
function hash(valor) { return crypto.createHash('sha256').update(valor).digest('hex'); }
async function estrutura() {
  if (!schemaPromise) schemaPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_pedidos_acoes (
      id UUID PRIMARY KEY,
      usuario VARCHAR(200) NOT NULL,
      tipo VARCHAR(40) NOT NULL,
      codigo_hash CHAR(64) NOT NULL,
      payload JSONB NOT NULL,
      resumo JSONB NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'aguardando_confirmacao',
      progresso JSONB NOT NULL DEFAULT '[]'::jsonb,
      resultado JSONB,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expira_em TIMESTAMPTZ NOT NULL,
      concluido_em TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_pedidos_acoes_usuario
      ON mcp_pedidos_acoes(usuario, status, expira_em);
  `).catch(err => { schemaPromise = null; throw err; });
  return schemaPromise;
}

async function prepararAcao({ tipo, payload, resumo }, contexto) {
  const dono = usuario(contexto);
  if (!TIPOS.has(tipo) || !payload || !resumo) falhar('Prévia da ação inválida.');
  const serializado = JSON.stringify(payload);
  if (Buffer.byteLength(serializado, 'utf8') > 8 * 1024 * 1024) falhar('A prévia excede o limite permitido.');
  await estrutura();
  // Prévia vencida não será reutilizada; libera especialmente o áudio armazenado.
  await pool.query(`UPDATE mcp_pedidos_acoes SET status='expirado', payload='{}'::jsonb
    WHERE status='aguardando_confirmacao' AND expira_em <= NOW()`);
  const validade = payload.expira_em ? new Date(payload.expira_em).getTime() : Date.now() + 15 * 60000;
  const minutos = Math.min(15, Math.max(1, Math.ceil((validade - Date.now()) / 60000)));
  if (!Number.isFinite(validade) || validade <= Date.now()) falhar('A prévia já está expirada. Prepare novamente.');
  const expiraEm = new Date(Math.min(validade, Date.now() + 15 * 60000)).toISOString();
  const id = crypto.randomUUID();
  const codigo = crypto.randomBytes(8).toString('hex').toUpperCase();
  await pool.query(`INSERT INTO mcp_pedidos_acoes
    (id, usuario, tipo, codigo_hash, payload, resumo, expira_em)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)`,
  [id, dono, tipo, hash(codigo), serializado, JSON.stringify(resumo), expiraEm]);
  return {
    status: 'aguardando_confirmacao', acao_id: id, tipo,
    codigo_confirmacao: codigo, expira_em: expiraEm, expira_em_minutos: minutos, resumo,
    instrucoes: 'Apresente o pedido, cliente, alterações e todos os envios previstos. Aguarde uma resposta posterior de confirmação explícita antes de confirmar a ação. Nenhuma alteração de pedido ou mensagem foi executada nesta prévia.'
  };
}

async function consultarAcao({ acao_id }, contexto) {
  const dono = usuario(contexto);
  if (typeof acao_id !== 'string' || !UUID.test(acao_id)) falhar('Identificador da ação inválido.');
  await estrutura();
  const r = await pool.query(`SELECT id, tipo, status, resumo, progresso, resultado, expira_em, concluido_em
    FROM mcp_pedidos_acoes WHERE id=$1 AND usuario=$2`, [acao_id, dono]);
  const row = r.rows[0];
  if (!row) falhar('Ação não encontrada para esta conta.');
  return {
    acao_id: row.id, tipo: row.tipo, status: row.status, resumo: row.resumo,
    progresso: row.progresso || [], resultado: row.resultado || null,
    expirado: new Date(row.expira_em).getTime() <= Date.now(),
    concluido_em: row.concluido_em || null,
    revisao_manual_necessaria: ['em_processamento', 'revisao_necessaria', 'parcial'].includes(row.status),
    pode_reexecutar: false
  };
}

async function confirmarAcao(args, contexto, tipo, executar) {
  const dono = usuario(contexto);
  const { acao_id, codigo_confirmacao, confirmacao } = args || {};
  if (typeof acao_id !== 'string' || !UUID.test(acao_id)) falhar('Identificador da ação inválido.');
  if (typeof codigo_confirmacao !== 'string' || !/^[A-F0-9]{16}$/.test(codigo_confirmacao)) falhar('Código de confirmação inválido.');
  if (confirmacao !== 'CONFIRMO') falhar('A ação exige confirmação explícita: CONFIRMO.');
  if (!TIPOS.has(tipo) || typeof executar !== 'function') falhar('Tipo da ação inválido.');
  await estrutura();
  const claim = await pool.query(`UPDATE mcp_pedidos_acoes SET status='em_processamento'
    WHERE id=$1 AND usuario=$2 AND tipo=$3 AND codigo_hash=$4
      AND status='aguardando_confirmacao' AND expira_em > NOW()
    RETURNING payload`, [acao_id, dono, tipo, hash(codigo_confirmacao)]);
  if (!claim.rows.length) {
    const atual = await consultarAcao({ acao_id }, contexto);
    if (atual.tipo !== tipo) falhar('Esta confirmação não corresponde ao tipo da prévia.');
    return { ...atual, mensagem: 'A prévia não foi consumida novamente. Pode estar expirada, já utilizada ou com código incorreto. Consulte o resultado; não repita a operação.' };
  }
  const progresso = [];
  const registrarProgresso = async etapa => {
    const registro = { ...etapa, registrado_em: new Date().toISOString() };
    // Persistir ANTES da chamada externa é responsabilidade do executor.
    await pool.query(`UPDATE mcp_pedidos_acoes SET progresso=progresso || $2::jsonb
      WHERE id=$1 AND usuario=$3`, [acao_id, JSON.stringify([registro]), dono]);
    progresso.push(registro);
  };
  try {
    const resultado = await executar(claim.rows[0].payload, { registrarProgresso });
    if (!resultado || !resultado.status) throw new Error('Executor retornou resultado não verificável.');
    const status = resultado.status === 'resultado_incerto' ? 'revisao_necessaria'
      : resultado.status === 'parcial' ? 'parcial'
      : resultado.status === 'nao_enviado' || resultado.status === 'nao_executado' ? 'nao_executado'
      : 'concluido';
    await pool.query(`UPDATE mcp_pedidos_acoes SET status=$2, resultado=$3::jsonb,
      concluido_em=NOW(), payload='{}'::jsonb WHERE id=$1 AND usuario=$4`,
    [acao_id, status, JSON.stringify(resultado), dono]);
    return { acao_id, tipo, status, resultado, progresso, pode_reexecutar: false,
      revisao_manual_necessaria: ['parcial', 'revisao_necessaria'].includes(status) };
  } catch (err) {
    const houveTentativa = progresso.length > 0;
    const status = houveTentativa ? 'revisao_necessaria' : 'nao_executado';
    const resultado = {
      status: houveTentativa ? 'resultado_incerto' : 'nao_executado',
      mensagem: houveTentativa
        ? 'A operação pode ter sido executada total ou parcialmente. Confira pedido, progresso e provedor; não repita automaticamente.'
        : err.isValidation ? err.message : 'A validação não pôde ser concluída. Nenhuma chamada de alteração ou envio foi iniciada.',
      pode_reexecutar: false
    };
    // Se a própria persistência falhar, a reserva permanece em_processamento.
    // Assim nem uma queda entre o provedor e o banco permite reenviar.
    await pool.query(`UPDATE mcp_pedidos_acoes SET status=$2, resultado=$3::jsonb,
      concluido_em=NOW(), payload='{}'::jsonb WHERE id=$1 AND usuario=$4`,
    [acao_id, status, JSON.stringify(resultado), dono]);
    return { acao_id, tipo, status, resultado, progresso,
      revisao_manual_necessaria: houveTentativa, pode_reexecutar: false };
  }
}

module.exports = { prepararAcao, confirmarAcao, consultarAcao };
