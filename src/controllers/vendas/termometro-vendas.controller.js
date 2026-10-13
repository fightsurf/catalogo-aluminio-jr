const service = require('../../services/termometro/termometro-vendas.service');
const painelService = require('../../services/termometro/termometro-painel.service');

async function carregarTermometro(req, res) {
  try {
    const data = await service.carregarTermometro({
      mes: req.query.mes,
      ano: req.query.ano
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO TERMÔMETRO DE VENDAS:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar o Termômetro de Vendas.'
    });
  }
}


async function carregarHistoricoProduto(req, res) {
  try {
    const data = await service.carregarHistoricoProduto({
      produtoId: req.params.produtoId,
      mes: req.query.mes,
      ano: req.query.ano,
      meses: req.query.meses
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO HISTÓRICO DO TERMÔMETRO DE VENDAS:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar o histórico do produto.'
    });
  }
}

async function listarConfiguracaoPainel(req, res) {
  try {
    const data = await painelService.listarConfiguracao();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Erro na configuração do Termômetro:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function salvarConfiguracaoPainel(req, res) {
  try {
    const data = await painelService.salvarConfiguracao(req.body?.selecionados);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Erro ao salvar configuração do Termômetro:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

async function carregarPainelSimplificado(req, res) {
  try {
    const data = await painelService.carregarPainel();
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Erro ao carregar painel simplificado do Termômetro:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  carregarTermometro,
  carregarHistoricoProduto,
  listarConfiguracaoPainel,
  salvarConfiguracaoPainel,
  carregarPainelSimplificado
};
