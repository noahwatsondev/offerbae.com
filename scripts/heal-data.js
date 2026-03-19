/**
 * Heal script — fixes three data issues in Firestore:
 *  1. Reconciles productCount / offerCount on all advertiser documents
 *     (the denormalized counts got out of sync; this queries actual products/offers)
 *  2. Normalizes status='Active' for CJ, AWIN, Pepperjam advertisers
 *  3. Backfills missing createdAt from Firestore system createTime
 */
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

async function heal() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();

    console.log('\n🔧  Starting Firestore Heal Script...\n');

    // ── Load all advertisers ─────────────────────────────────────────────────
    const advSnap = await db.collection('advertisers').get();
    const advertisers = advSnap.docs.map(d => ({ ref: d.ref, docId: d.id, createTime: d.createTime, ...d.data() }));
    console.log(`📋  Loaded ${advertisers.length} advertisers`);

    let statusFixed = 0;
    let createdAtFixed = 0;
    let countsUpdated = 0;
    let batchCount = 0;
    const MAX_BATCH = 400;
    let batch = db.batch();

    const commit = async () => {
        if (batchCount > 0) {
            await batch.commit();
            console.log(`   ✅  Committed batch of ${batchCount} writes`);
            batchCount = 0;
            batch = db.batch();
        }
    };

    const write = async (ref, data) => {
        batch.update(ref, data);
        batchCount++;
        if (batchCount >= MAX_BATCH) await commit();
    };

    // ── Phase 1: Fix status & createdAt in a single pass ────────────────────
    console.log('\n📡  Phase 1: Fixing status + createdAt...');
    for (const adv of advertisers) {
        const updates = {};

        // Status normalization: all joined programmes should be Active
        const nonRakutenNetworks = ['CJ', 'AWIN', 'Pepperjam'];
        if (nonRakutenNetworks.includes(adv.network) && adv.status !== 'Active') {
            updates.status = 'Active';
            statusFixed++;
        }

        // createdAt backfill from Firestore system createTime
        if (!adv.createdAt && adv.createTime) {
            updates.createdAt = adv.createTime.toDate();
            createdAtFixed++;
        }

        if (Object.keys(updates).length > 0) {
            await write(adv.ref, updates);
        }
    }
    await commit();
    console.log(`   Status fixed: ${statusFixed}  |  createdAt backfilled: ${createdAtFixed}`);

    // ── Phase 2: Reconcile product & offer counts ────────────────────────────
    console.log('\n📦  Phase 2: Reconciling product + offer counts per advertiser...');

    // Build a count map from actual products collection
    // We do this per-network to stay within Firestore query limits
    const NETWORKS = ['Rakuten', 'CJ', 'AWIN', 'Pepperjam'];
    const productCountMap = {}; // key: `${network}-${id}` => count
    const offerCountMap  = {};

    for (const net of NETWORKS) {
        console.log(`   Counting ${net} products...`);
        const pSnap = await db.collection('products').where('network', '==', net).get();
        for (const doc of pSnap.docs) {
            const data = doc.data();
            const aid = String(data.advertiserId || '');
            if (!aid) continue;
            const key = `${net}-${aid}`;
            productCountMap[key] = (productCountMap[key] || 0) + 1;
        }

        console.log(`   Counting ${net} offers...`);
        const oSnap = await db.collection('offers').where('network', '==', net).get();
        for (const doc of oSnap.docs) {
            const data = doc.data();
            const aid = String(data.advertiserId || '');
            if (!aid) continue;
            const key = `${net}-${aid}`;
            offerCountMap[key] = (offerCountMap[key] || 0) + 1;
        }
    }

    // Now update advertisers
    console.log(`   Writing corrected counts to advertiser docs...`);
    for (const adv of advertisers) {
        const aid = String(adv.id || '');
        const key = `${adv.network}-${aid}`;
        const newProductCount = productCountMap[key] || 0;
        const newOfferCount   = offerCountMap[key]   || 0;

        // Only write if different to avoid unnecessary Firestore writes
        if (adv.productCount !== newProductCount || adv.offerCount !== newOfferCount) {
            await write(adv.ref, {
                productCount: newProductCount,
                offerCount: newOfferCount,
                updatedAt: new Date()
            });
            countsUpdated++;
        }
    }
    await commit();
    console.log(`   Count fields updated: ${countsUpdated} advertisers`);

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════');
    console.log('✅  Heal Complete');
    console.log(`   Status normalized:     ${statusFixed}`);
    console.log(`   createdAt backfilled:  ${createdAtFixed}`);
    console.log(`   Count fields updated:  ${countsUpdated}`);
    console.log('════════════════════════════════════════\n');

    process.exit(0);
}

heal().catch(e => { console.error('Heal failed:', e); process.exit(1); });
