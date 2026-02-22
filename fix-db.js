const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
    console.log('Fetching offers to normalize non-code promo codes...');
    const snapshot = await db.collection('offers').get();
    let count = 0;

    let batches = [];
    let currentBatch = db.batch();
    let currentBatchCount = 0;

    const noCodePattern = /^(no\s+code|none|n\/?a|null|false|0)$/i;
    const looseNoCodePattern = /no\s+(coupon\s+)?code/i;

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const cleanCode = String(data.code || '').trim().toLowerCase();

        if (data.isPromoCode && cleanCode && (noCodePattern.test(cleanCode) || looseNoCodePattern.test(cleanCode))) {
            count++;
            console.log('Fixing:', doc.id, '->', data.code);
            currentBatch.update(doc.ref, {
                code: 'N/A',
                isPromoCode: false
            });
            currentBatchCount++;

            if (currentBatchCount >= 400) {
                batches.push(currentBatch);
                currentBatch = db.batch();
                currentBatchCount = 0;
            }
        }
    });

    if (currentBatchCount > 0) {
        batches.push(currentBatch);
    }

    if (count > 0) {
        console.log('Committing ' + count + ' updates across ' + batches.length + ' batches...');
        for (let b of batches) {
            await b.commit();
        }
        console.log('Database normalization complete!');
    } else {
        console.log('No offers needed fixing.');
    }
    process.exit(0);
}

run().catch(console.error);
