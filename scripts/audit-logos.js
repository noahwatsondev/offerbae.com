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

const auditLogos = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    let missing = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.logoUrl && !data.storageLogoUrl) {
            missing++;
            console.log(`Missing Logo: ${data.name} (${doc.id})`);
        }
    });
    
    console.log(`--- Total Missing Logos: ${missing} / ${snapshot.size} ---`);
};

auditLogos().catch(console.error);
