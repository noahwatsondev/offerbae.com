/**
 * Healing Script: Fetches missing logos AND descriptions via Brandfetch API.
 */
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const brandfetch = require('../src/services/brandfetch');

async function heal() {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
    }
    const db = firebaseAdmin.firestore();

    console.log('\n🏥  Starting data healing process...\n');

    const snap = await db.collection('advertisers').get();
    const docs = snap.docs.map(d => ({ docId: d.id, ref: d.ref, data: d.data() }));

    const needsHealing = docs.filter(d => 
        (!d.data.storageLogoUrl && !d.data.logoUrl && !d.data.brandFetchAttempted) || 
        (!d.data.description || d.data.description.length <= 10)
    );

    console.log(`   Found ${needsHealing.length} advertisers needing data (missing logo or description)\n`);

    if (needsHealing.length > 0) {
        let healedLogos = 0;
        let healedDescs = 0;

        for (const doc of needsHealing) {
            const adv = doc.data;
            if (!adv.url) continue;

            const domain = brandfetch.extractDomain(adv.url);
            if (!domain) continue;

            process.stdout.write(`   ↳ Fetching ${domain} via Brandfetch... `);
            
            const { logoUrl, description } = await brandfetch.fetchBrandDetails(domain);
            
            const updates = {};
            if (logoUrl && !adv.storageLogoUrl && !adv.logoUrl) {
                updates.logoUrl = logoUrl;
                updates.brandFetchAttempted = true;
                healedLogos++;
            } else if (!adv.storageLogoUrl && !adv.logoUrl) {
                updates.brandFetchAttempted = true;
            }

            if (description && (!adv.description || adv.description.length <= 10)) {
                updates.description = description;
                updates.isManualDescription = false;
                healedDescs++;
            }

            if (Object.keys(updates).length > 0) {
                updates.updatedAt = new Date();
                try {
                    await doc.ref.update(updates);
                    console.log(`✅ Updated (${Object.keys(updates).join(', ')})`);
                } catch(e) {
                    console.log(`❌ DB Error`);
                }
            } else {
                console.log(`- Nothing new`);
            }
            // Delay to respect Brandfetch rate limits
            await new Promise(r => setTimeout(r, 250));
        }

        console.log(`\n   ✅  Healed ${healedLogos} logos and ${healedDescs} descriptions via Brandfetch`);
    }

    console.log('\n🎉  Healing complete!\n');
    process.exit(0);
}

heal().catch(e => { console.error('Healing failed:', e); process.exit(1); });
