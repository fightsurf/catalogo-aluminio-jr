function extrairItens(texto) {
    const linhas = texto.split('\n');
    const itens = [];
    
    for (let linha of linhas) {
        // Ignorar linhas com "Orçamento" ou "Valor total"
        if (linha.includes('Orçamento') || linha.includes('Valor total')) {
            continue;
        }
        
        // Verificar por × (orçamento format) e extrair nome do produto
        const matchOrcamento = linha.match(/(.*?)(?:\s*R\$)/);
        if (matchOrcamento) {
            itens.push(matchOrcamento[1].trim());
            continue;
        }
        
        // Verificar por + (kit format) e extrair nome do produto
        const matchKit = linha.match(/(.*?)(?:\s*R\$)/);
        if (matchKit) {
            itens.push(matchKit[1].trim());
        }
    }
    
    return itens;
}