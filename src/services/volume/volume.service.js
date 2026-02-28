// Function to normalize text
function normalizarTexto(texto) {
    return texto.trim().toLowerCase();
}

// Function to extract items from a given list
function extrairItens(lista) {
    return lista.filter(item => item !== null && item !== undefined);
}

// Function to find a product in a given array
function buscarProduto(produtos, id) {
    return produtos.find(produto => produto.id === id);
}

// Function to calculate volumes
function calcular(produtos) {
    let total_volumes = 0;
    const volumes = produtos.map(produto => {
        const volume = produto.altura * produto.largura * produto.profundidade;
        total_volumes += volume;
        return volume;
    });
    total_volumes = Math.ceil(total_volumes);
    return { volumes, total_volumes };
}

export { normalizarTexto, extrairItens, buscarProduto, calcular };