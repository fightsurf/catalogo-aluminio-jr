const vendedoresService = require('../../../services/legado/vendedores/vendedores.service');

async function listarVendedores(req, res) {
  try {
    const dados = await vendedoresService.listarVendedores();

    return res.json({
      sucesso: true,
      total: dados.length,
      dados
    });
  } catch (error) {
    console.error('Erro ao consultar vendedores do legado:', error);

    return res.status(500).json({
      sucesso: false,
      erro: 'Erro ao consultar vendedores do sistema legado.',
      detalhe: error.message
    });
  }
}

module.exports = {
  listarVendedores
};
