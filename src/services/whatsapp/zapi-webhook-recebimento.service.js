'use strict';

// Recebimento direto da Z-API. Não executa comandos, fluxos nem envio de mensagens.
const pool = require('../../../db/connection');
const botEvents = require('../bot/botEvents');

let schemaPromise;

function prepararEstrutura() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query('ALTER TABLE bot_mensagens ADD COLUMN IF NOT EXISTS zapi_instancia TEXT');
      await pool.query('ALTER TABLE bot_mensagens ADD COLUMN IF NOT EXISTS zapi_message_id TEXT');
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_bot_mensagens_zapi_evento
        ON bot_mensagens(zapi_instancia, zapi_message_id)
        WHERE zapi_message_id IS NOT NULL`);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function textoLimitado(valor, tamanho = 50000) {
  return typeof valor === 'string' ? valor.trim().slice(0, tamanho) : '';
}

// O payload chega diretamente da Z-API, sem o wrapper "body" criado pelo n8n.
function normalizarMensagem(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ignorar: 'payload_invalido' };
  }
  if (payload.fromMe !== false) return { ignorar: 'nao_e_mensagem_recebida' };
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
  return { telefone, instancia, messageId, tipo, mensagem };
}

async function registrar(payload) {
  const dados = normalizarMensagem(payload);
  if (dados.ignorar) return { salvo: false, motivo: dados.ignorar };

  // Caso configurado, impede a mistura acidental de instâncias distintas.
  const instanciaPermitida = String(process.env.ZAPI_WEBHOOK_INSTANCE_ID || '').trim();
  if (instanciaPermitida && dados.instancia !== instanciaPermitida) {
    return { salvo: false, motivo: 'instancia_nao_permitida' };
  }

  await prepararEstrutura();
  const client = await pool.connect();
  let gravada = false;
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO bot_contatos
       (telefone, criado_em, atualizado_em, fluxo_primeiro_contato_enviado)
       VALUES ($1, NOW(), NOW(), false)
       ON CONFLICT (telefone) DO NOTHING`, [dados.telefone]);

    const insercao = await client.query(`INSERT INTO bot_mensagens
      (telefone, mensagem, tipo, direcao, processada_ia, criada_em,
       zapi_instancia, zapi_message_id)
      VALUES ($1, $2, $3, 'ENTRADA', true, NOW(), $4, $5)
      ON CONFLICT DO NOTHING RETURNING id`,
    [dados.telefone, dados.mensagem, dados.tipo, dados.instancia, dados.messageId]);

    gravada = insercao.rows.length > 0;
    if (gravada) {
      await client.query(`UPDATE bot_contatos
         SET ultima_mensagem = $1, atualizado_em = NOW()
         WHERE telefone = $2`, [dados.mensagem, dados.telefone]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Somente atualizar o painel; nunca acionar botAutonomia nesta etapa.
  if (gravada) botEvents.emit('nova_mensagem', {
    telefone: dados.telefone, somentePainel: true
  });
  return { salvo: gravada, motivo: gravada ? 'registrada' : 'duplicada' };
}

module.exports = { normalizarMensagem, registrar, prepararEstrutura };
