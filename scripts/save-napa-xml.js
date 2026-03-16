const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const config = require('../src/config/env');
const fs = require('fs');

const getRakutenToken = async () => {
    const tokenKey = Buffer.from(`${config.rakuten.clientId}:${config.rakuten.clientSecret}`).toString('base64');
    const response = await axios.post(
        'https://api.linksynergy.com/token',
        `scope=${config.rakuten.siteId}`,
        {
            headers: {
                'Authorization': `Bearer ${tokenKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    return response.data.access_token;
};

const testNapaRaw = async () => {
    const token = await getRakutenToken();
    const mid = '50383';
    console.log(`--- Fetching NAPA XML to /tmp/napa_test.xml ---`);
    
    try {
        const response = await axios.get(
            `https://api.linksynergy.com/productsearch/1.0?mid=${mid}&max=10`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );
        
        fs.writeFileSync('/tmp/napa_test.xml', response.data);
        console.log('Saved XML to /tmp/napa_test.xml');

    } catch (e) {
        console.error('API Error:', e.response ? e.response.data : e.message);
    }
};

testNapaRaw().catch(console.error);
