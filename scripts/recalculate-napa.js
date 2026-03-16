const { recalculateAdvertiserCounts } = require('../src/services/dataSync');
const firebaseAdmin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const main = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa)
        });
    }

    console.log('Recalculating NAPA counts...');
    const result = await recalculateAdvertiserCounts('Rakuten', '50383');
    console.log('Result:', result);
    process.exit(0);
};

main().catch(console.error);
