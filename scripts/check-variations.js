const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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

const checkAllVariations = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    console.log('--- Checking all variations of Stylevana/Canadapetcare ---');
    snapshot.forEach(doc => {
        const data = doc.data();
        const name = (data.name || '').toLowerCase();
        if (name.includes('stylevana') || name.includes('canadapetcare')) {
            console.log(`Doc ID: ${doc.id}`);
            console.log(`  Name: ${data.name}`);
            console.log(`  Logo: ${data.logoUrl}`);
            console.log(`  StorageLogo: ${data.storageLogoUrl}`);
            console.log(`  ID (field): ${data.id}`);
            console.log(`  Status: ${data.status}`);
            console.log('---');
        }
    });
};

checkAllVariations().catch(console.error);
