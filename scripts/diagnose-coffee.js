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

const diagnoseCoffee = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    console.log('--- Diagnosing "Electric City" ---');
    let found = false;
    snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.name || '').toLowerCase().includes('electric city')) {
            found = true;
            console.log(`Document ID: ${doc.id}`);
            console.log(`System createTime: ${doc.createTime.toDate()}`);
            console.log('Data:', JSON.stringify(data, null, 2));
            console.log('------------------');
        }
    });
    
    if (!found) {
        console.log('No records found matching "Electric City".');
    }
};

diagnoseCoffee().catch(console.error);
