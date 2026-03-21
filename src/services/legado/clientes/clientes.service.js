function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function montarUrlClientes(filtros = {}) {
  const baseUrl = limparTexto(process.env.LEGADO_BRIDGE_URL);

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL não configurada.');
  }

  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/clientes`);

  if (limparTexto(filtros.nome)) {
    url.searchParams.set('nome', limparTexto(filtros.nome));
  }

  if (limparTexto(filtros.cidade)) {
    url.searchParams.set('cidade', limparTexto(filtros.cidade));
  }

  if (limparTexto(filtros.uf)) {
    url.searchParams.set('uf', limparTexto(filtros.uf).toUpperCase());
  }

  if (
    filtros.limite !== undefined &&
    filtros.limite !== null &&
    `${filtros.limite}` !== ''
  ) {
    url.searchParams.set('limite', `${filtros.limite}`);
  }

  return url.toString();
}

async function listarClientes(filtros = {}) {
  const url = montarUrlClientes(filtros);

  console.log('[LEGADO CLIENTES] URL FINAL:', url);
  console.log('[LEGADO CLIENTES] ENV BASE:', process.env.LEGADO_BRIDGE_URL);

  if (typeof fetch !== 'function') {
    throw new Error('fetch não está disponível no ambiente Node do Render.');
  }

  let response;

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });
  } catch (error) {
    throw new Error(`Falha de conexão com a API local: ${error.message}`);
  }

  const rawBody = await response.text();

  console.log('[LEGADO CLIENTES] STATUS:', response.status);
  console.log('[LEGADO CLIENTES] BODY:', rawBody);

  if (!response.ok) {
    throw new Error(`API local respondeu com status ${response.status}. Corpo: ${rawBody}`);
  }

  let parsed;

  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    throw new Error(`API local não respondeu JSON válido. Corpo recebido: ${rawBody}`);
  }

  if (!parsed || !Array.isArray(parsed.dados)) {
    throw new Error(`Formato inesperado da API local. Corpo recebido: ${rawBody}`);
  }

  return {
    total: parsed.total ?? parsed.dados.length,
    dados: parsed.dados
  };
}

module.exports = {
  listarClientes
};
