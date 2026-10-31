'use strict';
const botEvents = require('../bot/botEvents');

// Cada painel administra o proprio historico em memoria do navegador.
// O servidor nunca persiste conteudos de mensagens deste fluxo.
function publicar(dados) {
  botEvents.emit('mensagem_ao_vivo', {
    telefone: String(dados.telefone || ''),
    mensagem: String(dados.mensagem || ''),
    tipo: String(dados.tipo || 'texto'),
    direcao: dados.direcao === 'SAIDA' ? 'SAIDA' : 'ENTRADA',
    criada_em: new Date().toISOString(),
    zapi_message_id: null,
    processada_ia: true
  });
}
module.exports = { publicar };
