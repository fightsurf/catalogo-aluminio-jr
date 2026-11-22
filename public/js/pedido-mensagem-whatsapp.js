(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PedidoMensagemWhatsapp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function moeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  // Mesmo texto para a tela de consulta e o MCP; nenhuma regra comercial duplicada.
  function montarMensagem(pedido) {
    if (!pedido?.numero) return '';
    const linhas = [
      '📦 *Pedido Alumínio JR*',
      `Cliente: *${pedido?.cliente?.nome || '-'}*`,
      `Número do pedido: *${pedido?.numero || '-'}*`,
      `Vendedor: *${pedido?.vendedor?.nome || '-'}*`,
      '-----------------------------------------------'
    ];
    const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
    itens.forEach((item, index) => {
      linhas.push(`- ${item.descricao || '-'}`);
      linhas.push(`- QTD: ${Number(item.quantidade || 0)}`);
      linhas.push(`- Preço: *${moeda(item.preco || 0)}*`);
      linhas.push(`- Subtotal: *${moeda(item.subtotal || 0)}*`);
      if (index < itens.length - 1) linhas.push('');
    });
    if (itens.length) linhas.push('');
    linhas.push(`Total do pedido: *${moeda(pedido?.total || 0)}*`);
    if (pedido?.obs) linhas.push('', `Observação: ${pedido.obs}`);
    return linhas.join('\n');
  }
  return { montarMensagem };
});
