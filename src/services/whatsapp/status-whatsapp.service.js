const zapiService = require('../integracoes/zapi.service');

const requisicoesEmAndamento = new Map();
const TEMPO_CACHE_MS = 30 * 60 * 1000;

function limparTexto(valor) {
  return String(valor || '').trim();
}

function normalizarRequestId(valor) {
  const requestId = limparTexto(valor);

  if (!requestId) {
    throw new Error('Identificador da publicação não informado.');
  }

  if (requestId.length > 120 || !/^[a-zA-Z0-9._:-]+$/.test(requestId)) {
    throw new Error('Identificador da publicação inválido.');
  }

  return requestId;
}

function removerDoCacheDepois(requestId) {
  const timer = setTimeout(() => {
    requisicoesEmAndamento.delete(requestId);
  }, TEMPO_CACHE_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

async function verificarConexao() {
  const resultado = await zapiService.verificarConexao();

  return {
    connected: Boolean(resultado.connected),
    smartphoneConnected: Boolean(resultado.smartphoneConnected),
    error: resultado.error || '',
  };
}

async function publicarImagem({ requestId, imagemBase64, legenda, nomeArquivo }) {
  const idNormalizado = normalizarRequestId(requestId);
  const imagemNormalizada = limparTexto(imagemBase64);
  const legendaNormalizada = limparTexto(legenda);
  const nomeNormalizado = limparTexto(nomeArquivo) || 'imagem';

  if (!imagemNormalizada) {
    throw new Error('Imagem não informada.');
  }

  const requisicaoExistente = requisicoesEmAndamento.get(idNormalizado);
  if (requisicaoExistente) {
    const resultadoExistente = await requisicaoExistente;
    return {
      ...resultadoExistente,
      repetida: true,
    };
  }

  const promessa = (async () => {
    const resultado = await zapiService.enviarImagemStatus({
      imagem: imagemNormalizada,
      legenda: legendaNormalizada,
    });

    return {
      success: true,
      requestId: idNormalizado,
      nomeArquivo: nomeNormalizado,
      legenda: legendaNormalizada,
      zapi: resultado.zapi,
      repetida: false,
    };
  })();

  requisicoesEmAndamento.set(idNormalizado, promessa);

  try {
    const resultado = await promessa;
    removerDoCacheDepois(idNormalizado);
    return resultado;
  } catch (error) {
    requisicoesEmAndamento.delete(idNormalizado);
    throw error;
  }
}

module.exports = {
  verificarConexao,
  publicarImagem,
};
