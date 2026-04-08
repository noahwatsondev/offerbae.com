const sa = require('../service-account.json');
const firebaseAdmin = require('firebase-admin');
const axios = require('axios');
const { URL } = require('url');

firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
const db = firebaseAdmin.firestore();

function getDomain(urlStr) {
    if (!urlStr) return null;
    try {
        const hostname = new URL(urlStr).hostname;
        return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    } catch(e) { return null; }
}

(async () => {
    const snap = await db.collection('advertisers').get();
    let missing = snap.docs.filter(d => !d.data().storageLogoUrl && !d.data().logoUrl);
    
    console.log(`Found ${missing.length} advertisers missing logos.`);
    let foundCount = 0;

    for (const doc of missing) {
        const adv = doc.data();
        const domain = getDomain(adv.url);
        
        if (!domain) {
            console.log(`[${adv.network}] Skipped ${adv.name} - No valid URL`);
            continue;
        }

        const clearbitUrl = `https://logo.clearbit.com/${domain}`;
        process.stdout.write(`[${adv.network}] Checking Clearbit for ${domain}... `);
        
        try {
            const res = await axios.head(clearbitUrl, { timeout: 4000 });
            if (res.status === 200 && res.headers['content-type']?.startsWith('image/')) {
                await doc.ref.update({
                    logoUrl: clearbitUrl,
                    updatedAt: new Date()
                });
                console.log('✅ Found & Updated!');
                foundCount++;
            } else {
                console.log('❌ Not found');
            }
        } catch (e) {
            console.log('❌ Not found');
        }
    }
    
    console.log(`\n🎉 Success! Backfilled ${foundCount} logos via Clearbit network!`);
    process.exit(0);
})();
