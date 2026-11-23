(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PedidoValorEmbutido = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function numero(valor, nome) {
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new Error(`${nome} inválido.`);
    return n;
  }

  function arredondar(valor, casas = 3) {
    const fator = 10 ** casas;
    return Math.round((valor + Number.EPSILON) * fator) / fator;
  }

  function codigo(item) {
    return Number(item.item ?? item.item_legado ?? item.itemLegado) || null;
  }

  function precoBase(item) {
    return numero(item.__valorEmbutido?.precoBase ?? item.preco, 'Preço-base');
  }

  function simular(itens, valor) {
    valor = arredondar(numero(valor, 'Valor a embutir'), 2);
    if (valor <= 0) throw new Error('O produto escolhido precisa ter preço maior que zero.');
    const quantidadeTotal = itens.reduce((soma, item) => {
      const quantidade = numero(item.quantidade, 'Quantidade');
      if (quantidade <= 0) throw new Error('As quantidades devem ser maiores que zero.');
      return soma + quantidade;
    }, 0);
    // Dividir centavos inteiros evita perder meio centavo por ponto flutuante
    // (por exemplo, R$ 20,15 / 2 deve arredondar para R$ 10,08).
    const acrescimoUnitario = quantidadeTotal ? Math.round(Math.round(valor * 100) / quantidadeTotal) / 100 : 0;
    const totalDistribuido = arredondar(quantidadeTotal * acrescimoUnitario, 2);
    return {
      quantidadeTotal: arredondar(quantidadeTotal),
      acrescimoUnitario,
      totalDistribuido,
      diferenca: arredondar(totalDistribuido - valor, 2)
    };
  }

  function serializar(itens, metadata) {
    if (!metadata) return null;
    const linhas = itens.map((item) => {
      const base = precoBase(item);
      const preco = arredondar(numero(item.preco, 'Preço'));
      return {
        item: codigo(item),
        saidaItem: item.saidaItem ?? null,
        sequencia: item.sequencia ?? null,
        quantidade: numero(item.quantidade, 'Quantidade'),
        precoBase: arredondar(base),
        precoAplicado: preco,
        acrescimoUnitario: arredondar(preco - base)
      };
    });
    const quantidadeTotal = arredondar(linhas.reduce((s, linha) => s + linha.quantidade, 0));
    const totalDistribuido = arredondar(linhas.reduce((s, linha) => s + linha.quantidade * linha.acrescimoUnitario, 0), 2);
    return {
      versao: 1,
      produto: { ...metadata.produto },
      valor: metadata.valor,
      quantidadeTotal,
      acrescimoUnitario: linhas[0]?.acrescimoUnitario ?? 0,
      totalDistribuido,
      diferenca: arredondar(totalDistribuido - metadata.valor, 2),
      linhas
    };
  }

  function recalcular(itens, metadata) {
    if (!metadata) return null;
    const resumo = simular(itens, metadata.valor);
    // Calcular tudo antes de alterar a lista: um preço inválido não deixa rateio parcial.
    const precos = itens.map((item) => {
      const base = arredondar(precoBase(item));
      if (base < 0) throw new Error('O preço-base não pode ser negativo. Retire o valor embutido para revisar esse preço.');
      return { base, preco: arredondar(base + resumo.acrescimoUnitario) };
    });
    itens.forEach((item, index) => {
      item.__valorEmbutido = { precoBase: precos[index].base, acrescimoUnitario: resumo.acrescimoUnitario };
      item.preco = precos[index].preco;
    });
    return serializar(itens, { ...metadata, ...resumo });
  }

  function carregar(itens, metadata) {
    if (!metadata) return null;
    if (metadata.versao !== 1 || !Array.isArray(metadata.linhas) || !metadata.linhas.length) {
      throw new Error('Não foi possível conferir o valor embutido. Recarregue o pedido antes de editar.');
    }
    const disponiveis = metadata.linhas.map((linha, index) => ({ linha, index }));
    const planos = itens.map((item, index) => {
      const preco = numero(item.preco, 'Preço');
      const candidatos = disponiveis.filter(({ linha }) => Number(linha.item) === codigo(item));
      // O legado recria os detalhes ao editar. Preferir o conteúdo da linha, não IDs antigos.
      let escolhido = candidatos.find(({ linha }) =>
        Math.abs(Number(linha.precoAplicado) - preco) < 0.00001 &&
        Math.abs(Number(linha.quantidade) - Number(item.quantidade)) < 0.00001);
      if (!escolhido) escolhido = candidatos.find(({ linha }) => Math.abs(Number(linha.precoAplicado) - preco) < 0.00001);
      if (!escolhido && candidatos.length === 1) escolhido = candidatos[0];
      if (!escolhido && candidatos.length > 1) {
        const incrementos = new Set(candidatos.map(({ linha }) => arredondar(Number(linha.acrescimoUnitario))));
        if (incrementos.size === 1) escolhido = candidatos.find((c) => c.index === index) || candidatos[0];
      }
      if (!escolhido) {
        throw new Error('Os itens mudaram desde o rateio. Confira o pedido antes de retirar o valor embutido.');
      }
      disponiveis.splice(disponiveis.indexOf(escolhido), 1);
      const acrescimo = numero(escolhido.linha.acrescimoUnitario, 'Acréscimo');
      const base = arredondar(preco - acrescimo);
      if (base < 0 || acrescimo < 0) throw new Error('O preço atual é incompatível com o valor embutido. Confira o pedido.');
      return { precoBase: base, acrescimoUnitario: acrescimo };
    });
    if (disponiveis.length) throw new Error('Os itens mudaram desde o rateio. Recarregue o pedido antes de editar.');
    itens.forEach((item, index) => { item.__valorEmbutido = planos[index]; });
    return serializar(itens, metadata);
  }

  function aplicar(itens, produto, anterior = null) {
    if (!itens.length) throw new Error('Adicione os itens do pedido antes de embutir um valor.');
    const valor = arredondar(numero(produto.preco ?? produto.valor, 'Preço do produto'), 2);
    const resumo = simular(itens, valor);
    if (resumo.acrescimoUnitario <= 0) {
      throw new Error('O valor dividido pela quantidade fica abaixo de um centavo por unidade. Escolha outro produto ou ajuste as quantidades.');
    }
    if (anterior && itens.some((item) => !item.__valorEmbutido)) carregar(itens, anterior);
    return recalcular(itens, {
      versao: 1,
      produto: {
        id: Number(produto.id) || null,
        itemLegado: Number(produto.item_legado ?? produto.itemLegado) || null,
        nome: String(produto.nome || 'Produto')
      },
      valor
    });
  }

  function definirPreco(item, novoPreco, opcoes = {}) {
    novoPreco = arredondar(numero(novoPreco, 'Preço'));
    const acrescimo = Number(item.__valorEmbutido?.acrescimoUnitario || 0);
    const base = arredondar(opcoes.base ? novoPreco : novoPreco - acrescimo);
    if (base < 0) throw new Error('Esse preço é menor que o acréscimo embutido. Retire o valor embutido antes de reduzir o preço.');
    if (item.__valorEmbutido) item.__valorEmbutido.precoBase = base;
    item.preco = arredondar(base + acrescimo);
    return item.preco;
  }

  function remover(itens, metadata) {
    if (metadata && itens.length && itens.some((item) => !item.__valorEmbutido)) carregar(itens, metadata);
    itens.forEach((item) => {
      if (!item.__valorEmbutido) return;
      item.preco = arredondar(item.__valorEmbutido.precoBase);
      delete item.__valorEmbutido;
    });
    return null;
  }

  return { simular, aplicar, carregar, recalcular, definirPreco, remover, serializar };
});
