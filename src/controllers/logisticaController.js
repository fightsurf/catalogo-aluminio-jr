const service = require('../services/logisticaService');

async function vincular(req, res) {
  const { id } = req.params;
  const { codigo_ibge } = req.body;

  if (!codigo_ibge) {
    return res.status(400).json({ error: 'codigo_ibge é obrigatório' });
  }

  try {
    const result = await service.vincularCidade(id, codigo_ibge);

    if (result.rowCount === 0) {
      return res.status(409).json({ message: 'Relacionamento já existe' });
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}

async function cidades(req, res) {
  const { id } = req.params;

  try {
    const dados = await service.listarCidades(id);
    res.json(dados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar cidades' });
  }
}

async function transportadoras(req, res) {
  const { codigo_ibge } = req.params;

  try {
    const dados = await service.listarTransportadorasPorCidade(codigo_ibge);
    res.json(dados);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar transportadoras' });
  }
}

module.exports = {
  vincular,
  cidades,
  transportadoras
};
