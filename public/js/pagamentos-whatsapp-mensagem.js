'use strict';

// Formato único do botão preto de pagamentos, reutilizado no desktop, mobile e MCP.
// A origem dos valores é sempre a consulta de pagamentos do legado.
(function (raiz, criar) {
  const modulo = criar();
  if (typeof module !== 'undefined' && module.exports) module.exports = modulo;
  if (raiz) raiz.PagamentosWhatsappMensagem = modulo;
})(typeof window !== 'undefined' ? window : null, function () {
  function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatarData(valor) {
    if (!valor) return '-';
    const bruto = String(valor);
    const iso = bruto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? bruto : data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  function montarMensagem({ pedido, resumo, pagamentos } = {}) {
    if (!pedido || !resumo) return '';
    const linhas = [
      '💰 *Relatório de pagamentos*',
      'Cliente: *' + (pedido.cliente?.nome || '-') + '*',
      'Número do pedido: *' + (pedido.numero || '-') + '*',
      '-----------------------------------------------',
      'Valor do pedido: *' + formatarMoeda(resumo.totalVenda) + '*'
    ];
    (Array.isArray(pagamentos) ? pagamentos : []).forEach((pagamento) => {
      const data = formatarData(pagamento.condicao === 'C' ? pagamento.dataVencimento : pagamento.dataPgto);
      linhas.push('\n- ' + data + ': *' + formatarMoeda(pagamento.valor) + '*');
    });
    linhas.push('\nTotal pago: *' + formatarMoeda(resumo.totalPago) + '*');
    if (resumo.baixadoParaCredito) {
      linhas.push('\nStatus: *Baixa para crédito*');
      linhas.push('\nValor baixado para crédito: *' + formatarMoeda(resumo.valorBaixadoParaCredito || 0) + '*');
      linhas.push('\nSaldo do pedido: *R$ 0,00*');
    } else {
      linhas.push('\nRestante a pagar: *' + formatarMoeda(resumo.saldoRestante) + '*');
    }
    return linhas.join('\n');
  }

  return { montarMensagem, formatarMoeda, formatarData };
});
