const BASE_URL = process.env.LEGADO_BRIDGE_URL;

function montarUrl(path, query = {}) {
  if (!BASE_URL) {
    throw new Error('LEGADO_BRIDGE_URL não configurada no .env');
  }

  const url = new URL(path, BASE_URL);

  Object.entries(query).forEach(([chave, valor]) => {
    if (valor !== undefined && valor !== null && valor !== '') {
      url.searchParams.set(chave, String(valor));
    }
  });

  return url.toString();
}

async function get(path, query = {}) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (process.env.LEGADO_BRIDGE_API_KEY) {
    headers['x-api-key'] = process.env.LEGADO_BRIDGE_API_KEY;
  }

  const response = await fetch(montarUrl(path, query), {
    method: 'GET',
    headers
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Erro ao consumir API do legado');
  }

  return data;
}

module.exports = {
  get
};
