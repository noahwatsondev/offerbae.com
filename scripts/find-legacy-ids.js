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

const findLegacy = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.name || '').toLowerCase().includes('canadapetcare')) {
            console.log(`ID Type: ${typeof data.id} | ID: ${data.id} | Doc: ${doc.id}`);
        }
    });
};

findLegacy().catch(console.error);
