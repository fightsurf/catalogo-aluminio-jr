function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function montarUrlClientes(filtros = {}) {
  const baseUrl = limparTexto(process.env.LEGACY_FIREBIRD_API_URL);

  if (!baseUrl) {
    throw new Error('LEGACY_FIREBIRD_API_URL não configurada.');
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

  if (filtros.limite !== undefined && filtros.limite !== null && `${filtros.limite}` !== '') {
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
    throw new Error(`Falha ao consumir API local. Status ${response.status}. Corpo: ${rawBody}`);
  }

  let parsed;

  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    throw new Error('A API local respondeu com JSON inválido.');
  }

  if (!parsed || !Array.isArray(parsed.dados)) {
    throw new Error('A API local respondeu em formato inesperado.');
  }

  return {
    total: parsed.total ?? parsed.dados.length,
    dados: parsed.dados
  };
}

module.exports = {
  listarClientes
};
