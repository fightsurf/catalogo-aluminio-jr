const legadoBridgeService = require('../legado/legadoBridge.service');

async function executarConsulta(sql) {
  const response = await legadoBridgeService.post('/api/sql-terminal/query', { sql });
  return response.dados;
}

module.exports = {
  executarConsulta
};
