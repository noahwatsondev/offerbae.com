require('dotenv').config({ override: true });
const sa = require('../service-account.json');
const firebaseAdmin = require('firebase-admin');
const axios = require('axios');
const cjConfig = require('../src/config/env').cj;
const awinConfig = require('../src/config/env').awin;

if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
}
const db = firebaseAdmin.firestore();

function getDomain(urlStr) {
    if (!urlStr) return null;
    try {
        const hostname = new URL(urlStr).hostname;
        return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    } catch(e) { return null; }
}

async function fetchCjLogo(advertiserId) {
    if (!cjConfig.personalAccessToken) return null;
    try {
        const gq = `
        {
            advertisers(companyId: "${cjConfig.companyId}", advertiserIds: ["${advertiserId}"], limit: 1) {
                records {
                    logoUrl
                }
            }
        }`;
        const res = await axios.post('https://platform.cj.com/graphql', { query: gq }, {
            headers: { 'Authorization': `Bearer ${cjConfig.personalAccessToken}` }
        });
        const records = res.data?.data?.advertisers?.records;
        if (records && records.length > 0 && records[0].logoUrl) {
            return records[0].logoUrl;
        }
    } catch(e) {}
    return null;
}

async function fetchAwinLogos() {
    if (!awinConfig.accessToken || !awinConfig.publisherId) return {};
    try {
        const res = await axios.get(
            `https://api.awin.com/publishers/${awinConfig.publisherId}/programmes?relationship=joined`, {
            headers: { 'Authorization': `Bearer ${awinConfig.accessToken}` }
        });
        const map = {};
        for(let p of res.data) {
            if (p.logoUrl) map[String(p.id)] = p.logoUrl;
        }
        return map;
    } catch(e) {}
    return {};
}

function getFaviconFallback(url) {
    const domain = getDomain(url);
    if (!domain) return null;
    return `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=128`;
}

async function run() {
    console.log('\n📡  Backfilling missing logos via Affiliate Network APIs...\n');

    const snap = await db.collection('advertisers').get();
    const missingLogos = snap.docs.filter(d => !d.data().storageLogoUrl && !d.data().logoUrl);

    console.log(`   Found ${missingLogos.length} advertisers still missing logos\n`);

    const awinMap = await fetchAwinLogos();
    let updatedCount = 0;

    for (const doc of missingLogos) {
        const adv = doc.data();
        let newLogoUrl = null;

        process.stdout.write(`   ↳ [${adv.network}] ${adv.name} (ID: ${adv.id}) `);

        if (adv.network === 'AWIN') {
            newLogoUrl = awinMap[String(adv.id)];
            if (newLogoUrl) console.log(`→ Found in AWIN API!`);
        } else if (adv.network === 'CJ') {
            newLogoUrl = await fetchCjLogo(adv.id);
            if (newLogoUrl) console.log(`→ Found in CJ GraphQL!`);
            await new Promise(r => setTimeout(r, 200)); // Rate limit
        } else {
            // Rakuten does not return logos in API. Use Google Favicons as fallback
            newLogoUrl = getFaviconFallback(adv.url);
            if (newLogoUrl) console.log(`→ Applied 128px Favicon fallback (Rakuten API limits logos)`);
        }

        if (newLogoUrl) {
            try {
                await doc.ref.update({
                    logoUrl: newLogoUrl,
                    updatedAt: new Date()
                });
                updatedCount++;
            } catch(e) {
                console.log(`→ ❌ DB Error`);
            }
        } else {
            console.log(`→ ❌ Not found anywhere`);
        }
    }

    console.log(`\n🎉  Backfill complete! Updated ${updatedCount} logos.\n`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
