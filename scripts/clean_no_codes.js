const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

const { isRealCode, recalculateAdvertiserCounts } = require('../src/services/dataSync');

// Initialize Firebase
const serviceAccount = require('../service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

const dryRun = process.env.DRY_RUN === 'true';

async function cleanupNoCodes() {
    console.log(`Starting cleanup... Dry run: ${dryRun}`);

    try {
        const offersSnapshot = await db.collection('offers').get();
        console.log(`Found ${offersSnapshot.size} offers.`);

        let cleanedCount = 0;
        const affectedAdvertisers = new Set();
        const networkAdvertiserPairs = new Set(); // To store combined network and advertiserId

        for (const doc of offersSnapshot.docs) {
            const data = doc.data();
            const originalCode = data.code;

            if (originalCode && !isRealCode(originalCode)) {
                console.log(`[CLEAN] Found "no code" value: "${originalCode}" for offer ${doc.id} (${data.network})`);

                if (!dryRun) {
                    await doc.ref.update({
                        code: null,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                cleanedCount++;
                if (data.advertiserId && data.network) {
                    networkAdvertiserPairs.add(`${data.network}:${data.advertiserId}`);
                }
            }
        }

        console.log(`Cleanup complete. Total cleaned: ${cleanedCount}`);

        if (cleanedCount > 0 && !dryRun) {
            console.log(`Recalculating counts for ${networkAdvertiserPairs.size} advertisers...`);
            for (const pair of networkAdvertiserPairs) {
                const [network, advertiserId] = pair.split(':');
                console.log(`Recalculating for ${network} - ${advertiserId}...`);
                await recalculateAdvertiserCounts(network, advertiserId);
            }
        } else if (dryRun) {
            console.log(`Dry run: skipping recalculation for ${networkAdvertiserPairs.size} advertisers.`);
        }

    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

cleanupNoCodes().then(() => {
    console.log('Script finished.');
    process.exit(0);
}).catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
