const pool = require('../../../db/connection');

const ZAPI_URL = process.env.ZAPI_URL;
const ZAPI_TOKEN = process.env.ZAPI_TOKEN;

const TIPOS_VALIDOS = [
  'SEND_TEXT',
  'SEND_IMAGE',
  'SEND_AUDIO',
  'SEND_VIDEO',
  'SEND_DOCUMENT',
  'SEND_LOCATION',
  'SEND_LINK'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function garantirEnvZapi() {
  if (!ZAPI_URL || !ZAPI_TOKEN) {
    throw new Error('ZAPI_URL e ZAPI_TOKEN são obrigatórios nas variáveis de ambiente.');
  }
}

function normalizarTelefone(telefone) {
  return String(telefone || '').trim();
}

function normalizarIntencao(intencao) {
  return String(intencao || '').trim().toUpperCase();
}

function normalizarTipoAcao(tipo) {
  return String(tipo || '').trim().toUpperCase();
}

function gerarBucketDezSegundos() {
  return Math.floor(Date.now() / 10000);
}

function gerarIdempotencyKey(telefone, intencao) {
  return `${telefone}:${intencao}:${gerarBucketDezSegundos()}`;
}

async function registrarExecucaoComIdempotencia(telefone, intencao) {
  const idempotencyKey = gerarIdempotencyKey(telefone, intencao);

  const result = await pool.query(
    `INSERT INTO bot_execucoes_fluxo (telefone, intencao, executado_em, idempotency_key)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [telefone, intencao, idempotencyKey]
  );

  return result.rows.length > 0;
}

async function buscarFluxoChave(intencaoNome) {
  const result = await pool.query(
    `SELECT fluxo_chave
     FROM bot_intencoes
     WHERE nome = $1
       AND ativa = true
     LIMIT 1`,
    [intencaoNome]
  );

  return result.rows.length ? result.rows[0].fluxo_chave : null;
}

async function buscarAcoesPorIntencao(intencao) {
  const result = await pool.query(
    `SELECT id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo
     FROM bot_acoes
     WHERE intencao_nome = $1
       AND ativo = true
     ORDER BY ordem ASC, id ASC`,
    [intencao]
  );

  return result.rows;
}

function montarRequisicaoZapi(telefone, acao) {
  const tipo = normalizarTipoAcao(acao.tipo_acao);
  const conteudo = String(acao.conteudo || '').trim();

  switch (tipo) {
    case 'SEND_TEXT':
      return {
        endpoint: '/send-text',
        payload: {
          phone: telefone,
          message: conteudo
        }
      };

    case 'SEND_IMAGE':
      return {
        endpoint: '/send-image',
        payload: {
          phone: telefone,
          image: conteudo
        }
      };

    case 'SEND_AUDIO':
      return {
        endpoint: '/send-audio',
        payload: {
          phone: telefone,
          audio: conteudo
        }
      };

    case 'SEND_VIDEO':
      return {
        endpoint: '/send-video',
        payload: {
          phone: telefone,
          video: conteudo
        }
      };

    case 'SEND_DOCUMENT':
      return {
        endpoint: '/send-document',
        payload: {
          phone: telefone,
          document: conteudo
        }
      };

    case 'SEND_LINK':
      return {
        endpoint: '/send-text',
        payload: {
          phone: telefone,
          message: conteudo
        }
      };

    case 'SEND_LOCATION': {
      try {
        const parsed = JSON.parse(conteudo);

        if (parsed && parsed.latitude != null && parsed.longitude != null) {
          return {
            endpoint: '/send-location',
            payload: {
              phone: telefone,
              latitude: Number(parsed.latitude),
              longitude: Number(parsed.longitude),
              address: parsed.address || ''
            }
          };
        }

        if (parsed && parsed.lat != null && parsed.lng != null) {
          return {
            endpoint: '/send-location',
            payload: {
              phone: telefone,
              latitude: Number(parsed.lat),
              longitude: Number(parsed.lng),
              address: parsed.address || ''
            }
          };
        }

        if (parsed && parsed.address) {
          return {
            endpoint: '/send-text',
            payload: {
              phone: telefone,
              message: String(parsed.address)
            }
          };
        }
      } catch (_) {}

      return {
        endpoint: '/send-text',
        payload: {
          phone: telefone,
          message: conteudo
        }
      };
    }

    default:
      throw new Error(`Tipo de ação inválido: ${tipo}`);
  }
}

async function enviarAcaoZAPI(telefone, acao) {
  garantirEnvZapi();

  const { endpoint, payload } = montarRequisicaoZapi(telefone, acao);
  const url = `${ZAPI_URL}${endpoint}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ClientToken: ZAPI_TOKEN
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error(`Falha ao conectar à Z-API (${url}): ${err.message}`);
  }

  if (!response.ok) {
    const texto = await response.text().catch(() => '');
    throw new Error(`Z-API respondeu ${response.status}: ${texto}`);
  }

  return true;
}

async function executarFluxo(telefone, intencao) {
  const tel = normalizarTelefone(telefone);
  const int = normalizarIntencao(intencao);

  if (!tel) throw new Error('Telefone é obrigatório.');
  if (!int) throw new Error('Intenção é obrigatória.');

  const inseriu = await registrarExecucaoComIdempotencia(tel, int);
  if (!inseriu) {
    console.log(`[botFluxo] fluxo_cancelado_duplicidade | telefone=${tel} intencao=${int}`);
    return { status: 'fluxo_cancelado_duplicidade' };
  }

  const fluxoChave = await buscarFluxoChave(int);
  const chaveExecucao = fluxoChave ? String(fluxoChave).trim().toUpperCase() : int;

  const acoes = await buscarAcoesPorIntencao(chaveExecucao);

  if (!acoes.length) {
    console.log(`[botFluxo] nenhuma ação ativa | intencao=${int} fluxo_chave=${chaveExecucao}`);
    return { status: 'nenhuma_acao' };
  }

  for (const acao of acoes) {
    const delay = Number(acao.delay_ms || 0);

    if (delay > 0) {
      await sleep(delay);
    }

    try {
      await enviarAcaoZAPI(tel, acao);
      console.log(`[botFluxo] ação executada | id=${acao.id} tipo=${acao.tipo_acao} ordem=${acao.ordem}`);
    } catch (err) {
      console.error(`[botFluxo] falha ao executar ação id=${acao.id}: ${err.message}`);
    }
  }

  return { status: 'fluxo_concluido' };
}

async function listarAcoes() {
  const result = await pool.query(
    `SELECT id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo
     FROM bot_acoes
     ORDER BY intencao_nome ASC, ordem ASC, id ASC`
  );

  return result.rows;
}

async function buscarIntencaoNomePorId(intencao_id) {
  const result = await pool.query(
    `SELECT nome
     FROM bot_intencoes
     WHERE id = $1
     LIMIT 1`,
    [intencao_id]
  );

  if (!result.rows.length) {
    throw new Error('Intenção não encontrada.');
  }

  return String(result.rows[0].nome).trim().toUpperCase();
}

async function criarAcao({ intencao_id, ordem, tipo_acao, conteudo, delay_ms = 0, ativo = true }) {
  if (!intencao_id) throw new Error('intencao_id é obrigatório.');
  if (!ordem || Number(ordem) < 1) throw new Error('Ordem deve ser >= 1.');

  const tipo = normalizarTipoAcao(tipo_acao);
  if (!TIPOS_VALIDOS.includes(tipo)) throw new Error('Tipo de ação inválido.');

  const conteudoNormalizado = String(conteudo || '').trim();
  if (!conteudoNormalizado) throw new Error('Conteúdo é obrigatório.');
  if (Number(delay_ms) < 0) throw new Error('Delay deve ser >= 0.');

  const intencao_nome = await buscarIntencaoNomePorId(intencao_id);

  const result = await pool.query(
    `INSERT INTO bot_acoes (intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo`,
    [intencao_nome, Number(ordem), tipo, conteudoNormalizado, Number(delay_ms), !!ativo]
  );

  return result.rows[0];
}

async function atualizarAcao(id, { intencao_id, ordem, tipo_acao, conteudo, delay_ms = 0, ativo }) {
  if (!intencao_id) throw new Error('intencao_id é obrigatório.');
  if (!ordem || Number(ordem) < 1) throw new Error('Ordem deve ser >= 1.');

  const tipo = normalizarTipoAcao(tipo_acao);
  if (!TIPOS_VALIDOS.includes(tipo)) throw new Error('Tipo de ação inválido.');

  const conteudoNormalizado = String(conteudo || '').trim();
  if (!conteudoNormalizado) throw new Error('Conteúdo é obrigatório.');
  if (Number(delay_ms) < 0) throw new Error('Delay deve ser >= 0.');

  const intencao_nome = await buscarIntencaoNomePorId(intencao_id);

  const result = await pool.query(
    `UPDATE bot_acoes
     SET intencao_nome = $1,
         ordem = $2,
         tipo_acao = $3,
         conteudo = $4,
         delay_ms = $5,
         ativo = $6
     WHERE id = $7
     RETURNING id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo`,
    [intencao_nome, Number(ordem), tipo, conteudoNormalizado, Number(delay_ms), !!ativo, id]
  );

  return result.rows[0] || null;
}

async function deletarAcao(id) {
  const result = await pool.query(
    `DELETE FROM bot_acoes
     WHERE id = $1
     RETURNING id`,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  buscarFluxoChave,
  buscarAcoesPorIntencao,
  enviarAcaoZAPI,
  executarFluxo,
  listarAcoes,
  criarAcao,
  atualizarAcao,
  deletarAcao
};
