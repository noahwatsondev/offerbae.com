const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const EXPECTED_NETWORKS = ['Rakuten', 'CJ', 'AWIN', 'Pepperjam'];

async function audit() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();
    const snap = await db.collection('advertisers').get();
    const docs = snap.docs.map(d => ({ docId: d.id, ...d.data() }));

    console.log(`\n════════════════════════════════════════`);
    console.log(`  ADVERTISER AUDIT  —  ${docs.length} total records`);
    console.log(`════════════════════════════════════════\n`);

    // ── 1. Breakdown by network ──────────────────────────────────────────────
    const byNetwork = {};
    for (const d of docs) {
        const net = d.network || 'UNKNOWN';
        if (!byNetwork[net]) byNetwork[net] = [];
        byNetwork[net].push(d);
    }

    console.log('📡  BY NETWORK:');
    for (const [net, list] of Object.entries(byNetwork)) {
        const active   = list.filter(d => d.status === 'Active').length;
        const inactive = list.filter(d => d.status === 'Inactive').length;
        const other    = list.length - active - inactive;
        console.log(`   ${net.padEnd(12)} ${list.length} total  |  ${active} Active  |  ${inactive} Inactive  |  ${other} other`);
    }

    const unknownNets = Object.keys(byNetwork).filter(n => !EXPECTED_NETWORKS.includes(n));
    if (unknownNets.length) console.warn(`\n⚠️   Unexpected networks found: ${unknownNets.join(', ')}`);

    // ── 2. Missing critical fields ───────────────────────────────────────────
    const missingName    = docs.filter(d => !d.name);
    const missingId      = docs.filter(d => !d.id);
    const missingNetwork = docs.filter(d => !d.network);
    const missingUrl     = docs.filter(d => !d.url);

    console.log('\n🔍  MISSING CRITICAL FIELDS:');
    console.log(`   No name:     ${missingName.length}`);
    console.log(`   No id:       ${missingId.length}`);
    console.log(`   No network:  ${missingNetwork.length}`);
    console.log(`   No url:      ${missingUrl.length}`);
    if (missingName.length) missingName.slice(0, 5).forEach(d => console.log(`      ↳ ${d.docId}`));

    // ── 3. Logo health ───────────────────────────────────────────────────────
    const hasStorageLogo  = docs.filter(d => d.storageLogoUrl).length;
    const hasFallbackLogo = docs.filter(d => !d.storageLogoUrl && d.logoUrl).length;
    const noLogo          = docs.filter(d => !d.storageLogoUrl && !d.logoUrl).length;
    const manualLogo      = docs.filter(d => d.isManualLogo).length;

    console.log('\n🖼️   LOGO HEALTH:');
    console.log(`   Storage logo:   ${hasStorageLogo} (${pct(hasStorageLogo, docs.length)}%)`);
    console.log(`   Fallback only:  ${hasFallbackLogo} (${pct(hasFallbackLogo, docs.length)}%)`);
    console.log(`   No logo at all: ${noLogo} (${pct(noLogo, docs.length)}%)`);
    console.log(`   Manual logo:    ${manualLogo}`);

    if (noLogo > 0) {
        console.log('   Advertisers with no logo:');
        docs.filter(d => !d.storageLogoUrl && !d.logoUrl)
            .slice(0, 20)
            .forEach(d => console.log(`      ↳ [${d.network}] ${d.name} (id: ${d.id})`));
    }

    // ── 4. Description health ────────────────────────────────────────────────
    const hasDesc    = docs.filter(d => d.description && d.description.length > 10).length;
    const manualDesc = docs.filter(d => d.isManualDescription).length;
    const noDesc     = docs.filter(d => !d.description || d.description.length <= 10).length;

    console.log('\n📝  DESCRIPTION HEALTH:');
    console.log(`   Has description:  ${hasDesc} (${pct(hasDesc, docs.length)}%)`);
    console.log(`   Manual:           ${manualDesc}`);
    console.log(`   Missing/empty:    ${noDesc}`);

    // ── 5. Product & offer counts ────────────────────────────────────────────
    const zeroProducts = docs.filter(d => (d.productCount || 0) === 0);
    const zeroOffers   = docs.filter(d => (d.offerCount || 0) === 0);
    const hasSales     = docs.filter(d => d.hasSaleItems).length;

    console.log('\n🛍️   COUNTS:');
    console.log(`   Zero products:  ${zeroProducts.length} advertisers`);
    console.log(`   Zero offers:    ${zeroOffers.length} advertisers`);
    console.log(`   Has sale items: ${hasSales} advertisers`);

    if (zeroProducts.length > 0 && zeroProducts.length <= 30) {
        zeroProducts.forEach(d => console.log(`      ↳ [${d.network}] ${d.name} (${d.id}) — status: ${d.status}`));
    }

    // ── 6. Duplicate detection ───────────────────────────────────────────────
    const seen = new Map();
    const dupes = [];
    for (const d of docs) {
        const key = `${d.network}-${d.id}`;
        if (seen.has(key)) dupes.push({ key, docId: d.docId });
        else seen.set(key, d.docId);
    }

    console.log('\n♻️   DUPLICATES (same network+id in multiple docs):');
    console.log(`   ${dupes.length} duplicate entries`);
    dupes.slice(0, 10).forEach(d => console.log(`      ↳ ${d.key}  (docId: ${d.docId})`));

    // ── 7. Timestamps / staleness ────────────────────────────────────────────
    const noCreatedAt = docs.filter(d => !d.createdAt).length;
    const noUpdatedAt = docs.filter(d => !d.updatedAt).length;

    const withUpdated = docs.filter(d => d.updatedAt);
    let oldest = null, newest = null;
    for (const d of withUpdated) {
        const t = d.updatedAt?.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt);
        if (!oldest || t < oldest) oldest = t;
        if (!newest || t > newest) newest = t;
    }

    const now = new Date();
    const stale = withUpdated.filter(d => {
        const t = d.updatedAt?.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt);
        return (now - t) / (1000 * 60 * 60 * 24) > 14;
    });

    console.log('\n🕐  TIMESTAMPS:');
    console.log(`   Missing createdAt: ${noCreatedAt}`);
    console.log(`   Missing updatedAt: ${noUpdatedAt}`);
    console.log(`   Oldest update:     ${oldest ? oldest.toISOString().split('T')[0] : 'n/a'}`);
    console.log(`   Newest update:     ${newest ? newest.toISOString().split('T')[0] : 'n/a'}`);
    console.log(`   Stale (>14 days):  ${stale.length}`);

    if (stale.length > 0 && stale.length <= 20) {
        stale.forEach(d => {
            const t = d.updatedAt?.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt);
            console.log(`      ↳ [${d.network}] ${d.name} — last updated ${t.toISOString().split('T')[0]}`);
        });
    }

    // ── 8. Overall health summary ────────────────────────────────────────────
    const issues = [];
    if (missingName.length)    issues.push(`${missingName.length} records missing name`);
    if (missingNetwork.length) issues.push(`${missingNetwork.length} records missing network`);
    if (noLogo > docs.length * 0.3) issues.push(`${noLogo} advertisers without any logo (${pct(noLogo, docs.length)}%)`);
    if (dupes.length)          issues.push(`${dupes.length} duplicate network+id entries`);
    if (stale.length > docs.length * 0.5) issues.push(`${stale.length} stale records (>14 days old)`);
    if (unknownNets.length)    issues.push(`unknown networks present: ${unknownNets.join(', ')}`);
    if (zeroProducts.length > docs.length * 0.7) issues.push(`${zeroProducts.length} advertisers have 0 products (${pct(zeroProducts.length, docs.length)}%)`);

    console.log('\n════════════════════════════════════════');
    if (issues.length === 0) {
        console.log('✅  HEALTH: GOOD — no critical issues detected');
    } else {
        console.log(`⚠️   HEALTH: ${issues.length} issue(s) found:`);
        issues.forEach(i => console.log(`   • ${i}`));
    }
    console.log('════════════════════════════════════════\n');

    process.exit(0);
}

function pct(n, total) {
    return total ? Math.round((n / total) * 100) : 0;
}

audit().catch(e => { console.error(e); process.exit(1); });
