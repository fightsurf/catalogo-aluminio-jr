const vendedoresService = require('../../../services/legado/vendedores/vendedores.service');

async function listarVendedores(req, res) {
  try {
    const dados = await vendedoresService.listarVendedores(req.query || {});

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

async function buscarVendedor(req, res) {
  try {
    const dado = await vendedoresService.buscarVendedor(req.params.favorecido);

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Vendedor não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      dado
    });
  } catch (error) {
    console.error('Erro ao buscar vendedor do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function criarVendedor(req, res) {
  try {
    const dado = await vendedoresService.criarVendedor(req.body || {});

    return res.status(201).json({
      sucesso: true,
      dado
    });
  } catch (error) {
    console.error('Erro ao criar vendedor do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function atualizarVendedor(req, res) {
  try {
    const dado = await vendedoresService.atualizarVendedor(req.params.favorecido, req.body || {});

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Vendedor não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      dado
    });
  } catch (error) {
    console.error('Erro ao atualizar vendedor do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function desativarVendedor(req, res) {
  try {
    const dado = await vendedoresService.desativarVendedor(req.params.favorecido);

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Vendedor não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      mensagem: 'Vendedor desativado com sucesso.',
      dado
    });
  } catch (error) {
    console.error('Erro ao desativar vendedor do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

module.exports = {
  listarVendedores,
  buscarVendedor,
  criarVendedor,
  atualizarVendedor,
  desativarVendedor
};
