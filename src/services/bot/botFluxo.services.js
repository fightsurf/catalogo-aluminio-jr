const pool = require('../../../db/connection');
const zapiService = require('../integracoes/zapi.service');

const TIPOS_VALIDOS = zapiService.TIPOS_VALIDOS;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizarTelefone(telefone) {
  return String(telefone || '').trim();
}

function normalizarIntencao(intencao) {
  return String(intencao || '').trim().toUpperCase();
}

function normalizarTipoAcao(tipo) {
  return zapiService.normalizarTipoAcao(tipo);
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
     ON CONFLICT DO NOTHING
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

async function enviarAcaoZAPI(telefone, acao) {
  return zapiService.enviarAcao({
    telefone,
    tipo: acao.tipo_acao,
    conteudo: acao.conteudo
  });
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

async function listarAcoes(intencaoFiltro = '') {
  const intencao = String(intencaoFiltro || '').trim().toUpperCase();

  if (intencao) {
    const result = await pool.query(
      `SELECT id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo
       FROM bot_acoes
       WHERE intencao_nome = $1
       ORDER BY ordem ASC, id ASC`,
      [intencao]
    );

    return result.rows;
  }

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
