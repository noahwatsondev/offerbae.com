/**
 * Diagnostic: check actual product/offer counts in Firestore by network
 * (the advertiser.productCount field may be wrong - this queries the real data)
 */
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

async function diagnose() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();

    console.log('\n📦  Counting actual records in Firestore collections...\n');
    const NETWORKS = ['Rakuten', 'CJ', 'AWIN', 'Pepperjam'];

    for (const net of NETWORKS) {
        const [pSnap, oSnap] = await Promise.all([
            db.collection('products').where('network', '==', net).count().get(),
            db.collection('offers').where('network', '==', net).count().get()
        ]);
        const products = pSnap.data().count;
        const offers   = oSnap.data().count;
        console.log(`   ${net.padEnd(12)}  products: ${String(products).padStart(5)}   offers: ${String(offers).padStart(5)}`);
    }

    // Total
    const [totalP, totalO, totalA] = await Promise.all([
        db.collection('products').count().get(),
        db.collection('offers').count().get(),
        db.collection('advertisers').count().get()
    ]);
    console.log(`\n   ${'TOTAL'.padEnd(12)}  products: ${String(totalP.data().count).padStart(5)}   offers: ${String(totalO.data().count).padStart(5)}   advertisers: ${totalA.data().count}`);

    // Sample a few products per network to verify they look sane
    console.log('\n📋  Sample products per network:');
    for (const net of NETWORKS) {
        const snap = await db.collection('products').where('network', '==', net).limit(3).get();
        if (snap.empty) {
            console.log(`   [${net}] ⚠️  NO PRODUCTS FOUND`);
        } else {
            snap.docs.forEach(d => {
                const p = d.data();
                console.log(`   [${net}] ${p.name?.substring(0, 50)} | price: ${p.price} | advertiser: ${p.advertiserName}`);
            });
        }
    }

    process.exit(0);
}

diagnose().catch(e => { console.error(e); process.exit(1); });
