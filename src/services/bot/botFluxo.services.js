const pool = require('../../../db/connection');

const ZAPI_URL = process.env.ZAPI_URL;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;

// ──────────────────────────────────────────────────────────────
// Utilitário: aguardar ms milissegundos
// ──────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────
// Verificar se já houve execução do mesmo fluxo nos últimos 10s
// ──────────────────────────────────────────────────────────────
async function verificarDuplicidade(telefone, intencao) {
  const result = await pool.query(
    `SELECT id
     FROM bot_execucoes_fluxo
     WHERE telefone = $1
       AND intencao = $2
       AND executado_em > NOW() - INTERVAL '10 seconds'
     LIMIT 1`,
    [telefone, intencao]
  );
  return result.rows.length > 0;
}

// ──────────────────────────────────────────────────────────────
// Registrar execução de fluxo
// ──────────────────────────────────────────────────────────────
async function registrarExecucao(telefone, intencao) {
  await pool.query(
    `INSERT INTO bot_execucoes_fluxo (telefone, intencao, executado_em)
     VALUES ($1, $2, NOW())`,
    [telefone, intencao]
  );
}

// ──────────────────────────────────────────────────────────────
// Buscar ações ativas ordenadas para a intenção
// ──────────────────────────────────────────────────────────────
async function buscarAcoesPorIntencao(intencao) {
  const result = await pool.query(
    `SELECT id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo
     FROM bot_acoes
     WHERE intencao_nome = $1
       AND ativo = true
     ORDER BY ordem ASC`,
    [intencao]
  );
  return result.rows;
}

// ──────────────────────────────────────────────────────────────
// Enviar uma ação via Z-API
// ──────────────────────────────────────────────────────────────
async function enviarAcaoZAPI(telefone, acao) {
  const endpointMap = {
    texto: '/send-text',
    imagem: '/send-image',
    audio: '/send-audio',
    video: '/send-video',
    documento: '/send-document'
  };

  const endpoint = endpointMap[acao.tipo_acao];
  if (!endpoint) {
    console.warn(`[botFluxo] tipo_acao desconhecido: "${acao.tipo_acao}" (id=${acao.id}), ignorando.`);
    return;
  }

  const bodyMap = {
    texto: { phone: telefone, message: acao.conteudo },
    imagem: { phone: telefone, image: acao.conteudo },
    audio: { phone: telefone, audio: acao.conteudo },
    video: { phone: telefone, video: acao.conteudo },
    documento: { phone: telefone, document: acao.conteudo }
  };

  const url = `${ZAPI_URL}${endpoint}`;
  const body = JSON.stringify(bodyMap[acao.tipo_acao]);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ClientToken: ZAPI_TOKEN
      },
      body
    });
  } catch (err) {
    throw new Error(`Falha ao conectar à Z-API (${url}): ${err.message}`);
  }

  if (!response.ok) {
    const texto = await response.text().catch(() => '');
    throw new Error(`Z-API respondeu ${response.status}: ${texto}`);
  }
}

// ──────────────────────────────────────────────────────────────
// Executar fluxo completo em background
// ──────────────────────────────────────────────────────────────
async function executarFluxo(telefone, intencao) {
  const duplicado = await verificarDuplicidade(telefone, intencao);
  if (duplicado) {
    console.log(`[botFluxo] fluxo_cancelado_duplicidade | telefone=${telefone} intencao=${intencao}`);
    return { status: 'fluxo_cancelado_duplicidade' };
  }

  await registrarExecucao(telefone, intencao);

  const acoes = await buscarAcoesPorIntencao(intencao);
  if (!acoes.length) {
    console.log(`[botFluxo] nenhuma ação ativa para intencao="${intencao}"`);
    return { status: 'nenhuma_acao' };
  }

  for (const acao of acoes) {
    if (acao.delay_ms && acao.delay_ms > 0) {
      await sleep(acao.delay_ms);
    }

    try {
      await enviarAcaoZAPI(telefone, acao);
      console.log(`[botFluxo] ação executada | id=${acao.id} tipo=${acao.tipo_acao} ordem=${acao.ordem}`);
    } catch (err) {
      console.error(`[botFluxo] falha ao executar ação id=${acao.id}:`, err.message);
      // Continua para a próxima ação sem interromper o fluxo
    }
  }

  return { status: 'fluxo_concluido' };
}

// ──────────────────────────────────────────────────────────────
// Listar todas as ações para a view admin
// ──────────────────────────────────────────────────────────────
async function listarAcoes() {
  const result = await pool.query(
    `SELECT id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo
     FROM bot_acoes
     ORDER BY intencao_nome ASC, ordem ASC`
  );
  return result.rows;
}

module.exports = {
  verificarDuplicidade,
  registrarExecucao,
  buscarAcoesPorIntencao,
  enviarAcaoZAPI,
  executarFluxo,
  listarAcoes
};
