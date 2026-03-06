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
// Buscar fluxo_chave da intenção para roteamento no motor de ações
// ──────────────────────────────────────────────────────────────
async function buscarFluxoChave(intencaoNome) {
  const result = await pool.query(
    `SELECT fluxo_chave FROM bot_intencoes WHERE nome = $1 AND ativa = true LIMIT 1`,
    [intencaoNome]
  );
  return result.rows.length > 0 ? result.rows[0].fluxo_chave : null;
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

  const fluxoChave = await buscarFluxoChave(intencao);
  const chaveExecucao = fluxoChave || intencao;

  const acoes = await buscarAcoesPorIntencao(chaveExecucao);
  if (!acoes.length) {
    console.log(`[botFluxo] nenhuma ação ativa para intencao="${intencao}" fluxo_chave="${chaveExecucao}"`);
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

// ──────────────────────────────────────────────────────────────
// Criar nova ação
// ──────────────────────────────────────────────────────────────
async function criarAcao({ intencao_id, ordem, tipo_acao, conteudo, delay_ms = 0, ativo = true }) {
  if (!intencao_id) throw new Error('intencao_id é obrigatório.');
  if (!ordem || Number(ordem) < 1) throw new Error('Ordem deve ser >= 1.');
  if (!tipo_acao || !String(tipo_acao).trim()) throw new Error('Tipo de ação é obrigatório.');
  if (!conteudo || !String(conteudo).trim()) throw new Error('Conteúdo é obrigatório.');
  if (Number(delay_ms) < 0) throw new Error('Delay deve ser >= 0.');

  // Resolve intencao_nome a partir do id
  const intRes = await pool.query(
    `SELECT nome FROM bot_intencoes WHERE id = $1 LIMIT 1`,
    [intencao_id]
  );
  if (!intRes.rows.length) throw new Error('Intenção não encontrada.');
  const intencao_nome = intRes.rows[0].nome;

  const result = await pool.query(
    `INSERT INTO bot_acoes (intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo`,
    [intencao_nome, Number(ordem), String(tipo_acao).trim(), String(conteudo).trim(), Number(delay_ms), !!ativo]
  );
  return result.rows[0];
}

// ──────────────────────────────────────────────────────────────
// Atualizar ação existente
// ──────────────────────────────────────────────────────────────
async function atualizarAcao(id, { intencao_id, ordem, tipo_acao, conteudo, delay_ms = 0, ativo }) {
  if (!intencao_id) throw new Error('intencao_id é obrigatório.');
  if (!ordem || Number(ordem) < 1) throw new Error('Ordem deve ser >= 1.');
  if (!tipo_acao || !String(tipo_acao).trim()) throw new Error('Tipo de ação é obrigatório.');
  if (!conteudo || !String(conteudo).trim()) throw new Error('Conteúdo é obrigatório.');
  if (Number(delay_ms) < 0) throw new Error('Delay deve ser >= 0.');

  const intRes = await pool.query(
    `SELECT nome FROM bot_intencoes WHERE id = $1 LIMIT 1`,
    [intencao_id]
  );
  if (!intRes.rows.length) throw new Error('Intenção não encontrada.');
  const intencao_nome = intRes.rows[0].nome;

  const result = await pool.query(
    `UPDATE bot_acoes
     SET intencao_nome = $1, ordem = $2, tipo_acao = $3, conteudo = $4, delay_ms = $5, ativo = $6
     WHERE id = $7
     RETURNING id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo`,
    [intencao_nome, Number(ordem), String(tipo_acao).trim(), String(conteudo).trim(), Number(delay_ms), !!ativo, id]
  );
  return result.rows[0] || null;
}

// ──────────────────────────────────────────────────────────────
// Deletar ação
// ──────────────────────────────────────────────────────────────
async function deletarAcao(id) {
  const result = await pool.query(
    `DELETE FROM bot_acoes WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  verificarDuplicidade,
  registrarExecucao,
  buscarFluxoChave,
  buscarAcoesPorIntencao,
  enviarAcaoZAPI,
  executarFluxo,
  listarAcoes,
  criarAcao,
  atualizarAcao,
  deletarAcao
};
