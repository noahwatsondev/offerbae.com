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

const deepInvestigate = async (nameSnippet, id) => {
    const db = await initializeApp();
    const aid = String(id);
    const aidNum = Number(id);

    console.log(`--- Deep History: ${nameSnippet} (ID: ${aid}) ---`);

    // 1. Check ALL products
    const p1 = await db.collection('products').where('advertiserId', '==', aid).get();
    const p2 = await db.collection('products').where('advertiserId', '==', aidNum).get();
    const p3 = await db.collection('products').where('advertiserName', '==', 'GeekBuying.com').get();

    console.log(`Products found (String ID): ${p1.size}`);
    console.log(`Products found (Number ID): ${p2.size}`);
    console.log(`Products found (Name Match): ${p3.size}`);

    let oldestP = null;
    [...p1.docs, ...p2.docs, ...p3.docs].forEach(doc => {
        const ct = doc.createTime.toDate();
        if (!oldestP || ct < oldestP) oldestP = ct;
    });

    // 2. Check ALL offers
    const o1 = await db.collection('offers').where('advertiserId', '==', aid).get();
    const o2 = await db.collection('offers').where('advertiserId', '==', aidNum).get();
    
    console.log(`Offers found (String ID): ${o1.size}`);
    console.log(`Offers found (Number ID): ${o2.size}`);

    let oldestO = null;
    [...o1.docs, ...o2.docs].forEach(doc => {
        const ct = doc.createTime.toDate();
        if (!oldestO || ct < oldestO) oldestO = ct;
    });

    console.log('Results:');
    console.log(`  Oldest Product Evidence: ${oldestP || 'NONE'}`);
    console.log(`  Oldest Offer Evidence:   ${oldestO || 'NONE'}`);
};

deepInvestigate('Geekbuying', '42078').catch(console.error);
