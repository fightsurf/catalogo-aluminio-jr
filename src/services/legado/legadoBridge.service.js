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

function montarHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (process.env.LEGADO_BRIDGE_API_KEY) {
    headers['x-api-key'] = process.env.LEGADO_BRIDGE_API_KEY;
  }

  return headers;
}

async function request(method, path, { query = {}, body } = {}) {
  const response = await fetch(montarUrl(path, query), {
    method,
    headers: montarHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.erro || data?.message || 'Erro ao consumir API do legado');
  }

  return data;
}

async function get(path, query = {}) {
  return request('GET', path, { query });
}

async function post(path, body = {}, query = {}) {
  return request('POST', path, { query, body });
}

async function put(path, body = {}, query = {}) {
  return request('PUT', path, { query, body });
}

async function patch(path, body = {}, query = {}) {
  return request('PATCH', path, { query, body });
}

async function del(path, query = {}) {
  return request('DELETE', path, { query });
}

module.exports = {
  get,
  post,
  put,
  patch,
  delete: del
};
