const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initializeApp = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa),
            projectId: sa.project_id
        });
    }
    return firebaseAdmin.firestore();
};

const findAnythingGeek = async () => {
    const db = await initializeApp();
    
    console.log('--- Searching for ANY "Geek" data ---');
    
    const products = await db.collection('products').get();
    let countP = 0;
    products.forEach(doc => {
        const d = doc.data();
        if ((d.advertiserName || '').toLowerCase().includes('geek')) {
            console.log(`Product: ${d.name} | Advertiser: ${d.advertiserName} | ID: ${d.advertiserId} | Created: ${doc.createTime.toDate()}`);
            countP++;
        }
    });

    const offers = await db.collection('offers').get();
    let countO = 0;
    offers.forEach(doc => {
        const d = doc.data();
        if ((d.advertiserName || '').toLowerCase().includes('geek')) {
            console.log(`Offer: ${d.description} | Advertiser: ${d.advertiserName} | ID: ${d.advertiserId} | Created: ${doc.createTime.toDate()}`);
            countO++;
        }
    });
    
    console.log(`Total Products: ${countP}`);
    console.log(`Total Offers: ${countO}`);
};

findAnythingGeek().catch(console.error);
