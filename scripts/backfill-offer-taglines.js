/**
 * Backfill: re-derives taglines for all offers where tagline === 'CODE'
 * Uses the same generateOfferTagline() logic from db.js
 */
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

async function backfill() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();

    // Inline the improved generateOfferTagline logic
    const generateOfferTagline = (offer) => {
        const text = (offer.description || offer.name || '').toLowerCase();
        const code = offer.code && offer.code !== 'N/A' && offer.code !== 'null' ? offer.code : null;

        const percentMatch =
            text.match(/up\s*to\s*(\d+)%\s*off/i) ||
            text.match(/extra\s*(\d+)%\s*off/i) ||
            text.match(/additional\s*(\d+)%\s*off/i) ||
            text.match(/(\d+)%\s*off/i) ||
            text.match(/save\s*(\d+)%/i) ||
            text.match(/(\d+)%\s*discount/i) ||
            text.match(/(\d+)%/);
        if (percentMatch) return `${percentMatch[1]}% OFF`;

        const dollarMatch =
            text.match(/\$([\d,]+(?:\.\d+)?)\s*off/i) ||
            text.match(/save\s*\$([\d,]+)/i) ||
            text.match(/([\d,]+(?:\.\d+)?)\s*off\s*with/i) ||
            text.match(/\$([\d,]+(?:\.\d+)?)/i);
        if (dollarMatch) {
            const amt = parseFloat(dollarMatch[1].replace(/,/g, ''));
            if (amt > 0) return `$${amt % 1 === 0 ? amt.toFixed(0) : amt.toFixed(2)} OFF`;
        }

        if (text.includes('free shipping') || text.includes('free delivery')) return 'FREE SHIPPING';
        if (text.includes('buy one get one') || text.includes('bogo') || text.includes('buy 1 get 1')) return 'BOGO';
        if (text.includes('2 for 1') || text.includes('two for one')) return '2 FOR 1';
        if (/buy\s*\d+\s*get\s*\d+/i.test(text)) return 'BUNDLE DEAL';
        if (text.includes('new customer') || text.includes('new user') || text.includes('first order') || text.includes('first-time')) return 'NEW CUSTOMER';
        if (text.includes('student')) return 'STUDENT';
        if (text.includes('military') || text.includes('veteran')) return 'MILITARY';
        if (text.includes('loyalty') || text.includes('member') || text.includes('exclusive')) return 'MEMBER DEAL';
        if (text.includes('gift card')) return 'GIFT CARD';
        if (text.includes('flash sale') || text.includes('limited time')) return 'LIMITED TIME';
        if (text.includes('clearance')) return 'CLEARANCE';
        if (text.includes('sitewide')) return 'SITEWIDE';
        if (text.includes('sale')) return 'SALE';

        return code ? 'USE CODE' : 'DEAL';
    };

    console.log('\n🔖  Backfilling offer taglines (null + "CODE" + "DEAL" fallbacks)...\n');

    // Fetch ALL offers (tagline null isn't queryable directly in Firestore)
    const snap = await db.collection('offers').get();
    const toFix = snap.docs.filter(d => {
        const t = d.data().tagline;
        return !t || t === 'CODE' || t === 'DEAL';
    });
    console.log(`   Total offers: ${snap.size} | Needs re-derivation: ${toFix.length}`);


    let updated = 0;
    let unchanged = 0;
    const MAX_BATCH = 400;
    let batch = db.batch();
    let batchCount = 0;

    const commit = async () => {
        if (batchCount > 0) {
            await batch.commit();
            batchCount = 0;
            batch = db.batch();
        }
    };

    // Preview first 10 from the fix list
    console.log('   Sample re-derivations:');
    toFix.slice(0, 10).forEach(doc => {
        const o = doc.data();
        const newTagline = generateOfferTagline(o);
        console.log(`   [${o.network}] ${(o.advertiser || '').substring(0, 20).padEnd(20)} "${(o.description || '').substring(0, 50)}" → ${newTagline}`);
    });
    console.log('');

    for (const doc of toFix) {
        const o = doc.data();
        const newTagline = generateOfferTagline(o);
        batch.update(doc.ref, { tagline: newTagline });
        batchCount++;
        updated++;
        if (batchCount >= MAX_BATCH) await commit();
    }
    await commit();

    const reallyUnchanged = snap.size - updated;

    console.log(`✅  Done!`);
    console.log(`   Updated:   ${updated} offers`);
    console.log(`   Already had tagline (skipped): ${reallyUnchanged}`);
    console.log('');
    process.exit(0);
}

backfill().catch(e => { console.error('Backfill failed:', e); process.exit(1); });
