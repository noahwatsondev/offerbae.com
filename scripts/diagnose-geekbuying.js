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

const diagnoseGeekbuying = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    console.log('--- Diagnosing "Geekbuying" ---');
    let found = false;
    snapshot.forEach(doc => {
        const data = doc.data();
        if ((data.name || '').toLowerCase().includes('geekbuying') || doc.id.toLowerCase().includes('geekbuying')) {
            found = true;
            console.log(`Document ID: ${doc.id}`);
            console.log(`System createTime: ${doc.createTime.toDate()}`);
            console.log(`System updateTime: ${doc.updateTime.toDate()}`);
            console.log('Data:', JSON.stringify(data, null, 2));
            console.log('------------------');
            
            // Check for associated offers/products to find true age
            const aid = String(data.id);
        }
    });
    
    if (!found) {
        console.log('No records found matching "Geekbuying".');
    }
};

diagnoseGeekbuying().catch(console.error);
