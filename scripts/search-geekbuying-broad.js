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

const searchBroad = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const name = (data.name || '').toLowerCase();
        if (name.includes('geekbuying')) {
            console.log(`FOUND: ${doc.id}`);
            console.log(`  Name: ${data.name}`);
            console.log(`  Network: ${data.network}`);
            console.log(`  ID: ${data.id}`);
            console.log(`  Logo: ${data.logoUrl}`);
            console.log(`  Created: ${data.createdAt ? data.createdAt.toDate() : 'MISSING'}`);
        }
    });
};

searchBroad().catch(console.error);
