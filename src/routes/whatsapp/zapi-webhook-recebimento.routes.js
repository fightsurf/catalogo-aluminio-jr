'use strict';

const express = require('express');
const crypto = require('crypto');
const recebimento = require('../../services/whatsapp/zapi-webhook-recebimento.service');
const transcricoesPiloto = require('../../services/whatsapp/transcricoes-piloto.service');
const intencoesAdmin = require('../../services/whatsapp/intencoes-admin.service');
const vinculos = require('../../services/whatsapp/zapi-lid-vinculos.service');
const router = express.Router();

// A Z-API permite configurar a URL do webhook, incluindo um parâmetro de consulta.
// O segredo é definido apenas em ZAPI_WEBHOOK_TOKEN no Render (nunca no GitHub).
function autenticar(req, res, next) {
  const esperado = String(process.env.ZAPI_WEBHOOK_TOKEN || '').trim();
  if (esperado.length < 32) {
    return res.status(503).json({ success: false, message: 'Webhook ainda não configurado.' });
  }

  const enviado = typeof req.query.chave === 'string'
    ? req.query.chave : String(req.get('x-zapi-webhook-token') || '');
  const a = Buffer.from(enviado);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ success: false, message: 'Credencial inválida.' });
  }
  next();
}

// Checagem simples de implantação, sem inserir registros.
router.get('/zapi', autenticar, (_req, res) => res.json({
  success: true, webhook: 'zapi-recebimento', configurado: true
}));

router.post('/zapi', autenticar, async (req, res) => {
  try {
    // O piloto deve iniciar antes das tarefas do bot, que podem depender do banco
    // ou de outros serviços. Não modifica o atendimento nem espera pela transcrição.
    const payload = req.body;
    transcricoesPiloto.observarWebhook(payload);
    const dadosPiloto = recebimento.normalizarMensagem(payload);
    if (dadosPiloto.ignorar) {
      transcricoesPiloto.marcarLid(payload, 'evento_ignorado');
    } else if (dadosPiloto.tipo === 'audio') {
      if (!vinculos.instanciaAtual() || dadosPiloto.instancia !== vinculos.instanciaAtual()) {
        transcricoesPiloto.marcarLid(payload, 'instancia_divergente');
      } else if (payload.isGroup === true || payload.isNewsletter === true) {
        transcricoesPiloto.marcarLid(payload, 'conversa_coletiva');
      } else {
        void transcricoesPiloto.receberVerificandoLid({ payload, dados: dadosPiloto }).catch(erro => {
          transcricoesPiloto.marcarLid(payload, 'erro_inesperado');
          console.error('[Piloto transcrição] Falha ao verificar evento:', erro.message);
        });
      }
    }
    // Texto próprio: aceita telefone ou LID previamente vinculado após verificação
    // da Z-API. Exclui mensagens para terceiros e respostas enviadas pela API.
    if (!dadosPiloto.ignorar && dadosPiloto.tipo === 'texto' &&
        dadosPiloto.direcao === 'SAIDA' && payload.fromMe === true &&
        payload.fromApi !== true && !payload.isGroup && !payload.isNewsletter &&
        dadosPiloto.instancia === vinculos.instanciaAtual()) {
      void (async () => {
        const conectado = vinculos.limparTelefone(payload.connectedPhone);
        const eLid = vinculos.ehLid(dadosPiloto.telefone);
        // LID só pode ser interpretado com a própria linha conectada autenticada.
        if (eLid && !transcricoesPiloto.podeReceber(conectado)) return;
        const telefone = eLid
          ? await vinculos.resolverRecebimento(payload)
          : dadosPiloto.telefone;
        if (!transcricoesPiloto.podeReceber(telefone)) return;
        if (conectado &&
            (!transcricoesPiloto.podeReceber(conectado) ||
              conectado.slice(-8) !== String(telefone).replace(/\D/g, '').slice(-8))) return;
        await intencoesAdmin.processarMensagem({
          telefone: String(telefone).replace(/\D/g, ''),
          texto: dadosPiloto.mensagem,
          permitido: true
        });
      })().catch(e => console.error('[Intenções administrativas] Falha em texto:', e.message));
    }
    const resultado = await recebimento.registrar(payload);
    return res.status(200).json({ success: true, ...resultado });
  } catch (error) {
    // Nunca registrar o payload nem as credenciais nos logs.
    console.error('[Webhook Z-API] Falha ao registrar mensagem:', error.message);
    return res.status(500).json({ success: false, message: 'Falha no registro.' });
  }
});

// Encaminhamento opcional do n8n: não aciona comandos nem fluxos do bot.
router.post('/zapi/transcricao-piloto', autenticar, async (req, res) => {
  try {
    const payload = req.body?.body?.instanceId ? req.body.body : req.body;
    const dados = recebimento.normalizarMensagem(payload);
    const instancia = vinculos.instanciaAtual();
    if (dados.ignorar || dados.tipo !== 'audio' || !instancia || dados.instancia !== instancia) {
      return res.json({ success: true, aceito: false });
    }
    if (dados.telefone.includes('@lid')) {
      dados.telefone = await vinculos.resolverRecebimento(payload);
    }
    transcricoesPiloto.observarWebhook(payload);
    const aceito = await transcricoesPiloto.receberVerificandoLid({ payload, dados });
    return res.json({ success: true, aceito });
  } catch (error) {
    console.error('[Piloto transcrição] Falha no encaminhamento:', error.message);
    return res.status(500).json({ success: false, message: 'Falha no recebimento do piloto.' });
  }
});

module.exports = router;
