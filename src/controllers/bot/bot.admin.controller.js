const botAdminService = require('../../services/bot/bot.admin.service');
const monitor = require('../../services/whatsapp/zapi-webhook-monitor.service');
const recebimento = require('../../services/whatsapp/zapi-webhook-recebimento.service');

async function abrirOuCriarConversa(req, res) {
  try {
    const { telefone } = req.body || {};

    const conversa = await botAdminService.abrirOuCriarConversa({ telefone });

    if (!conversa) {
      return res.status(500).json({ success: false, message: 'Não foi possível abrir a conversa.' });
    }

    res.status(201).json({ success: true, conversa });
  } catch (error) {
    const mensagem = error.message || 'Erro ao abrir conversa.';
    const status = /telefone/i.test(mensagem) ? 400 : 500;
    res.status(status).json({ success: false, message: mensagem });
  }
}

async function listarConversas(req, res) {
  try {
    const { page, limit, data_inicio, data_fim, nivel_atendimento, telefone } = req.query;
    const resultado = await botAdminService.listarConversas({
      page,
      limit,
      data_inicio,
      data_fim,
      nivel_atendimento,
      telefone
    });
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarMensagens(req, res) {
  try {
    const { telefone } = req.params;
    const { page, limit } = req.query;

    if (!telefone) {
      return res.status(400).json({ success: false, message: 'Telefone é obrigatório' });
    }

    await recebimento.prepararEstrutura();
    const resultado = await botAdminService.listarMensagens({ telefone, page, limit });
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function listarMonitoramento(req, res) {
  try {
    await recebimento.prepararEstrutura();
    const dados = await monitor.listarRecebimentos({ limite: 100 });
    res.set('Cache-Control', 'no-store');
    return res.json({
      dados,
      total_exibido: dados.length,
      webhook_configurado: String(process.env.ZAPI_WEBHOOK_TOKEN || '').trim().length >= 32,
      atualizado_em: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Bot Admin] Erro ao listar recebimentos:', error.message);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar o monitoramento.' });
  }
}

module.exports = { abrirOuCriarConversa, listarConversas, listarMensagens, listarMonitoramento };
