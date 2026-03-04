const EventEmitter = require('events');

/**
 * Emissor de eventos do bot utilizado para comunicar novas mensagens
 * ao servidor WebSocket sem acoplar diretamente os módulos.
 */
const botEvents = new EventEmitter();

module.exports = botEvents;
