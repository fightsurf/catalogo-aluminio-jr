function getBridgeBaseUrl() {
  return (
    process.env.LEGADO_BRIDGE_URL ||
    process.env.LEGACY_FIREBIRD_API_URL ||
    ''
  ).replace(/\/$/, '');
}

async function inserirPedido(payload) {
  const baseUrl = getBridgeBaseUrl();

  if (!baseUrl) {
    throw new Error('LEGADO_BRIDGE_URL ou LEGACY_FIREBIRD_API_URL não configurada.');
  }

  const response = await fetch(`${baseUrl}/api/pedidos-insercao`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.detalhe || data?.erro || `Falha HTTP ${response.status}`);
  }

  return data;
}

module.exports = {
  inserirPedido
};
