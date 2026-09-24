const service = require('../../services/whatsapp/relatorios-recebidos.service');

async function salvar(req, res) {
  try {
    const registro = await service.salvar(req.body || {});
    return res.status(201).json({ success: true, data: registro });
  } catch (error) {
    console.error('Erro ao salvar relatório WhatsApp:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Não foi possível salvar o relatório.'
    });
  }
}

async function listar(req, res) {
  try {
    const registros = await service.listar({ telefone: req.query.telefone });
    return res.json({ success: true, data: registros });
  } catch (error) {
    console.error('Erro ao listar relatórios WhatsApp:', error);
    return res.status(500).json({
      success: false,
      message: 'Não foi possível carregar os relatórios.'
    });
  }
}

async function excluir(req, res) {
  try {
    const removido = await service.excluir(req.params.id);

    if (!removido) {
      return res.status(404).json({
        success: false,
        message: 'Relatório não encontrado.'
      });
    }

    return res.json({ success: true, id: removido.id });
  } catch (error) {
    console.error('Erro ao excluir relatório WhatsApp:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Não foi possível excluir o relatório.'
    });
  }
}

module.exports = {
  salvar,
  listar,
  excluir
};
