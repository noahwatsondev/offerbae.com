const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initializeApp = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    if (!fs.existsSync(rootSA)) {
        throw new Error(`Service account file not found at ${rootSA}`);
    }
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa),
            projectId: sa.project_id
        });
    }
    return firebaseAdmin.firestore();
};

const backfill = async () => {
    const db = await initializeApp();
    console.log('Fetching advertisers...');
    const snapshot = await db.collection('advertisers').get();
    console.log(`Found ${snapshot.size} advertisers.`);

    let count = 0;
    let batch = db.batch();
    const BATCH_SIZE = 450;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        // If createdAt doesn't exist in the data, set it from the system createTime
        if (!data.createdAt) {
            const systemCreated = doc.createTime.toDate();
            batch.update(doc.ref, { 
                createdAt: systemCreated,
                updatedAt: data.updatedAt || new Date() // Keep existing updatedAt if possible
            });
            count++;

            if (count % BATCH_SIZE === 0) {
                console.log(`Committing batch of ${BATCH_SIZE}...`);
                await batch.commit();
                batch = db.batch();
            }
        }
    }

    if (count % BATCH_SIZE !== 0) {
        await batch.commit();
    }

    console.log(`Successfully backfilled ${count} advertisers with persistent createdAt dates.`);
};

backfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
