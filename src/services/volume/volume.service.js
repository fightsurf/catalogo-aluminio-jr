function calcular(products) {
    // Calculate individual volumes
    const volumes = products.map(product => product.volume);
    
    // Use decimal values for individual products, but round total
total_volumes = Math.ceil(volumes.reduce((acc, volume) => acc + volume, 0));
    
    return total_volumes;
}