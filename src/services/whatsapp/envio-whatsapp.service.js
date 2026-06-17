const zapiService = require('../integracoes/zapi.service');

async function enviarMensagem({ telefone, mensagem }) {
  const resultado = await zapiService.enviarTexto({ telefone, mensagem });

  return {
    success: true,
    telefone: resultado.telefone,
    mensagem: resultado.mensagem,
    zapi: resultado.zapi
  };
}

async function enviarDocumentoPdf({ telefone, documentoBase64, nomeArquivo, legenda }) {
  const resultado = await zapiService.enviarDocumentoPdf({
    telefone,
    documentoBase64,
    nomeArquivo,
    legenda
  });

  return {
    success: true,
    telefone: resultado.telefone,
    nomeArquivo: resultado.nomeArquivo,
    legenda: resultado.legenda,
    zapi: resultado.zapi
  };
}

module.exports = {
  enviarMensagem,
  enviarDocumentoPdf,
  normalizarTelefone: zapiService.normalizarTelefone
};
