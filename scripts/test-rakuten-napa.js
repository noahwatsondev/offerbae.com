const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const rakuten = require('../src/services/rakuten');
const fs = require('fs');

const testNapa = async () => {
    const advertiserId = '50383';
    console.log(`--- Fetching Rakuten Products for NAPA (${advertiserId}) ---`);
    
    try {
        const products = await rakuten.fetchProducts(advertiserId);
        console.log(`Total products fetched via service: ${products.length}`);
        
        if (products.length > 0) {
            console.log('Sample Product:', JSON.stringify(products[0], null, 2));
        } else {
            console.log('No products returned.');
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
};

testNapa().catch(console.error);
