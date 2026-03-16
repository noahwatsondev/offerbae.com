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

const findByUrl = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const url = (data.url || '').toLowerCase();
        if (url.includes('geekbuying')) {
            console.log(`FOUND BY URL: ${doc.id}`);
            console.log(`  Name: ${data.name}`);
            console.log(`  URL: ${data.url}`);
        }
    });
};

findByUrl().catch(console.error);
