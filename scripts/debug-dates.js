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

const debugDates = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').limit(10).get();
    
    console.log('--- Date Debug ---');
    snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`Brand: ${data.name || doc.id}`);
        console.log(`  System createTime: ${doc.createTime.toDate()}`);
        console.log(`  Custom createdAt:  ${data.createdAt ? data.createdAt.toDate() : 'MISSING'}`);
        console.log(`  Custom updatedAt:  ${data.updatedAt ? data.updatedAt.toDate() : 'MISSING'}`);
        console.log('------------------');
    });
};

debugDates().catch(console.error);
