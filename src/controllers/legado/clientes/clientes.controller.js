const clientesService = require('../../../services/legado/clientes/clientes.service');

async function listarClientes(req, res) {
  try {
    const dados = await clientesService.listarClientes(req.query || {});

    return res.json({
      sucesso: true,
      total: dados.length,
      dados
    });
  } catch (error) {
    console.error('Erro ao consultar clientes do legado:', error);

    return res.status(500).json({
      sucesso: false,
      erro: 'Erro ao consultar clientes do sistema legado.',
      detalhe: error.message
    });
  }
}

async function buscarCliente(req, res) {
  try {
    const dado = await clientesService.buscarCliente(req.params.favorecido);

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Cliente não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      dado
    });
  } catch (error) {
    console.error('Erro ao buscar cliente do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function criarCliente(req, res) {
  try {
    const dado = await clientesService.criarCliente(req.body || {});

    return res.status(201).json({
      sucesso: true,
      dado
    });
  } catch (error) {
    console.error('Erro ao criar cliente do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function atualizarCliente(req, res) {
  try {
    const dado = await clientesService.atualizarCliente(req.params.favorecido, req.body || {});

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Cliente não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      dado
    });
  } catch (error) {
    console.error('Erro ao atualizar cliente do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function desativarCliente(req, res) {
  try {
    const dado = await clientesService.desativarCliente(req.params.favorecido);

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Cliente não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      mensagem: 'Cliente desativado com sucesso.',
      dado
    });
  } catch (error) {
    console.error('Erro ao desativar cliente do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

async function reativarCliente(req, res) {
  try {
    const dado = await clientesService.reativarCliente(req.params.favorecido);

    if (!dado) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Cliente não encontrado.'
      });
    }

    return res.json({
      sucesso: true,
      mensagem: 'Cliente reativado com sucesso.',
      dado
    });
  } catch (error) {
    console.error('Erro ao reativar cliente do legado:', error);

    return res.status(400).json({
      sucesso: false,
      erro: error.message
    });
  }
}

module.exports = {
  listarClientes,
  buscarCliente,
  criarCliente,
  atualizarCliente,
  desativarCliente,
  reativarCliente
};
