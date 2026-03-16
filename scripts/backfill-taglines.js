const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const generateOfferTagline = (offer) => {
    const text = (offer.description || offer.name || '').toLowerCase();
    const percentMatch = text.match(/(\d+)%\s*off/i) || text.match(/up to\s*(\d+)%\s*off/i) || text.match(/(\d+)%/);
    if (percentMatch) return `${percentMatch[1]}% OFF`;
    const dollarMatch = text.match(/\$(\d+)\s*off/i) || text.match(/save\s*\$(\d+)/i) || text.match(/\$(\d+)/);
    if (dollarMatch) return `$${dollarMatch[1]} OFF`;
    if (text.includes('free shipping') || text.includes('free delivery')) return 'FREE SHIPPING';
    if (text.includes('buy one get one') || text.includes('bogo')) return 'BOGO';
    if (text.includes('new customer') || text.includes('new user') || text.includes('first order')) return 'NEW CUSTOMER';
    if (text.includes('student')) return 'STUDENT';
    if (text.includes('military')) return 'MILITARY';
    if (text.includes('clearance')) return 'CLEARANCE';
    if (text.includes('sitewide')) return 'SITEWIDE';
    if (text.includes('sale')) return 'SALE';
    return 'DEAL';
};

const initializeApp = async () => {
    const rootSA = path.join(__dirname, '../service-account.json');
    
    if (!fs.existsSync(rootSA)) {
        throw new Error(`Service account file not found at ${rootSA}`);
    }

    const sa = JSON.parse(fs.readFileSync(rootSA, 'utf8'));
    console.log(`Using service account for project: ${sa.project_id}`);

    if (!firebaseAdmin.apps.length) {
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(sa),
            projectId: sa.project_id
        });
    }
    return firebaseAdmin.firestore();
};

const backfill = async () => {
    const db = await initializeApp();
    console.log('Fetching offers...');
    const snapshot = await db.collection('offers').get();
    console.log(`Found ${snapshot.size} offers.`);

    let count = 0;
    let batch = db.batch();
    const BATCH_SIZE = 450;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (!data.tagline) {
            const tagline = generateOfferTagline(data);
            batch.update(doc.ref, { tagline, updatedAt: new Date() });
            count++;

            if (count % BATCH_SIZE === 0) {
                console.log(`Committing batch of ${BATCH_SIZE}...`);
                await batch.commit();
                batch = db.batch();
            }
        }
    }

    if (count % BATCH_SIZE !== 0) {
        await batch.commit();
    }

    console.log(`Successfully backfilled ${count} offers.`);
};

backfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
