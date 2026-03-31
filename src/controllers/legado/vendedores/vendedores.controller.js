const vendedoresService = require('../../../services/legado/vendedores/vendedores.service');

async function listarVendedores(req, res) {
  try {
    const resultado = await vendedoresService.listarVendedores();
    return res.status(200).json(resultado);
  } catch (error) {
    console.error('Erro ao consultar vendedores do legado:', error);

    return res.status(500).json({
      erro: 'Erro ao consultar vendedores do sistema legado.',
      detalhe: error.message
    });
  }
}

module.exports = {
  listarVendedores
};
