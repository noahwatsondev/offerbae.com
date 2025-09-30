const firebase = require('../src/config/firebase');
const { getAdvertiser, upsertAdvertiser } = require('../src/services/db');

// Initialize Firebase (via config side-effect or explicit init if needed)
// The config/firebase.js uses lazy loading, so accessing firebase.db should trigger it if we had the service account.
// But we need to make sure app is initialized.
const admin = firebase.admin;
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: 'offerbae-com'
    });
}

const db = admin.firestore();

const updateCounts = async () => {
    console.log('Starting Count Migration...');

    try {
        const advertisersSnap = await db.collection('advertisers').get();
        const advertisers = [];
        advertisersSnap.forEach(doc => advertisers.push(doc.data()));

        console.log(`Found ${advertisers.length} advertisers to update.`);

        let updated = 0;

        // Process in chunks to avoid memory issues/timeouts if run in cloud functions, 
        // but locally we can just loop with limit concurrency.
        // Let's do chunks of 20
        const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (v, i) => arr.slice(i * size, i * size + size));
        const batches = chunk(advertisers, 20);

        for (const batch of batches) {
            await Promise.all(batch.map(async (adv) => {
                const advId = adv.id;

                // Count Products
                // Try string ID first
                let pCountSnap = await db.collection('products').where('advertiserId', '==', String(advId)).count().get();
                let pCount = pCountSnap.data().count;
                if (pCount === 0) {
                    // Try number ID
                    pCountSnap = await db.collection('products').where('advertiserId', '==', Number(advId)).count().get();
                    pCount = pCountSnap.data().count;
                }

                // Count Offers
                let oCountSnap = await db.collection('offers').where('advertiserId', '==', String(advId)).count().get();
                let oCount = oCountSnap.data().count;
                if (oCount === 0) {
                    // Try number ID
                    oCountSnap = await db.collection('offers').where('advertiserId', '==', Number(advId)).count().get();
                    oCount = oCountSnap.data().count;
                }

                // Update Advertiser Doc
                const docId = `${adv.network}-${adv.id}`.replace(/\//g, '_');
                await db.collection('advertisers').doc(docId).update({
                    productCount: pCount,
                    offerCount: oCount,
                    countsUpdatedAt: new Date()
                });

                // console.log(`Updated ${adv.name}: ${pCount} products, ${oCount} offers.`);
                updated++;
            }));
            console.log(`Processed ${updated} / ${advertisers.length}`);
        }

        console.log('Migration Complete.');
        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

updateCounts();
