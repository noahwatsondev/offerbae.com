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
            storageBucket: 'offerbae-com.firebasestorage.app'
        });
    }
    return firebaseAdmin.firestore();
};

const verifyLogos = async () => {
    await initializeApp();
    const advs = await getEnrichedAdvertisers();
    
    const targets = ['Stylevana', 'Canadapetcare', 'Malin+Goetz'];
    
    targets.forEach(t => {
        const found = advs.find(a => (a.name || '').toLowerCase().includes(t.toLowerCase()));
        if (found) {
            console.log(`Brand: ${found.name}`);
            console.log(`  logoUrl: ${found.logoUrl}`);
            console.log(`  storageLogoUrl: ${found.storageLogoUrl}`);
        } else {
            console.log(`Brand ${t} not found in enriched list.`);
        }
    });
    process.exit(0);
};

verifyLogos().catch(console.error);
