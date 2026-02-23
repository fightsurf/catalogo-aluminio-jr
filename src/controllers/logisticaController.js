const service = require('../services/logisticaService');

async function vincular(req, res) {
  const { id } = req.params;
  const { codigo_ibge } = req.body;

  try {
    const result = await service.vincularCidade(id, codigo_ibge);

    if (result.rowCount === 0) {
      return res.status(409).json({ message: 'Relacionamento já existe' });
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function remover(req, res) {
  const { id, codigo_ibge } = req.params;

  try {
    await service.removerCidade(id, codigo_ibge);
    res.json({ sucesso: true });
  } catch {
    res.status(500).json({ error: 'Erro ao remover cidade' });
  }
}

async function cidades(req, res) {
  const { id } = req.params;
  const dados = await service.listarCidades(id);
  res.json(dados);
}

async function transportadoras(req, res) {
  const { codigo_ibge } = req.params;
  const dados = await service.listarTransportadorasPorCidade(codigo_ibge);
  res.json(dados);
}

async function buscarCidades(req, res) {
  const { nome } = req.query;
  const dados = await service.buscarCidadesPorNome(nome);
  res.json(dados);
}

module.exports = {
  vincular,
  remover,
  cidades,
  transportadoras,
  buscarCidades
};
