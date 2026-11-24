'use strict';

// Este servidor implementa o ciclo initialize e as mensagens individuais da
// revisão 2025-06-18. Não anunciar revisões só porque têm uma data mais recente.
// 2025-03-26 exige receber batches, que estas rotas não implementam.
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([PROTOCOL_VERSION]);

function failure(code, message) {
  return { ok: false, status: 400, code, message };
}

function isProtocolDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Função pura usada pelos dois endpoints, antes do despacho de ferramentas ou
// do aceite de notificações. message=null/undefined valida só o transporte
// (GET/DELETE); nas chamadas POST, a rota valida primeiro o envelope JSON-RPC.
function validateProtocolRequest(message, headerValue) {
  // A especificação exige HTTP 400 para header explícito inválido ou não
  // suportado. Uma lista/array, string vazia ou espaços não é uma versão.
  if (headerValue !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(headerValue)) {
    return failure(-32602,
      'MCP-Protocol-Version inválido ou não suportado. Versão aceita: ' + PROTOCOL_VERSION + '.');
  }

  // Exceção de compatibilidade intencional ao SHOULD da especificação:
  // aceitamos a omissão do header, como o endpoint já fazia, usando o único
  // contrato implementado. Não alegamos suporte completo a 2025-03-26 nem
  // criamos estado de sessão para inferir uma negociação anterior.
  // https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#protocol-version-header
  if (message?.method === 'initialize') {
    const validId = Object.prototype.hasOwnProperty.call(message, 'id')
      && (typeof message.id === 'string'
        || typeof message.id === 'number' && Number.isSafeInteger(message.id));
    if (!validId) return failure(-32600, 'initialize precisa de um ID JSON-RPC válido.');

    const params = message.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)
        || !isProtocolDate(params.protocolVersion)) {
      return failure(-32602, 'initialize exige params.protocolVersion no formato de data AAAA-MM-DD.');
    }

    // A versão suportada deve ser preservada; outra proposta válida recebe a
    // versão implementada. Cabe ao cliente encerrar se não a suporta.
    // https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#version-negotiation
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(params.protocolVersion)
      ? params.protocolVersion : PROTOCOL_VERSION;
    return { ok: true, protocolVersion };
  }

  return { ok: true, protocolVersion: PROTOCOL_VERSION };
}

module.exports = { PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS, validateProtocolRequest };
