'use strict';

// Recebimento direto da Z-API. Não executa comandos, fluxos nem envio de mensagens.
const pool = require('../../../db/connection');
const botEvents = require('../bot/botEvents');
const monitor = require('./zapi-webhook-monitor.service');
const vinculos = require('./zapi-lid-vinculos.service');

const comandos = require('./whatsapp-comandos-jr.service');
const temporarias = require('./whatsapp-conversas-temporarias.service');
const fluxo = require('../bot/botFluxo.services');
const vistos = new Map();

// A nova integração não cria tabelas de mensagens.
async function prepararEstrutura() { return true; }

function textoLimitado(valor, tamanho = 50000) {
  return typeof valor === 'string' ? valor.trim().slice(0, tamanho) : '';
}

// O payload chega diretamente da Z-API, sem o wrapper "body" criado pelo n8n.
function normalizarMensagem(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ignorar: 'payload_invalido' };
  }
  if (payload.fromMe !== false && payload.fromMe !== true) return { ignorar: 'origem_nao_informada' };
  if (payload.type && String(payload.type).toLowerCase() !== 'receivedcallback') {
    return { ignorar: 'outro_evento' };
  }
  if (payload.isStatusReply === true || payload.waitingMessage === true ||
      payload.notification || payload.isEdit === true) {
    return { ignorar: 'evento_nao_conversacional' };
  }

  const telefone = textoLimitado(payload.phone, 120);
  const instancia = textoLimitado(payload.instanceId, 120);
  const messageId = textoLimitado(payload.messageId, 250);
  if (!telefone || !instancia || !messageId) return { ignorar: 'identificacao_incompleta' };

  let tipo;
  let mensagem;
  if (typeof payload.text?.message === 'string' && payload.text.message.trim()) {
    tipo = 'texto';
    mensagem = payload.text.message;
  } else if (payload.audio) {
    tipo = 'audio';
    mensagem = 'Áudio recebido';
  } else if (payload.image) {
    tipo = 'imagem';
    mensagem = 'Imagem recebida';
    if (typeof payload.image.caption === 'string' && payload.image.caption.trim()) {
      mensagem += ': ' + payload.image.caption;
    }
  } else if (payload.video) {
    tipo = 'video';
    mensagem = 'Vídeo recebido';
  } else if (payload.document) {
    tipo = 'documento';
    mensagem = 'Documento recebido';
  } else if (payload.sticker) {
    tipo = 'figurinha';
    mensagem = 'Figurinha recebida';
  } else if (payload.location) {
    tipo = 'localizacao';
    mensagem = 'Localização recebida';
  } else if (payload.contact || payload.contacts) {
    tipo = 'contato';
    mensagem = 'Contato recebido';
  } else if (payload.buttonsResponseMessage?.message) {
    tipo = 'texto';
    mensagem = payload.buttonsResponseMessage.message;
  } else if (payload.listResponseMessage?.message) {
    tipo = 'texto';
    mensagem = payload.listResponseMessage.message;
  } else if (payload.hydratedTemplate?.message) {
    tipo = 'texto';
    mensagem = payload.hydratedTemplate.message;
  } else {
    return { ignorar: 'tipo_nao_suportado' };
  }

  mensagem = textoLimitado(mensagem);
  if (!mensagem) return { ignorar: 'conteudo_vazio' };
  return { telefone, instancia, messageId, tipo, mensagem, direcao: payload.fromMe ? 'SAIDA' : 'ENTRADA' };
}

// Deduplique callbacks sem gravar qualquer texto no banco.
function reivindicarEvento(instancia, messageId) {
  const agora = Date.now();
  for (const [chave, t] of vistos) if (agora - t > 3600000) vistos.delete(chave);
  const chave = instancia + ':' + messageId;
  if (vistos.has(chave)) return null;
  vistos.set(chave, agora);
  return chave;
}

async function auditar(payload, dados, estado, motivo) {
  try {
    await monitor.registrarEvento({ payload, dados, estado, motivo });
  } catch (err) {
    console.error('[Webhook Z-API] Falha no monitor efemero:', err.message);
  }
  botEvents.emit('webhook_recebido', { telefone: dados.telefone || payload?.phone || '' });
}

async function registrar(payload) {
  const dados = normalizarMensagem(payload);
  if (dados.ignorar) {
    await auditar(payload, {}, 'ignorada', dados.ignorar);
    return { salvo: false, motivo: dados.ignorar };
  }
  const instanciaPermitida = vinculos.instanciaAtual();
  // A identidade da fábrica precisa estar configurada antes de executar comandos.
  if (!instanciaPermitida || dados.instancia !== instanciaPermitida) {
    await auditar(payload, dados, 'ignorada', 'instancia_nao_permitida');
    return { salvo: false, motivo: 'instancia_nao_permitida' };
  }
  if (payload.isGroup === true || payload.isNewsletter === true) {
    return { salvo: false, motivo: 'conversa_coletiva' };
  }

  const chave = reivindicarEvento(dados.instancia, dados.messageId);
  if (!chave) {
    await auditar(payload, dados, 'duplicada', 'message_id_repetido');
    return { salvo: false, motivo: 'duplicada' };
  }
  let contatoNovo = false;
  try {
    // Conciliar o LID antes de registrar o telefone permanente.
    dados.telefone = await vinculos.resolverRecebimento(payload);
    if (dados.direcao === 'ENTRADA') {
      const result = await pool.query(`INSERT INTO bot_contatos
        (telefone, criado_em, atualizado_em, fluxo_primeiro_contato_enviado)
        VALUES ($1, NOW(), NOW(), true)
        ON CONFLICT (telefone) DO NOTHING RETURNING id`, [dados.telefone]);
      contatoNovo = result.rowCount > 0 && /^\d{10,15}$/.test(dados.telefone);
      // Não gravar ultima_mensagem nem conteúdo em bot_mensagens.
      await pool.query('UPDATE bot_contatos SET atualizado_em=NOW() WHERE telefone=$1', [dados.telefone]);
    }
    // Apenas clientes realmente novos recebem a saudação já configurada no bot.
    if (contatoNovo) {
      fluxo.executarFluxo(dados.telefone, 'PRIMEIRO_CONTATO').catch(err =>
        console.error('[Webhook Z-API] Falha ao saudar contato:', err.message));
    }
    temporarias.publicar(dados);
    if (dados.direcao === 'SAIDA') {
      await comandos.executar(payload, dados);
    }
    await auditar(payload, dados, 'registrada', '');
    return { salvo: false, motivo: 'entregue_em_tempo_real', contato_novo: contatoNovo };
  } catch (err) {
    vistos.delete(chave);
    await auditar(payload, dados, 'erro', 'falha_processamento');
    throw err;
  }
}

module.exports = { normalizarMensagem, registrar, prepararEstrutura };
