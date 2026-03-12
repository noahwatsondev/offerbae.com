require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const serviceAccount = require('./service-account.json');

initializeApp({ credential: cert(serviceAccount), projectId: 'offerbae-com' });
const db = getFirestore();

async function fix() {
    let out = '';

    // Step 1: Find the hero letter
    const heroSnap = await db.collection('loveletters').where('isHero', '==', true).get();
    if (heroSnap.empty) {
        out += 'No hero letter found!\n';
        fs.writeFileSync('fix_result.txt', out);
        process.exit(0);
    }
    const heroDoc = heroSnap.docs[0];
    out += `Hero Letter: "${heroDoc.data().title}" (ID: ${heroDoc.id})\n`;
    out += `Current relatedBrandId: "${heroDoc.data().relatedBrandId}"\n\n`;

    // Step 2: List all advertisers and find FineJewelers
    const advSnap = await db.collection('advertisers').get();
    out += `Total advertisers: ${advSnap.size}\n\n`;

    let fineJewelersDocId = null;
    advSnap.forEach(d => {
        const data = d.data();
        const name = data.name || '';
        if (name.toLowerCase().includes('finejeweler') || name.toLowerCase().includes('fine jeweler')) {
            fineJewelersDocId = d.id;
            out += `FOUND: ${name}\n  DocID: ${d.id}\n  data.id: ${data.id}\n  network: ${data.network}\n`;
        }
    });

    if (!fineJewelersDocId) {
        out += '\nNOT FOUND. Listing Pepperjam brands:\n';
        advSnap.forEach(d => {
            const data = d.data();
            if ((data.network || '').toLowerCase().includes('pepper')) {
                out += `  ${data.name} -> DocID: ${d.id}, data.id: ${data.id}\n`;
            }
        });
    }

    // Step 3: Check what products exist for FineJewelers
    if (fineJewelersDocId) {
        // Find numeric ID from doc
        const advDoc = advSnap.docs.find(d => d.id === fineJewelersDocId);
        const numId = advDoc ? advDoc.data().id : null;
        out += `\nChecking products for id: ${numId}\n`;

        if (numId) {
            const p1 = await db.collection('products').where('advertiserId', '==', numId).limit(3).get();
            out += `Products by numeric id (${numId}): ${p1.size}\n`;
            const p2 = await db.collection('products').where('advertiserId', '==', String(numId)).limit(3).get();
            out += `Products by string id ("${numId}"): ${p2.size}\n`;

            if (p1.size > 0) {
                out += `Sample: ${p1.docs[0].data().name || p1.docs[0].data().title}\n`;
            } else if (p2.size > 0) {
                out += `Sample: ${p2.docs[0].data().name || p2.docs[0].data().title}\n`;
            }
        }

        const pName = await db.collection('products').where('advertiserName', '==', advDoc ? advDoc.data().name : 'FineJewelers.com').limit(3).get();
        out += `Products by name: ${pName.size}\n`;

        // Step 4: Update hero letter with correct docId
        out += `\nUpdating relatedBrandId to: ${fineJewelersDocId}\n`;
        await heroDoc.ref.update({ relatedBrandId: fineJewelersDocId });
        out += 'Update complete!\n';
    }

    fs.writeFileSync('fix_result.txt', out);
    process.exit(0);
}

fix().catch(e => {
    require('fs').writeFileSync('fix_result.txt', 'ERROR: ' + e.stack);
    process.exit(1);
});
