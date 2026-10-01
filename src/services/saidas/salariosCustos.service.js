const legadoBridge = require('../legado/legadoBridge.service');

async function obterSalarios() {
  const resposta = await legadoBridge.get('/api/custos/salarios');
  if (!resposta || resposta.success === false) {
    throw new Error(resposta?.message || 'Não foi possível consultar os salários no Firebird');
  }
  return resposta.data || resposta;
}

module.exports = { obterSalarios };
