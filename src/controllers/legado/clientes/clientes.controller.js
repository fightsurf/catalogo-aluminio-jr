const clientesService = require('../../../services/legado/clientes/clientes.service');

async function listarClientes(req, res) {
  try {
    const resultado = await clientesService.listarClientes({
      nome: req.query.nome,
      cidade: req.query.cidade,
      uf: req.query.uf,
      limite: req.query.limite
    });

    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao consultar clientes do legado:', error);

    return res.status(500).json({
      erro: 'Erro ao consultar clientes do sistema legado.',
      detalhe: error.message
    });
  }
}

module.exports = {
  listarClientes
};
