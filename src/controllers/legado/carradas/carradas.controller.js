const carradasService = require('../../../services/legado/carradas/carradas.service');
const semanasService = require('../../../services/legado/semanas/semanas.service');

async function listarClientes(req, res) {
  try {
    const data = await carradasService.listarClientes(req.query.nome);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar clientes.', error: error.message });
  }
}

async function listarPedidosPorCliente(req, res) {
  try {
    const data = await carradasService.listarPedidosPorCliente(req.params.favorecido);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por cliente.', error: error.message });
  }
}

async function listarPedidosPorData(req, res) {
  try {
    const data = await carradasService.listarPedidosPorData(req.query.data);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por data.', error: error.message });
  }
}

async function listarPedidosPorNumero(req, res) {
  try {
    const data = await carradasService.listarPedidosPorNumero(req.query.numero);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar pedidos por número.', error: error.message });
  }
}

async function listarCarradas(req, res) {
  try {
    const data = await carradasService.listarCarradas(req.query || {});
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar carradas.', error: error.message });
  }
}

async function listarCarradasDisponiveis(req, res) {
  try {
    const data = await carradasService.listarCarradasDisponiveis(req.params.codigo, req.query.dias);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao listar carradas disponíveis.', error: error.message });
  }
}

async function moverPedidoEntreCarradas(req, res) {
  try {
    const data = await carradasService.moverPedidoEntreCarradas(req.params.codigo, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao mover pedido entre carradas.', error: error.message });
  }
}

async function buscarCarrada(req, res) {
  try {
    const data = await carradasService.buscarCarrada(req.params.codigo);

    if (!data) {
      return res.status(404).json({ success: false, message: 'Carrada não encontrada.' });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao buscar carrada.', error: error.message });
  }
}

async function criarCarrada(req, res) {
  return res.status(409).json({
    success: false,
    message: 'A criação manual de carrada foi desativada. Crie carradas automaticamente pelo módulo de Semanas.'
  });
}

async function atualizarCarrada(req, res) {
  try {
    const data = await carradasService.atualizarCarrada(req.params.codigo, req.body);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erro ao atualizar carrada.', error: error.message });
  }
}

async function excluirCarrada(req, res) {
  try {
    const semanaVinculada = await semanasService.buscarSemanaDaCarrada(req.params.codigo);

    if (semanaVinculada) {
      return res.status(409).json({
        success: false,
        message: `A carrada ${req.params.codigo} está vinculada à semana de ${semanaVinculada.data_inicial} até ${semanaVinculada.data_final}${semanaVinculada.descricao ? ` (${semanaVinculada.descricao})` : ''}. Remova a carrada da semana antes de excluí-la.`
      });
    }

    const data = await carradasService.excluirCarrada(req.params.codigo);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    const status = Number(error?.statusCode || 500);
    return res.status(status).json({ success: false, message: error.message || 'Erro ao excluir carrada.', error: error.message });
  }
}

module.exports = {
  listarClientes,
  listarPedidosPorCliente,
  listarPedidosPorData,
  listarPedidosPorNumero,
  listarCarradas,
  listarCarradasDisponiveis,
  buscarCarrada,
  criarCarrada,
  atualizarCarrada,
  moverPedidoEntreCarradas,
  excluirCarrada
};
