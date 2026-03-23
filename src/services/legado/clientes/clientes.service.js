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
    nome: limparTexto(item?.nome),
    telefonePrincipal: limparTexto(item?.telefonePrincipal),
    cidade: limparTexto(item?.cidade),
    uf: limparTexto(item?.uf)
  }));

  return {
    total: parsed.total ?? dados.length,
    dados
  };
}

module.exports = {
  listarClientes
};
