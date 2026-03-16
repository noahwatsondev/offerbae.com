const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// We need to import the services manually since we're in a script
const initializeApp = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa),
            storageBucket: 'offerbae-com.firebasestorage.app'
        });
    }
    return firebaseAdmin.firestore();
};

const robustExtractDomain = (url) => {
    if (!url) return null;
    let clean = url.trim().toLowerCase();
    if (!clean.startsWith('http')) clean = 'https://' + clean;
    try {
        const hostname = new URL(clean).hostname;
        return hostname.replace('www.', '');
    } catch (e) {
        return null;
    }
};

const forceRefreshLogos = async () => {
    const db = await initializeApp();
    const brandfetch = require('../src/services/brandfetch');
    const { cacheImage } = require('../src/services/imageStore');

    const brands = ['Canadapetcare', 'Stylevana', 'Malin+Goetz', 'Geekbuying'];
    
    console.log('--- Force Refreshing Logos ---');
    
    for (const name of brands) {
        const snapshot = await db.collection('advertisers').get();
        for (const doc of snapshot.docs) {
            const data = doc.data();
            if ((data.name || '').toLowerCase().includes(name.toLowerCase())) {
                console.log(`Processing ${data.name}...`);
                
                let url = data.url || (data.raw_data && data.raw_data.url) || null;
                if (!url) {
                    console.log(`  No URL for ${data.name}, skipping.`);
                    continue;
                }

                const domain = robustExtractDomain(url);
                console.log(`  Domain: ${domain}`);

                const logoUrl = await brandfetch.fetchLogo(domain);
                if (logoUrl) {
                    console.log(`  Found logo: ${logoUrl}`);
                    const storageUrl = await cacheImage(logoUrl, `advertisers/${data.network.toLowerCase()}`);
                    if (storageUrl) {
                        console.log(`  Stored in GCS: ${storageUrl}`);
                        await doc.ref.update({
                            logoUrl: logoUrl,
                            storageLogoUrl: storageUrl,
                            updatedAt: new Date()
                        });
                        console.log(`  Updated ${data.name}!`);
                    }
                } else {
                    console.log(`  Brandfetch found nothing for ${domain}`);
                }
            }
        }
    }
    console.log('Done!');
};

forceRefreshLogos().catch(console.error);
