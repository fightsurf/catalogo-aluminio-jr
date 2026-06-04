const service = require('../../services/fechamento-mensal/fechamento-mensal.service');

async function carregar(req, res) {
  try {
    const data = await service.carregar({
      mes: req.query.mes,
      ano: req.query.ano
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO FECHAMENTO MENSAL:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erro ao carregar fechamento mensal.'
    });
  }
}

module.exports = {
  carregar
};
