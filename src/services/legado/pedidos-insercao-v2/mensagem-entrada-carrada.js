'use strict';

// Formatação compartilhada pelo aviso da tela e pela prévia confirmada do MCP.
// Este módulo é puro: não consulta pedidos nem envia mensagens.
function texto(valor) { return String(valor ?? '').trim(); }

function formatarDataCarrada(valor) {
  const valorTexto = texto(valor);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(valorTexto);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const data = new Date(valorTexto);
  return Number.isNaN(data.getTime())
    ? (valorTexto || '-')
    : data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function montarMensagemEntradaCarrada({ cliente, numeroPedido, carrada }) {
  return [
    `📦 Pedido: ${numeroPedido}`,
    `Cliente: ${texto(cliente.nome || cliente.razao_social || cliente.fantasia) || '-'}`,
    `Seu pedido entrou na produção da carrada do dia ${formatarDataCarrada(carrada.data)}`,
    `Descrição da carrada: ${texto(carrada.descricao) || '-'}`
  ].join('\n');
}

module.exports = { montarMensagemEntradaCarrada };
