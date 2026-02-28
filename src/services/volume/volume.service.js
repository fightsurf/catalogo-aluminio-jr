function normalizarTexto(texto) {
  return texto
    // Converter • em quebras de linha PRIMEIRO
    .replace(/•/g, '\n')
    // Remover emojis
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    // Remover caracteres de formatação
    .replace(/[*_~]/g, '')
    // Limpar múltiplos espaços
    .replace(/[ \t]+/g, ' ')
    // Trim e remover linhas vazias
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
}

function extrairItens(texto) {
  const itens = [];
  const normalizado = normalizarTexto(texto);
  const linhas = normalizado.split('\n');

  for (const linha of linhas) {
    // FORMATO ORÇAMENTO: contém ×
    if (linha.includes('×')) {
      const partes = linha.split('×');
      const esquerda = partes[0];
      const direita = partes[1] || '';

      // Extrair quantidade da direita
      const qtyMatch = direita.match(/(\d+)/);
      if (!qtyMatch) continue;
      const quantidade = parseInt(qtyMatch[1]);

      // Limpar nome (remover preço)
      const nome = esquerda
        .replace(/R\$[\s\d.,]+$/, '') // Remove preço
        .replace(/[,;:•]+$/, '')
        .trim();

      if (nome) itens.push({ nome, quantidade });
      continue;
    }

    // FORMATO KIT: contém +
    if (linha.includes('+')) {
      const produtos = linha.split('+');
      for (const produto of produtos) {
        const nome = produto.trim();
        if (nome) itens.push({ nome, quantidade: 1 });
      }
      continue;
    }
  }

  return itens;
}