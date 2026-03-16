const { getEnrichedAdvertisers } = require('../src/services/db');
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initializeApp = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa),
            projectId: sa.project_id
        });
    }
    return firebaseAdmin.firestore();
};

const verify = async () => {
    await initializeApp();
    const advs = await getEnrichedAdvertisers();
    const coffee = advs.find(a => (a.name || '').toLowerCase().includes('electric city'));
    
    if (coffee) {
        console.log(`Brand: ${coffee.name}`);
        console.log(`  Enriched logoUrl: ${coffee.logoUrl}`);
        console.log(`  Manual logo marked: ${coffee.isManualLogo}`);
    } else {
        console.log('Coffe not found in enriched list.');
    }
    process.exit(0);
};

verify().catch(console.error);
