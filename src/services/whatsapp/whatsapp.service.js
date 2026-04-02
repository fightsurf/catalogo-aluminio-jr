const botFluxoService = require('../bot/botFluxo.services');

function limparTexto(valor) {
  return String(valor || '').trim();
}

function normalizarTelefone(telefone) {
  const digitos = limparTexto(telefone).replace(/\D/g, '');

  if (!digitos) {
    throw new Error('Telefone é obrigatório.');
  }

  if (digitos.startsWith('55') && digitos.length >= 12) {
    return digitos;
  }

  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }

  return digitos;
}

async function enviarMensagem({ telefone, mensagem }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  const mensagemNormalizada = limparTexto(mensagem);

  if (!mensagemNormalizada) {
    throw new Error('Mensagem é obrigatória.');
  }

  await botFluxoService.enviarAcaoZAPI(telefoneNormalizado, {
    tipo_acao: 'SEND_TEXT',
    conteudo: mensagemNormalizada
  });

  return {
    telefone: telefoneNormalizado,
    mensagem: mensagemNormalizada
  };
}

module.exports = {
  enviarMensagem
};
