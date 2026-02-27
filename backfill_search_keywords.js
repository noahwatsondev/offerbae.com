/**
 * backfill_search_keywords.js
 * 
 * Scans advertisers and products in Firestore and populates the `searchKeywords` field
 * using the same logic added to dataSync.js. Uses streaming for memory efficiency.
 */

require('dotenv').config({ override: true });
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const localCred = path.join(__dirname, 'service-account.json');
if (fs.existsSync(localCred)) credentialPath = localCred;

if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credentialPath),
        projectId: process.env.GCP_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
}
const db = firebaseAdmin.firestore();

const generateSearchKeywords = (text) => {
    if (!text) return [];
    const keywords = new Set();
    const clean = String(text).toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const words = clean.split(/\s+/).filter(w => w.length >= 2);

    words.forEach(word => {
        keywords.add(word);
        if (word.length >= 3) {
            for (let i = 0; i <= word.length - 3; i++) {
                for (let len = 3; len <= 15 && i + len <= word.length; len++) {
                    keywords.add(word.substring(i, i + len));
                }
            }
        }
    });
    return Array.from(keywords);
};

async function backfillCollection(collectionName, nameField) {
    console.log(`\n[Backfill] Starting ${collectionName}...`);

    // Get total count first for progress reporting
    const countSnapshot = await db.collection(collectionName).count().get();
    const total = countSnapshot.data().count;
    console.log(`[Backfill] Found ${total} documents in ${collectionName}.`);

    let updated = 0;
    let skipped = 0;
    const batch_size = 400;
    let batch = db.batch();
    let batchCount = 0;
    let processed = 0;

    const stream = db.collection(collectionName).stream();

    for await (const doc of stream) {
        processed++;
        const data = doc.data();

        // Skip if it already has searchKeywords
        if (data.searchKeywords && Array.isArray(data.searchKeywords) && data.searchKeywords.length > 0) {
            skipped++;
        } else {
            const nameToGenerate = data[nameField] || data.name || data.advertiserName || '';
            const keywords = generateSearchKeywords(nameToGenerate);

            if (keywords.length > 0) {
                batch.update(doc.ref, { searchKeywords: keywords });
                updated++;
                batchCount++;
            } else {
                skipped++;
            }
        }

        if (batchCount >= batch_size) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }

        // Periodic logging even if batch isn't full, for live updates
        if (processed % 1000 === 0) {
            console.log(`[Backfill] ${collectionName} Progress: ${processed}/${total} (Updated: ${updated}, Skipped: ${skipped})...`);
        }
    }

    if (batchCount > 0) {
        await batch.commit();
    }
    console.log(`[Backfill] Finished ${collectionName}. Total Updated: ${updated}, Total Skipped: ${skipped}`);
}

async function run() {
    try {
        await backfillCollection('advertisers', 'name');
        await backfillCollection('products', 'name');
        console.log('\n[Backfill] All done!');
        process.exit(0);
    } catch (err) {
        console.error('[Backfill] Error:', err);
        process.exit(1);
    }
}

run();
