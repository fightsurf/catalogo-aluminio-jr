'use strict';

// Normalize text by removing extra spaces and transforming to lowercase
function normalizarTexto(texto) {
    return texto.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Extract items from a string
function extrairItens(texto) {
    return normalizarTexto(texto).split(',');
}

// Search for a product in an array
function buscarProduto(produto, listaProdutos) {
    return listaProdutos.find(item => item.nome === produto);
}

// Calculate volume based on the parameters provided
function calcular(dimensions) {
    // Logic for volume calculation goes here...
    // Example: dimensions could be an object { length, width, height }
    return dimensions.length * dimensions.width * dimensions.height;
}

// Export functions for use in other modules
module.exports = {
    normalizarTexto,
    extrairItens,
    buscarProduto,
    calcular
};
