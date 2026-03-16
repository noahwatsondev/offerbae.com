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

const findOldestLegacyData = async () => {
    const db = await initializeApp();
    const aid = "47409";
    
    console.log('--- Checking for historical data for Percival (47409) ---');
    
    // Check offers
    const offerSnap = await db.collection('offers')
        .where('advertiserId', 'in', [aid, Number(aid)])
        .get();
        
    let oldestOffer = null;
    offerSnap.forEach(doc => {
        const ct = doc.createTime.toDate();
        if (!oldestOffer || ct < oldestOffer) oldestOffer = ct;
    });
    console.log(`Oldest Offer createTime: ${oldestOffer || 'None'}`);

    // Check products
    const productSnap = await db.collection('products')
        .where('advertiserId', 'in', [aid, Number(aid)])
        .limit(100) // Just a sample
        .get();
        
    let oldestProduct = null;
    productSnap.forEach(doc => {
        const ct = doc.createTime.toDate();
        if (!oldestProduct || ct < oldestProduct) oldestProduct = ct;
    });
    console.log(`Oldest Product createTime: ${oldestProduct || 'None'}`);

    // Check search logs?
    const logSnap = await db.collection('searchLogs')
        .where('query', '==', 'percival')
        .limit(5)
        .get();
    
    let oldestLog = null;
    logSnap.forEach(doc => {
        const ct = doc.createTime.toDate();
        if (!oldestLog || ct < oldestLog) oldestLog = ct;
    });
    console.log(`Oldest Search Log: ${oldestLog || 'None'}`);
};

findOldestLegacyData().catch(console.error);
