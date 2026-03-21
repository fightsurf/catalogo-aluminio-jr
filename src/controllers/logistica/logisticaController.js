const service = require('../../services/logistica/logisticaService');

async function vincular(req, res) {
  const { id } = req.params;
  const { codigo_ibge, observacao } = req.body;

  try {
    const result = await service.vincularCidade(id, codigo_ibge, observacao);
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function remover(req, res) {
  const { id, codigo_ibge } = req.params;

  try {
    await service.removerCidade(id, codigo_ibge);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function cidades(req, res) {
  try {
    const { id } = req.params;
    const dados = await service.listarCidades(id);
    res.json(dados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function transportadoras(req, res) {
  try {
    const { codigo_ibge } = req.params;
    const dados = await service.listarTransportadorasPorCidade(codigo_ibge);
    res.json(dados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function buscarCidades(req, res) {
  try {
    const { nome } = req.query;
    const dados = await service.buscarCidadesPorNome(nome);
    res.json(dados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ==========================================
// NOVO: LISTAR CIDADES POR SIGLA DO ESTADO
// ==========================================
async function listarPorEstado(req, res) {
  try {
    const { uf } = req.params;

    if (!uf) {
      return res.status(400).json({ error: 'UF não informada' });
    }

    const dados = await service.listarCidadesPorEstado(uf);
    res.json(dados);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  vincular,
  remover,
  cidades,
  transportadoras,
  buscarCidades,
  listarPorEstado
};
