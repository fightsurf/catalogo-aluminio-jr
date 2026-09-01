const chequesService = require('../../../services/legado/cheques/cheques.service');

async function listarCheques(req, res) {
  try {
    const data = await chequesService.listarCheques(req.query || {});
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    console.error('Erro ao consultar cheques do legado:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: 'Erro ao consultar cheques.',
      error: error.message
    });
  }
}

module.exports = {
  listarCheques
};
