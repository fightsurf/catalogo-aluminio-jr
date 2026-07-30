const TIPOS_VALIDOS = [
  'SEND_TEXT',
  'SEND_IMAGE',
  'SEND_AUDIO',
  'SEND_VIDEO',
  'SEND_DOCUMENT',
  'SEND_LOCATION',
  'SEND_LINK'
];

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

function normalizarTipoAcao(tipo) {
  return String(tipo || '').trim().toUpperCase();
}

function parseJsonSeguro(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function montarRequisicao(tipoAcao, telefone, conteudo) {
  const tipo = normalizarTipoAcao(tipoAcao);
  const conteudoTexto = String(conteudo || '').trim();

  if (!TIPOS_VALIDOS.includes(tipo)) {
    throw new Error(`Tipo de ação inválido: ${tipo}`);
  }

  switch (tipo) {
    case 'SEND_TEXT':
      validarMensagem(conteudoTexto);
      return {
        endpoint: '/send-text',
        payload: {
          phone: telefone,
          message: conteudoTexto
        }
      };

    case 'SEND_LINK':
      validarMensagem(conteudoTexto);
      return {
        endpoint: '/send-text',
        payload: {
          phone: telefone,
          message: conteudoTexto
        }
      };

    case 'SEND_IMAGE':
      if (!conteudoTexto) {
        throw new Error('Conteúdo da imagem é obrigatório.');
      }

      return {
        endpoint: '/send-image',
        payload: {
          phone: telefone,
          image: conteudoTexto
        }
      };

    case 'SEND_AUDIO':
      if (!conteudoTexto) {
        throw new Error('Conteúdo do áudio é obrigatório.');
      }

      return {
        endpoint: '/send-audio',
        payload: {
          phone: telefone,
          audio: conteudoTexto
        }
      };

    case 'SEND_VIDEO':
      if (!conteudoTexto) {
        throw new Error('Conteúdo do vídeo é obrigatório.');
      }

      return {
        endpoint: '/send-video',
        payload: {
          phone: telefone,
          video: conteudoTexto
        }
      };

    case 'SEND_DOCUMENT':
      if (!conteudoTexto) {
        throw new Error('Conteúdo do documento é obrigatório.');
      }

      return {
        endpoint: '/send-document',
        payload: {
          phone: telefone,
          document: conteudoTexto
        }
      };

    case 'SEND_LOCATION': {
      const parsed = parseJsonSeguro(conteudoTexto);

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

      validarMensagem(conteudoTexto);
      return {
        endpoint: '/send-text',
        payload: {
          phone: telefone,
          message: conteudoTexto
        }
      };
    }

    default:
      throw new Error(`Tipo de ação inválido: ${tipo}`);
  }
}

async function postZapi(endpoint, payload) {
  const url = `${getZapiUrlBase()}${endpoint}`;

  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': getZapiClientToken()
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(`Falha ao conectar à Z-API (${url}): ${error.message}`);
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
      'Erro ao enviar pela Z-API.';

    throw new Error(`Z-API respondeu ${response.status}: ${detalhe}`);
  }

  return {
    success: true,
    endpoint,
    payload,
    zapi: responseData
  };
}


async function getZapi(endpoint) {
  const url = `${getZapiUrlBase()}${endpoint}`;

  let response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Client-Token': getZapiClientToken()
      }
    });
  } catch (error) {
    throw new Error(`Falha ao conectar à Z-API (${url}): ${error.message}`);
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
      'Erro ao consultar a Z-API.';

    throw new Error(`Z-API respondeu ${response.status}: ${detalhe}`);
  }

  return responseData || {};
}

async function verificarConexao() {
  const data = await getZapi('/status');

  return {
    connected: Boolean(data.connected),
    smartphoneConnected: Boolean(data.smartphoneConnected),
    error: data.error || ''
  };
}

