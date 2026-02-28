function normalizarTexto(texto) {
    return texto.trim().toLowerCase();
}

function extrairItens(produtos) {
    return produtos.map(produto => {
        return {
            nome: normalizarTexto(produto.nome),
            volume: parseFloat(produto.volume).toFixed(2) // Keep decimal values for each product volume
        };
    });
}

function buscarProduto(nome, produtos) {
    const nomeNormalizado = normalizarTexto(nome);
    return produtos.find(produto => produto.nome === nomeNormalizado) || null;
}

function calcular(produtos) {
    const volumes = extrairItens(produtos);
    const totalVolumes = volumes.reduce((total, produto) => total + parseFloat(produto.volume), 0);
    return Math.ceil(totalVolumes); // Round only the final total_volumes
}

module.exports = {
    normalizarTexto,
    extrairItens,
    buscarProduto,
    calcular
};