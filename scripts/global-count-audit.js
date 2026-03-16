const { recalculateAdvertiserCounts } = require('../src/services/dataSync');
const firebaseAdmin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const main = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa)
        });
    }

    const db = firebaseAdmin.firestore();
    console.log('--- Starting Global Brand Count Audit ---');
    
    const advertisersSnap = await db.collection('advertisers').get();
    console.log(`Found ${advertisersSnap.size} advertisers to audit.`);

    let updatedCount = 0;
    let index = 0;

    for (const doc of advertisersSnap.docs) {
        index++;
        const adv = doc.data();
        const advId = adv.id || doc.id;
        const network = adv.network;

        if (!network || !advId) {
            console.log(`[${index}/${advertisersSnap.size}] Skipping ${adv.name || doc.id}: Missing network or ID`);
            continue;
        }

        process.stdout.write(`[${index}/${advertisersSnap.size}] Auditing ${adv.name} (${network})... `);
        
        try {
            const result = await recalculateAdvertiserCounts(network, advId);
            
            if (result) {
                const changedP = (result.products !== adv.productCount);
                const changedO = (result.offers !== adv.offerCount);
                
                if (changedP || changedO) {
                    console.log(`FIXED: P(${adv.productCount} -> ${result.products}), O(${adv.offerCount} -> ${result.offers})`);
                    updatedCount++;
                } else {
                    console.log('OK');
                }
            } else {
                console.log('FAILED (No result)');
            }
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
        }
        
        // Minor delay to prevent hitting Firestore rate limits on high volume writes
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('--- Audit Complete ---');
    console.log(`Total Brands Audited: ${advertisersSnap.size}`);
    console.log(`Total Counts Corrected: ${updatedCount}`);
    process.exit(0);
};

main().catch(console.error);
