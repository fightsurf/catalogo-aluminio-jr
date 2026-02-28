// Assuming the context of the file, here is the modified logic for the specified functions:

function normalizarTexto(texto) {
    // Replace • with newlines
    const textoComQuebras = texto.replace(/•/g, '\n');
    // Now, remove any other unwanted characters if needed
    // Add existing removal logic here (if any)
    return textoComQuebras;
}

function extrairItens(texto) {
    // Enhanced logic for extracting items from 'formato orçamento'
    const regex = /([\w\s]+)\s*\$\s*([\d,\.]+)/g; // Adjust regex to capture product name better
    const itensExtraidos = [];
    let match;
    while ((match = regex.exec(texto)) !== null) {
        itensExtraidos.push({
            produto: match[1].trim(),
            preco: match[2].trim()
        });
    }
    return itensExtraidos;
}