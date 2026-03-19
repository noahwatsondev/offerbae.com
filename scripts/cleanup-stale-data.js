/**
 * Cleanup: removes orphaned TEST product and expired offers
 */
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

async function cleanup() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();
    const now = new Date();

    console.log('\n🧹  Starting cleanup...\n');

    // ── 1. Delete orphaned TEST products ────────────────────────────────────
    const testSnap = await db.collection('products').where('network', '==', 'TEST').get();
    console.log(`   TEST products found: ${testSnap.size}`);
    let batch = db.batch();
    testSnap.docs.forEach(d => batch.delete(d.ref));
    if (!testSnap.empty) await batch.commit();
    console.log(`   ✅  Deleted ${testSnap.size} TEST product(s)`);

    // ── 2. Delete expired offers ─────────────────────────────────────────────
    const offersSnap = await db.collection('offers').get();
    const expired = offersSnap.docs.filter(d => {
        const data = d.data();
        if (!data.endDate) return false;
        try {
            const end = new Date(data.endDate);
            return !isNaN(end.getTime()) && end < now;
        } catch { return false; }
    });

    console.log(`\n   Expired offers found: ${expired.length}`);
    expired.forEach(d => {
        const o = d.data();
        console.log(`      ↳ [${o.network}] ${o.advertiser} — expires ${o.endDate} — "${(o.description||'').substring(0,50)}"`);
    });

    if (expired.length > 0) {
        batch = db.batch();
        // Delete in batches of 400
        for (let i = 0; i < expired.length; i++) {
            batch.delete(expired[i].ref);
            if ((i + 1) % 400 === 0) { await batch.commit(); batch = db.batch(); }
        }
        await batch.commit();
        console.log(`   ✅  Deleted ${expired.length} expired offer(s)`);
    }

    console.log('\n🎉  Cleanup complete!\n');
    process.exit(0);
}

cleanup().catch(e => { console.error('Cleanup failed:', e); process.exit(1); });