function validarImagem(imagem) {
  if (/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imagem)) {
    return;
  }

  let url;
  try {
    url = new URL(imagem);
  } catch (_) {
    throw new Error('Imagem inválida. Informe uma URL HTTP/HTTPS ou uma imagem Base64.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Imagem inválida. A URL deve usar HTTP ou HTTPS.');
  }
}

async function enviarImagem({ telefone, imagem, legenda }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  const imagemNormalizada = String(imagem || '').trim();
  const legendaNormalizada = String(legenda || '').trim();

  validarTelefone(telefoneNormalizado);

  if (!imagemNormalizada) {
    throw new Error('Imagem é obrigatória.');
  }

  validarImagem(imagemNormalizada);

  const payload = {
    phone: telefoneNormalizado,
    image: imagemNormalizada
  };

  if (legendaNormalizada) {
    payload.caption = legendaNormalizada;
  }

  const resultado = await postZapi('/send-image', payload);

  return {
    ...resultado,
    telefone: telefoneNormalizado,
    legenda: legendaNormalizada
  };
}

async function enviarImagemStatus({ imagem, legenda }) {
  const imagemNormalizada = String(imagem || '').trim();
  const legendaNormalizada = String(legenda || '').trim();

  if (!imagemNormalizada) {
    throw new Error('Imagem do Status é obrigatória.');
  }

  validarImagem(imagemNormalizada);

  const payload = {
    image: imagemNormalizada
  };

  if (legendaNormalizada) {
    payload.caption = legendaNormalizada;
  }

  const resultado = await postZapi('/send-image-status', payload);

  return {
    ...resultado,
    legenda: legendaNormalizada
  };
}

async function enviarTexto({ telefone, mensagem }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  const mensagemNormalizada = String(mensagem || '').trim();

  validarTelefone(telefoneNormalizado);
  validarMensagem(mensagemNormalizada);

  const resultado = await postZapi('/send-text', {
    phone: telefoneNormalizado,
    message: mensagemNormalizada
  });

  return {
    ...resultado,
    telefone: telefoneNormalizado,
    mensagem: mensagemNormalizada
  };
}

async function enviarDocumentoPdf({ telefone, documentoBase64, nomeArquivo, legenda }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  const nomeArquivoNormalizado = String(nomeArquivo || 'pedido.pdf').trim() || 'pedido.pdf';
  const legendaNormalizada = String(legenda || '').trim();
  const base64Limpo = String(documentoBase64 || '').trim();

  validarTelefone(telefoneNormalizado);

  if (!base64Limpo) {
    throw new Error('Documento PDF em Base64 é obrigatório.');
  }

  const document = base64Limpo.startsWith('data:')
    ? base64Limpo
    : `data:application/pdf;base64,${base64Limpo}`;

  const payload = {
    phone: telefoneNormalizado,
    document,
    fileName: nomeArquivoNormalizado
  };

  if (legendaNormalizada) {
    payload.caption = legendaNormalizada;
  }

  const resultado = await postZapi('/send-document/pdf', payload);

  return {
    ...resultado,
    telefone: telefoneNormalizado,
    nomeArquivo: nomeArquivoNormalizado,
    legenda: legendaNormalizada
  };
}

async function enviarAcao({ telefone, tipo, conteudo }) {
  const telefoneNormalizado = normalizarTelefone(telefone);
  validarTelefone(telefoneNormalizado);

  const { endpoint, payload } = montarRequisicao(tipo, telefoneNormalizado, conteudo);
  const resultado = await postZapi(endpoint, payload);

  return {
    ...resultado,
    telefone: telefoneNormalizado,
    tipo: normalizarTipoAcao(tipo),
    conteudo: String(conteudo || '').trim()
  };
}

module.exports = {
  TIPOS_VALIDOS,
  normalizarTelefone,
  normalizarTipoAcao,
  enviarTexto,
  enviarDocumentoPdf,
  enviarImagem,
  enviarImagemStatus,
  verificarConexao,
  enviarAcao,
  montarRequisicao,
  postZapi
};
