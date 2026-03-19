/**
 * Full data audit — advertisers, products, and offers
 * Checks for: orphans, bad data, missing fields, anomalies, expired records
 */
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

async function fullAudit() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();
    const now = new Date();

    console.log('\n════════════════════════════════════════════════════');
    console.log('  FULL DATA AUDIT');
    console.log(`  Run at: ${now.toISOString()}`);
    console.log('════════════════════════════════════════════════════\n');

    // ── Load collections ─────────────────────────────────────────────────────
    process.stdout.write('Loading advertisers... ');
    const advSnap = await db.collection('advertisers').get();
    const advertisers = advSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
    const advertiserIds = new Set(advertisers.map(a => `${a.network}-${String(a.id)}`));
    console.log(advertisers.length);

    process.stdout.write('Loading offers... ');
    const offerSnap = await db.collection('offers').get();
    const offers = offerSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
    console.log(offers.length);

    process.stdout.write('Loading products (this may take a minute)... ');
    const prodSnap = await db.collection('products').get();
    const products = prodSnap.docs.map(d => ({ docId: d.id, ...d.data() }));
    console.log(products.length);

    const sep = () => console.log('\n' + '─'.repeat(52));

    // ════════════════════════════════════════════════════
    // SECTION 1: ADVERTISERS
    // ════════════════════════════════════════════════════
    sep();
    console.log('📡  ADVERTISERS  (' + advertisers.length + ' total)');
    sep();

    const byNet = {};
    for (const a of advertisers) {
        const n = a.network || 'UNKNOWN';
        byNet[n] = (byNet[n] || []);
        byNet[n].push(a);
    }
    for (const [net, list] of Object.entries(byNet)) {
        const active   = list.filter(a => a.status === 'Active').length;
        const noLogo   = list.filter(a => !a.storageLogoUrl && !a.logoUrl).length;
        const noDesc   = list.filter(a => !a.description || a.description.length < 10).length;
        console.log(`  ${net.padEnd(12)} ${list.length} total  | ${active} Active | ${noLogo} no-logo | ${noDesc} no-description`);
    }

    // ════════════════════════════════════════════════════
    // SECTION 2: OFFERS
    // ════════════════════════════════════════════════════
    sep();
    console.log('🏷️   OFFERS  (' + offers.length + ' total)');
    sep();

    const offersByNet = {};
    for (const o of offers) {
        const n = o.network || 'UNKNOWN';
        offersByNet[n] = (offersByNet[n] || []);
        offersByNet[n].push(o);
    }

    let offersExpired = 0, offersNoLink = 0, offersOrphaned = 0, offersWithCode = 0, offersNoExpiry = 0;
    const offerIssues = [];

    for (const o of offers) {
        // Expired?
        if (o.endDate) {
            const end = new Date(o.endDate);
            if (end < now) offersExpired++;
        } else {
            offersNoExpiry++;
        }
        // No tracking link?
        if (!o.link) { offersNoLink++; offerIssues.push(`No link: [${o.network}] ${o.docId}`); }
        // Has a real promo code?
        if (o.code && o.code !== 'N/A' && o.code !== 'null') offersWithCode++;
        // Orphaned (advertiser no longer exists)?
        const aid = `${o.network}-${String(o.advertiserId || '')}`;
        if (o.advertiserId && !advertiserIds.has(aid)) {
            offersOrphaned++;
            offerIssues.push(`Orphaned offer (no advertiser): [${o.network}] advertiserId=${o.advertiserId} docId=${o.docId}`);
        }
    }

    console.log('  By network:');
    for (const [net, list] of Object.entries(offersByNet)) {
        const expired = list.filter(o => o.endDate && new Date(o.endDate) < now).length;
        const withCode = list.filter(o => o.code && o.code !== 'N/A' && o.code !== 'null').length;
        console.log(`    ${net.padEnd(12)} ${list.length} offers  | ${withCode} with code | ${expired} expired`);
    }
    console.log(`\n  Expired offers:         ${offersExpired}`);
    console.log(`  No expiry date:         ${offersNoExpiry}`);
    console.log(`  No tracking link:       ${offersNoLink}`);
    console.log(`  Orphaned (no adv):      ${offersOrphaned}`);
    console.log(`  With real promo code:   ${offersWithCode} (${pct(offersWithCode, offers.length)}%)`);

    if (offerIssues.length) {
        console.log('\n  ⚠️  Offer issues:');
        offerIssues.slice(0, 15).forEach(i => console.log(`    ↳ ${i}`));
        if (offerIssues.length > 15) console.log(`    ... and ${offerIssues.length - 15} more`);
    }

    // ════════════════════════════════════════════════════
    // SECTION 3: PRODUCTS
    // ════════════════════════════════════════════════════
    sep();
    console.log('🛍️   PRODUCTS  (' + products.length + ' total)');
    sep();

    const prodByNet = {};
    for (const p of products) {
        const n = p.network || 'UNKNOWN';
        prodByNet[n] = (prodByNet[n] || []);
        prodByNet[n].push(p);
    }

    let prodNoLink = 0, prodNoImage = 0, prodNoPrice = 0, prodOrphaned = 0;
    let prodNegPrice = 0, prodZeroPrice = 0, prodNoName = 0, prodNoAdveriserName = 0;
    let prodOnSale = 0;
    const prodIssues = [];

    for (const p of products) {
        if (!p.link)  { prodNoLink++;  }
        if (!p.imageUrl && !p.storageImageUrl) prodNoImage++;
        if (!p.name)  { prodNoName++;  prodIssues.push(`No name: [${p.network}] ${p.docId}`); }
        if (!p.advertiserName) prodNoAdveriserName++;

        const price = parseFloat(String(p.price || '').replace(/[^0-9.-]/g, '')) || 0;
        const sale  = parseFloat(String(p.salePrice || '').replace(/[^0-9.-]/g, '')) || 0;

        if (price <= 0 && sale <= 0) prodZeroPrice++;
        if (price < 0 || sale < 0)  prodNegPrice++;
        if (sale > 0 && price > sale) prodOnSale++;

        // Orphaned?
        const aid = `${p.network}-${String(p.advertiserId || '')}`;
        if (p.advertiserId && !advertiserIds.has(aid)) {
            prodOrphaned++;
            if (prodIssues.length < 30)
                prodIssues.push(`Orphaned product (no advertiser): [${p.network}] advertiserName=${p.advertiserName} advertiserId=${p.advertiserId}`);
        }
    }

    console.log('  By network:');
    for (const [net, list] of Object.entries(prodByNet)) {
        const noImg  = list.filter(p => !p.imageUrl && !p.storageImageUrl).length;
        const noLink = list.filter(p => !p.link).length;
        const noAdvName = list.filter(p => !p.advertiserName).length;
        const onSale = list.filter(p => {
            const pr = parseFloat(String(p.price || '').replace(/[^0-9.-]/g, '')) || 0;
            const sl = parseFloat(String(p.salePrice || '').replace(/[^0-9.-]/g, '')) || 0;
            return sl > 0 && pr > sl;
        }).length;
        console.log(`    ${net.padEnd(12)} ${String(list.length).padStart(6)} products | ${String(noImg).padStart(5)} no-image | ${String(noLink).padStart(5)} no-link | ${String(noAdvName).padStart(5)} no-advName | ${String(onSale).padStart(5)} on-sale`);
    }

    console.log(`\n  No name:                ${prodNoName}`);
    console.log(`  No link:                ${prodNoLink} (${pct(prodNoLink, products.length)}%)`);
    console.log(`  No image (any):         ${prodNoImage} (${pct(prodNoImage, products.length)}%)`);
    console.log(`  No advertiserName:      ${prodNoAdveriserName} (${pct(prodNoAdveriserName, products.length)}%)`);
    console.log(`  Zero/missing price:     ${prodZeroPrice} (${pct(prodZeroPrice, products.length)}%)`);
    console.log(`  Negative price:         ${prodNegPrice}`);
    console.log(`  On sale (price > sale): ${prodOnSale} (${pct(prodOnSale, products.length)}%)`);
    console.log(`  Orphaned (no adv):      ${prodOrphaned} (${pct(prodOrphaned, products.length)}%)`);

    if (prodIssues.length) {
        console.log('\n  ⚠️  Product issues (sample):');
        prodIssues.slice(0, 15).forEach(i => console.log(`    ↳ ${i}`));
        if (prodIssues.length > 15) console.log(`    ... and ${prodIssues.length - 15} more`);
    }

    // Price sanity check — find extreme outliers
    const prices = products
        .map(p => parseFloat(String(p.price || '').replace(/[^0-9.-]/g, '')) || 0)
        .filter(v => v > 0)
        .sort((a, b) => b - a);
    if (prices.length) {
        console.log(`\n  Price range: $${prices[prices.length - 1].toFixed(2)} — $${prices[0].toFixed(2)}`);
        console.log(`  Top 5 prices: ${prices.slice(0, 5).map(p => '$' + p.toFixed(2)).join(', ')}`);
    }

    // ════════════════════════════════════════════════════
    // SECTION 4: CROSS-COLLECTION INTEGRITY
    // ════════════════════════════════════════════════════
    sep();
    console.log('🔗  CROSS-COLLECTION INTEGRITY');
    sep();

    // Advertisers with products in DB but productCount = 0 (stale count)
    const advProductCounts = {};
    for (const p of products) {
        const key = `${p.network}-${String(p.advertiserId)}`;
        advProductCounts[key] = (advProductCounts[key] || 0) + 1;
    }
    const staleCountAdvs = advertisers.filter(a => {
        const key = `${a.network}-${String(a.id)}`;
        const real = advProductCounts[key] || 0;
        return real > 0 && (a.productCount || 0) !== real;
    });
    console.log(`  Advertisers with stale productCount:  ${staleCountAdvs.length}`);
    staleCountAdvs.slice(0, 10).forEach(a => {
        const real = advProductCounts[`${a.network}-${String(a.id)}`] || 0;
        console.log(`    ↳ [${a.network}] ${a.name}: stored=${a.productCount || 0}, actual=${real}`);
    });

    // Advertisers with offers but offerCount = 0
    const advOfferCounts = {};
    for (const o of offers) {
        const key = `${o.network}-${String(o.advertiserId)}`;
        advOfferCounts[key] = (advOfferCounts[key] || 0) + 1;
    }
    const staleOfferAdvs = advertisers.filter(a => {
        const key = `${a.network}-${String(a.id)}`;
        const real = advOfferCounts[key] || 0;
        return real > 0 && (a.offerCount || 0) !== real;
    });
    console.log(`  Advertisers with stale offerCount:    ${staleOfferAdvs.length}`);
    staleOfferAdvs.slice(0, 10).forEach(a => {
        const real = advOfferCounts[`${a.network}-${String(a.id)}`] || 0;
        console.log(`    ↳ [${a.network}] ${a.name}: stored=${a.offerCount || 0}, actual=${real}`);
    });

    // ════════════════════════════════════════════════════
    // SECTION 5: OVERALL HEALTH SCORE
    // ════════════════════════════════════════════════════
    sep();
    console.log('🏥  OVERALL HEALTH SUMMARY');
    sep();

    const issues = [];
    if (prodNoName > 0)                              issues.push(`🔴 ${prodNoName} products have no name`);
    if (prodNegPrice > 0)                            issues.push(`🔴 ${prodNegPrice} products with negative price`);
    if (prodOrphaned > products.length * 0.05)       issues.push(`🟡 ${prodOrphaned} orphaned products (${pct(prodOrphaned, products.length)}%)`);
    if (prodNoLink > products.length * 0.05)         issues.push(`🟡 ${prodNoLink} products missing affiliate link (${pct(prodNoLink, products.length)}%)`);
    if (prodNoImage > products.length * 0.5)         issues.push(`🟡 ${prodNoImage} products missing any image (${pct(prodNoImage, products.length)}%)`);
    if (prodNoAdveriserName > products.length * 0.1) issues.push(`🟡 ${prodNoAdveriserName} products missing advertiserName (${pct(prodNoAdveriserName, products.length)}%)`);
    if (offersOrphaned > 0)                          issues.push(`🟡 ${offersOrphaned} orphaned offers`);
    if (offersNoLink > 0)                            issues.push(`🟡 ${offersNoLink} offers missing tracking link`);
    if (staleCountAdvs.length > 10)                  issues.push(`🟡 ${staleCountAdvs.length} advertisers have wrong productCount`);
    if (staleOfferAdvs.length > 10)                  issues.push(`🟡 ${staleOfferAdvs.length} advertisers have wrong offerCount`);

    const okItems = [];
    if (prodNoName === 0)        okItems.push('All products have names');
    if (prodNegPrice === 0)      okItems.push('No negative prices');
    if (prodOrphaned === 0)      okItems.push('No orphaned products');
    if (offersOrphaned === 0)    okItems.push('No orphaned offers');
    if (offersNoLink === 0)      okItems.push('All offers have tracking links');

    okItems.forEach(i => console.log(`  ✅  ${i}`));
    issues.forEach(i => console.log(`  ${i}`));

    if (issues.length === 0) {
        console.log('\n  🎉  Everything looks healthy!');
    } else {
        console.log(`\n  ${issues.length} issue(s) to review above.`);
    }

    console.log('\n════════════════════════════════════════════════════\n');
    process.exit(0);
}

function pct(n, total) {
    return total ? Math.round((n / total) * 100) : 0;
}

fullAudit().catch(e => { console.error('Audit failed:', e); process.exit(1); });
