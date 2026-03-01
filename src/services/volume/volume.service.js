// Normalize Text Function
function normalizarTexto(texto) {
    return texto.trim().toLowerCase();
}

// Extract Items Function
function extrairItens(produto) {
    let itemRegex = /\b\w+\b/g;
    return produto.match(itemRegex) || [];
}

// Product Search Function
function buscarProduto(produtos, nomeProduto) {
    nomeProduto = normalizarTexto(nomeProduto);
    return produtos.find(produto => normalizarTexto(produto.nome) === nomeProduto);
}

// Calculate Function
function calcular(preco, quantidade, tipo) {
    if (tipo === '×') {
        return preco * quantidade;
    } else if (tipo === '+') {
        return preco + quantidade;
    }
    throw new Error('Tipo inválido');
}

// Proper exports
module.exports = { normalizarTexto, extrairItens, buscarProduto, calcular };