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

const checkBrands = async () => {
    const db = await initializeApp();
    const brands = ['Canadapetcare', 'Stylevana', 'Malin+Goetz'];
    
    console.log('--- Checking Missing Logos ---');
    for (const name of brands) {
        const snapshot = await db.collection('advertisers').get();
        let found = false;
        snapshot.forEach(doc => {
            const data = doc.data();
            if ((data.name || '').toLowerCase().includes(name.toLowerCase())) {
                found = true;
                console.log(`Brand: ${data.name}`);
                console.log(`  ID: ${doc.id}`);
                console.log(`  logoUrl: ${data.logoUrl}`);
                console.log(`  storageLogoUrl: ${data.storageLogoUrl}`);
                console.log(`  isManualLogo: ${data.isManualLogo}`);
                console.log(`  network: ${data.network}`);
                console.log('---');
            }
        });
        if (!found) console.log(`Brand ${name} not found.`);
    }
};

checkBrands().catch(console.error);
