const pedidosLegadoService = require('../../services/pedidos/pedidosLegado.service');

function textoOuVazio(valor) {
  return String(valor || '').trim();
}

async function pesquisarPedidos(req, res) {
  try {
    const numero = textoOuVazio(req.query.numero);
    const cliente = textoOuVazio(req.query.cliente);
    const data = textoOuVazio(req.query.data);

    if (!numero && !cliente && !data) {
      return res.status(400).json({
        success: false,
        message: 'Informe pelo menos um filtro: número, cliente ou data.'
      });
    }

    const rows = await pedidosLegadoService.pesquisarPedidos({
      numero,
      cliente,
      data
    });

    const dataResponse = rows.map((row) => ({
      idMestre: row.IDMESTRE ?? row.idmestre,
      saida: row.SAIDA ?? row.saida ?? row.IDMESTRE ?? row.idmestre,
      numero: row.NUMERO ?? row.numero,
      data: row.DATA ?? row.data,
      total: row.TOTAL ?? row.total,
      obs: row.OBS ?? row.obs,
      empresa: row.EMPRESA ?? row.empresa ?? -1,
      pdv: row.PDV ?? row.pdv ?? 0,
      volumes: Number(row.VOLUMES ?? row.volumes ?? 0),
      vendedor: {
        favorecido: row.VENDEDOR ?? row.vendedor,
        nome: row.V_NOME ?? row.v_nome
      },
      cliente: {
        nome: row.F_NOME ?? row.f_nome,
        cidade: row.F_CIDADE ?? row.f_cidade,
        uf: row.F_UF ?? row.f_uf,
        telefonePrincipal: row.F_TELEFONE_PRINCIPAL ?? row.f_telefone_principal
      }
    }));

    return res.json({
      success: true,
      data: dataResponse
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao pesquisar pedidos.',
      error: error.message
    });
  }
}
async function buscarDetalhePedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const detalhe = await pedidosLegadoService.buscarDetalheEdicaoPedido(idMestre);

    if (!detalhe) {
      return res.status(404).json({
        success: false,
        message: 'Pedido não encontrado.'
      });
    }

    return res.json({
      success: true,
      data: detalhe
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar detalhe do pedido.',
      error: error.message
    });
  }
}

async function buscarItensPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const detalhe = await pedidosLegadoService.buscarDetalheEdicaoPedido(idMestre);

    if (!detalhe) {
      return res.status(404).json({
        success: false,
        message: 'Pedido não encontrado.'
      });
    }

    return res.json({
      success: true,
      data: {
        carradaAtual: detalhe.carradaAtual || null,
        itens: Array.isArray(detalhe.itens) ? detalhe.itens : []
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar itens do pedido.',
      error: error.message
    });
  }
}


async function listarCarradasDisponiveis(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.listarCarradasDisponiveisParaPedido(idMestre);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao listar carradas disponíveis para o pedido.',
      error: error.message
    });
  }
}

async function alterarCarradaPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.alterarCarradaPedido(idMestre, req.body || {});

    return res.json({
      success: true,
      message: 'Carrada do pedido atualizada com sucesso.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao alterar carrada do pedido.',
      error: error.message
    });
  }
}

async function atualizarVolumesPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.atualizarVolumesPedido(
      idMestre,
      req.body?.volumes
    );

    return res.json({
      success: true,
      message: 'Quantidade de volumes atualizada com sucesso.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao atualizar a quantidade de volumes.',
      error: error.message
    });
  }
}


async function atualizarPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const dado = await pedidosLegadoService.atualizarPedido(idMestre, req.body || {});

    return res.json({
      success: true,
      message: 'Pedido atualizado com sucesso.',
      data: dado
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao atualizar pedido.'
    });
  }
}


async function particionarPedido(req, res) {
  try {
    const { idMestre } = req.params;

    if (!idMestre) {
      return res.status(400).json({
        success: false,
        message: 'Informe o id do pedido.'
      });
    }

    const data = await pedidosLegadoService.particionarPedido(idMestre, req.body || {});

    return res.json({
      success: true,
      message: 'Pedido particionado com sucesso.',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao particionar pedido.',
      error: error.message
    });
  }
}

module.exports = {
  pesquisarPedidos,
  buscarDetalhePedido,
  buscarItensPedido,
  listarCarradasDisponiveis,
  alterarCarradaPedido,
  atualizarVolumesPedido,
  atualizarPedido,
  particionarPedido
};
