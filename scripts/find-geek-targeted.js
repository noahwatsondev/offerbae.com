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

const findGeekEvidence = async () => {
    const db = await initializeApp();
    
    console.log('--- Targeted "Geek" Search ---');
    
    // Check products with range query
    const pSnap = await db.collection('products')
        .where('advertiserName', '>=', 'Geek')
        .where('advertiserName', '<=', 'Geek\uf8ff')
        .get();
        
    console.log(`Products found: ${pSnap.size}`);
    pSnap.forEach(doc => {
        const d = doc.data();
        console.log(`  [P] ${d.name} | ID: ${d.advertiserId} | Created: ${doc.createTime.toDate()}`);
    });

    const oSnap = await db.collection('offers')
        .where('advertiserName', '>=', 'Geek')
        .where('advertiserName', '<=', 'Geek\uf8ff')
        .get();
        
    console.log(`Offers found: ${oSnap.size}`);
    oSnap.forEach(doc => {
        const d = doc.data();
        console.log(`  [O] ${d.description} | ID: ${d.advertiserId} | Created: ${doc.createTime.toDate()}`);
    });
};

findGeekEvidence().catch(console.error);
