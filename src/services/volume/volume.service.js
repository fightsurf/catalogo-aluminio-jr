// Implementation to keep decimal values for individual products and round the final total using Math.ceil

class VolumeService {
    calculateTotalVolume(products) {
        let totalVolume = 0;
        
        products.forEach(product => {
            // Assuming product has a volume property
            totalVolume += product.volume;
        });
        
        return Math.ceil(totalVolume);
    }

    // Other methods can be added here
}

module.exports = new VolumeService();