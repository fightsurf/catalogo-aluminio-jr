const pool = require('../../../db/connection');
const zapiService = require('../integracoes/zapi.service');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizarIntencao(intencao) {
  return String(intencao || '').trim().toUpperCase();
}

async function buscarFluxoChave(nomeIntencao) {
  const result = await pool.query(
    `SELECT fluxo_chave
     FROM bot_intencoes
     WHERE nome = $1
     LIMIT 1`,
    [nomeIntencao]
  );

  return result.rows[0]?.fluxo_chave || null;
}

async function buscarIntencao(nomeIntencao) {
  const result = await pool.query(
    `SELECT id, nome, descricao, fluxo_chave, exige_humano, ativa
     FROM bot_intencoes
     WHERE nome = $1
     LIMIT 1`,
    [nomeIntencao]
  );

  return result.rows[0] || null;
}

async function buscarAcoesAtivas(intencaoNome) {
  const result = await pool.query(
    `SELECT id, intencao_nome, ordem, tipo_acao, conteudo, delay_ms, ativo
     FROM bot_acoes
     WHERE intencao_nome = $1
       AND ativo = true
     ORDER BY ordem ASC, id ASC`,
    [intencaoNome]
  );

  return result.rows;
}

async function executarIntencao({ telefone, intencao }) {
  const telefoneNormalizado = zapiService.normalizarTelefone(telefone);
  const intencaoNormalizada = normalizarIntencao(intencao);

  if (!telefoneNormalizado) {
    throw new Error('Telefone é obrigatório.');
  }

  if (!intencaoNormalizada) {
    throw new Error('Intenção é obrigatória.');
  }

  const intencaoAtiva = await buscarIntencao(intencaoNormalizada);

  if (!intencaoAtiva) {
    const erro = new Error('Intenção não encontrada.');
    erro.statusCode = 404;
    throw erro;
  }

  const fluxoChave = await buscarFluxoChave(intencaoNormalizada);
  const intencaoExecucao = fluxoChave
    ? String(fluxoChave).trim().toUpperCase()
    : intencaoNormalizada;

  const acoes = await buscarAcoesAtivas(intencaoExecucao);

  if (!acoes.length) {
    const erro = new Error('Nenhuma ação ativa encontrada para essa intenção.');
    erro.statusCode = 404;
    throw erro;
  }

  const resultados = [];

  for (const acao of acoes) {
    const delay = Number(acao.delay_ms || 0);

    if (delay > 0) {
      await sleep(delay);
    }

    const envio = await zapiService.enviarAcao({
      telefone: telefoneNormalizado,
      tipo: acao.tipo_acao,
      conteudo: acao.conteudo
    });

    resultados.push({
      id: acao.id,
      ordem: acao.ordem,
      tipo_acao: acao.tipo_acao,
      conteudo: acao.conteudo,
      delay_ms: delay,
      resposta_zapi: envio.zapi || null
    });
  }

  return {
    success: true,
    telefone: telefoneNormalizado,
    intencao: intencaoNormalizada,
    fluxo_executado: intencaoExecucao,
    total_acoes: resultados.length,
    acoes: resultados
  };
}

module.exports = {
  executarIntencao
};
