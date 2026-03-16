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

const findByLogo = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const logo = (data.logoUrl || '').toLowerCase();
        if (logo.includes('74a5076e')) {
            console.log(`FOUND BY LOGO: ${doc.id}`);
            console.log(`  Name: ${data.name}`);
            console.log(`  Network: ${data.network}`);
        }
    });
};

findByLogo().catch(console.error);
