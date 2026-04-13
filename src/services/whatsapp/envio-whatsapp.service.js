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

module.exports = {
  enviarMensagem,
  normalizarTelefone: zapiService.normalizarTelefone
};
