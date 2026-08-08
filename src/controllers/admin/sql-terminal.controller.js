const path = require('path');
const service = require('../../services/admin/sql-terminal.service');

function abrirPagina(req, res) {
  return res.sendFile(path.join(__dirname, '../../../views/admin/sql-terminal.html'));
}

async function executarConsulta(req, res) {
  try {
    const sql = String(req.body?.sql || '').trim();
    if (!sql) {
      return res.status(400).json({ success: false, message: 'Informe um comando SELECT.' });
    }

    const data = await service.executarConsulta(sql);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO TERMINAL SQL ADMIN:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao executar consulta SQL.'
    });
  }
}

module.exports = {
  abrirPagina,
  executarConsulta
};
