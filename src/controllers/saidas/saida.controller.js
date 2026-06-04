const service = require('../../services/saidas/saida.service');

async function listar(req, res) {
  try {
    const data = await service.listar(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('ERRO LISTAR SAÍDAS:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

async function buscar(req, res) {
  try {
    const data = await service.buscar(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.message === 'Lançamento de saída não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function criar(req, res) {
  try {
    const data = await service.criar(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function criarCarne(req, res) {
  try {
    const data = await service.criarCarne(req.body);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function atualizar(req, res) {
  try {
    const data = await service.atualizar(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error) {
    const status = error.message === 'Lançamento de saída não encontrado' ? 404 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
}

async function excluir(req, res) {
  try {
    await service.excluir(req.params.id);
    res.json({ success: true, message: 'Lançamento de saída removido com sucesso' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function relatorioMensal(req, res) {
  try {
    const data = await service.relatorioMensal(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}


async function relatorioMediasAnuais(req, res) {
  try {
    const data = await service.relatorioMediasAnuais(req.query);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function faltantesRecorrentes(req, res) {
  try {
    const mes = req.query.mes || req.query.competencia_mes;
    const ano = req.query.ano || req.query.competencia_ano;
    const data = await service.faltantesRecorrentes(Number(mes), Number(ano));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

async function comparativoMes(req, res) {
  try {
    const mes = req.query.mes || req.query.competencia_mes;
    const ano = req.query.ano || req.query.competencia_ano;
    const data = await service.comparativoMes(Number(mes), Number(ano));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

module.exports = {
  listar,
  buscar,
  criar,
  criarCarne,
  atualizar,
  excluir,
  relatorioMensal,
  relatorioMediasAnuais,
  faltantesRecorrentes,
  comparativoMes
};
