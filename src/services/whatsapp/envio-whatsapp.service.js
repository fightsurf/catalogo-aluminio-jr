function getZapiUrlBase() {
  const value = String(process.env.ZAPI_URL || '').trim();

  if (!value) {
    throw new Error('ZAPI_URL não configurada nas variáveis de ambiente.');
  }

  return value.replace(/\/+$/, '');
}

function getZapiClientToken() {
  const value = String(process.env.ZAPI_TOKEN || '').trim();

  if (!value) {
    throw new Error('ZAPI_TOKEN não configurado nas variáveis de ambiente.');
  }

  return value;
}

function normalizarTelefone(telefone) {
  return String(telefone || '').replace(/\D+/g, '');
}

function validarTelefone(telefone) {
  if (!telefone) {
    throw new Error('Telefone é obrigatório.');
  }

  if (telefone.length < 10) {
    throw new Error('Telefone inválido. Informe o número com DDI e DDD.');
  }
}

function validarMensagem(mensagem) {
  if (!String(mensagem || '').trim()) {
    throw new Error('Mensagem é obrigatória.');
  }
}

async function enviarMensagem({ telefone, mensagem }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  const mensagemNormalizada = String(mensagem || '').trim();

  validarTelefone(telefoneNormalizado);
  validarMensagem(mensagemNormalizada);

  const url = `${getZapiUrlBase()}/send-text`;

  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': getZapiClientToken()
      },
      body: JSON.stringify({
        phone: telefoneNormalizado,
        message: mensagemNormalizada
      })
    });
  } catch (error) {
    throw new Error(`Falha ao conectar à Z-API: ${error.message}`);
  }

  const responseText = await response.text().catch(() => '');

  let responseData = null;

  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch (_) {
      responseData = { raw: responseText };
    }
  }

  if (!response.ok) {
    const detalhe =
      responseData?.error ||
      responseData?.message ||
      responseData?.errorDescription ||
      responseText ||
      'Erro ao enviar mensagem pela Z-API.';

    throw new Error(`Z-API respondeu ${response.status}: ${detalhe}`);
  }

  return {
    success: true,
    telefone: telefoneNormalizado,
    mensagem: mensagemNormalizada,
    zapi: responseData
  };
}

module.exports = {
  enviarMensagem,
  normalizarTelefone
};
