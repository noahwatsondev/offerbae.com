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

const healDates = async () => {
    const db = await initializeApp();
    console.log('Fetching advertisers for deep history healing...');
    const snapshot = await db.collection('advertisers').get();
    
    let totalHealed = 0;
    const BATCH_SIZE = 100; // Smaller batches for complex lookups

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const aid = String(data.id);
        const currentCreated = data.createdAt ? data.createdAt.toDate() : doc.createTime.toDate();
        
        let oldestEvidence = currentCreated;

        // 1. Check for old offers
        const o1 = await db.collection('offers').where('advertiserId', '==', aid).get();
        const o2 = await db.collection('offers').where('advertiserId', '==', Number(aid)).get();
        
        [...o1.docs, ...o2.docs].forEach(oDoc => {
            const ct = oDoc.createTime.toDate();
            if (ct < oldestEvidence) oldestEvidence = ct;
        });

        // 2. Check for old products
        const p1 = await db.collection('products').where('advertiserId', '==', aid).limit(10).get();
        const p2 = await db.collection('products').where('advertiserId', '==', Number(aid)).limit(10).get();
        
        [...p1.docs, ...p2.docs].forEach(pDoc => {
            const ct = pDoc.createTime.toDate();
            if (ct < oldestEvidence) oldestEvidence = ct;
        });

        if (oldestEvidence < currentCreated) {
            console.log(`HEALING: [${data.name}] -> ${oldestEvidence.toLocaleDateString()} (was ${currentCreated.toLocaleDateString()})`);
            await doc.ref.update({
                createdAt: oldestEvidence,
                originalAddedAt: oldestEvidence // Backup field just in case
            });
            totalHealed++;
        }
    }

    console.log(`Done! Healed ${totalHealed} advertisers with true historical dates.`);
};

healDates().catch(console.error);
