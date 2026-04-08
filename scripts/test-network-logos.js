require('dotenv').config({ path: '../.env' });
const axios = require('axios');
const cj = require('../src/services/cj');
const rakuten = require('../src/services/rakuten');
const awin = require('../src/services/awin');

async function checkLogos() {
    console.log('--- RAKUTEN ---');
    try {
        const advs = await rakuten.fetchAdvertisers();
        if (advs.length > 0) {
            console.log('Rakuten adv keys:', Object.keys(advs[0]));
            console.log('Rakuten logo fields:', Object.keys(advs[0]).filter(k => k.toLowerCase().includes('logo') || k.toLowerCase().includes('image')));
        }
    } catch(e) { console.error('Rakuten error:', e.message); }

    console.log('\n--- CJ ---');
    try {
        const token = process.env.CJ_PERSONAL_ACCESS_TOKEN;
        // Search advertisers via graphql
        const gq = `
        {
            advertisers(companyId: "7613984", limit: 1) {
                records {
                    advertiserId
                    advertiserName
                    networkLogo
                    logoUrl
                }
            }
        }`;
        const response = await axios.post('https://platform.cj.com/graphql', { query: gq }, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('CJ raw response:', JSON.stringify(response.data, null, 2));
    } catch (e) {
        console.error('CJ error:', e.message);
    }
    
    console.log('\n--- AWIN ---');
    try {
        const token = process.env.AWIN_ACCESS_TOKEN;
        const publisherId = process.env.AWIN_PUBLISHER_ID;
        const response = await axios.get(
            `https://api.awin.com/publishers/${publisherId}/programmes?relationship=joined`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.data && response.data.length > 0) {
            console.log("AWIN keys:", Object.keys(response.data[0]));
            // look for logo
            console.log('AWIN logo fields:', Object.keys(response.data[0]).filter(k => k.toLowerCase().includes('logo') || k.toLowerCase().includes('image')));
            console.log('Sample AWIN logoUrl:', response.data[0].logoUrl);
        }
    } catch(e) {
        console.error('AWIN error:', e.message);
    }
}
checkLogos();
