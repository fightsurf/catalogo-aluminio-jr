function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function montarUrlVendedores(filtros = {}) {
  const baseUrl = limparTexto(process.env.LEGADO_BRIDGE_URL);

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL não configurada.');
  }

  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/vendedores`);

  if (limparTexto(filtros.nome)) {
    url.searchParams.set('nome', limparTexto(filtros.nome));
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

async function listarVendedores(filtros = {}) {
  const url = montarUrlVendedores(filtros);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  });

  const rawBody = await response.text();

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

  const dados = parsed.dados.map((item) => ({
    favorecido: item?.favorecido ?? null,
    nome: limparTexto(item?.nome)
  }));

  return {
    total: parsed.total ?? dados.length,
    dados
  };
}

module.exports = {
  listarVendedores
};
