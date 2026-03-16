const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const initializeApp = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa)
        });
    }
    return firebaseAdmin.firestore();
};

const diagnoseNapa = async () => {
    const db = await initializeApp();
    
    console.log('--- Diagnosing NAPA (50383) ---');
    
    // 1. Check Advertiser Record
    const advDoc = await db.collection('advertisers').doc('Rakuten-50383').get();
    if (!advDoc.exists) {
        console.log('Advertiser record Rakuten-50383 NOT FOUND.');
        // Search by name
        const search = await db.collection('advertisers').where('name', '==', 'NAPA').get();
        if (search.empty) {
            console.log('No advertiser named NAPA found.');
        } else {
            search.forEach(d => console.log(`Found NAPA with ID: ${d.id}`, d.data()));
        }
    } else {
        console.log('Found Advertiser Record:', JSON.stringify(advDoc.data(), null, 2));
    }

    // 2. Check Products
    const p1 = await db.collection('products').where('advertiserId', '==', '50383').limit(5).get();
    console.log(`Products with string ID "50383": ${p1.size}`);
    
    const p2 = await db.collection('products').where('advertiserId', '==', 50383).limit(5).get();
    console.log(`Products with number ID 50383: ${p2.size}`);

    // 3. Check Offers
    const o1 = await db.collection('offers').where('advertiserId', '==', '50383').get();
    console.log(`Offers with string ID "50383": ${o1.size}`);

    const o2 = await db.collection('offers').where('advertiserId', '==', 50383).get();
    console.log(`Offers with number ID 50383: ${o2.size}`);
};

diagnoseNapa().catch(console.error);
