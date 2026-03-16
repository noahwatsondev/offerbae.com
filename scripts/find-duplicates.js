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

const findDuplicates = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    console.log('--- Searching for duplicates of Canadapetcare ---');
    snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.name || '').toLowerCase().includes('canadapetcare') || doc.id.includes('39866')) {
            console.log(`Doc ID: ${doc.id}`);
            console.log(`Data:`, JSON.stringify(data, null, 2));
            console.log('---');
        }
    });
};

findDuplicates().catch(console.error);
