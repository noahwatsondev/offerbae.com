const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

async function backfillSlugs() {
    console.log('--- STARTING BACKFILL SLUGS ---');

    // 1. Backfill Advertiser Slugs
    console.log('Backfilling Advertiser slugs...');
    const advSnap = await db.collection('advertisers').get();
    let advCount = 0;
    for (const doc of advSnap.docs) {
        const data = doc.data();
        if (!data.slug) {
            const slug = slugify(data.name);
            await doc.ref.update({ slug });
            advCount++;
        }
    }
    console.log(`Updated ${advCount} advertisers.`);

    // 2. Backfill Product Slugs
    // Since products can be many, we do it in batches
    console.log('Backfilling Product slugs (Batch Mode)...');
    let productCount = 0;
    let lastDoc = null;
    const batchSize = 500;

    while (true) {
        let query = db.collection('products').limit(batchSize);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const pSnap = await query.get();
        if (pSnap.empty) break;

        const batch = db.batch();
        let changedInBatch = 0;

        pSnap.docs.forEach(doc => {
            const p = doc.data();
            if (!p.slug) {
                // For products, combining name and a short hash or ID part helps uniqueness
                const baseSlug = slugify(p.name);
                const shortId = doc.id.substring(0, 5);
                const slug = `${baseSlug}-${shortId}`;
                batch.update(doc.ref, { slug });
                changedInBatch++;
            }
            lastDoc = doc;
        });

        if (changedInBatch > 0) {
            await batch.commit();
            productCount += changedInBatch;
            console.log(`Processed ${productCount} products...`);
        } else {
            // If no changes in this batch, we might still have more docs to skip
            // but for simplicity if we find a batch with all slugs we stop or skip
            // Actually continue until we find empty
        }
    }

    console.log(`--- FINISHED: Updated ${productCount} products ---`);
    process.exit(0);
}

backfillSlugs().catch(console.error);
