const {
  gerarRelatorioComAcrescimo
} = require('../../services/vendas/relatorio-acrescimo.service');

async function processarRelatorioComAcrescimo(req, res) {
  try {
    const { relatorio, valorExtra, multiplicador } = req.body;

    if (!relatorio || typeof relatorio !== 'string') {
      return res.status(400).json({
        erro: 'O campo relatorio é obrigatório e precisa ser texto.'
      });
    }

    if (valorExtra === undefined || valorExtra === null || valorExtra === '') {
      return res.status(400).json({
        erro: 'O campo valorExtra é obrigatório.'
      });
    }

    if (multiplicador === undefined || multiplicador === null || multiplicador === '') {
      return res.status(400).json({
        erro: 'O campo multiplicador é obrigatório.'
      });
    }

    const resultado = gerarRelatorioComAcrescimo({
      relatorio,
      valorExtra,
      multiplicador
    });

    return res.status(200).json({
      sucesso: true,
      ...resultado
    });
  } catch (error) {
    return res.status(400).json({
      sucesso: false,
      erro: error.message || 'Erro ao processar relatório com acréscimo.'
    });
  }
}

module.exports = {
  processarRelatorioComAcrescimo
};
