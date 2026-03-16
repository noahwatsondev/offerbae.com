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

const analyzeDates = async () => {
    const db = await initializeApp();
    const snapshot = await db.collection('advertisers').get();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let todayCount = 0;
    let olderCount = 0;
    
    snapshot.forEach(doc => {
        const data = doc.data();
        const created = data.createdAt ? data.createdAt.toDate() : doc.createTime.toDate();
        if (created >= today) {
            todayCount++;
        } else {
            olderCount++;
        }
    });
    
    console.log(`Summary:`);
    console.log(`  Created Today: ${todayCount}`);
    console.log(`  Created Older: ${olderCount}`);
};

analyzeDates().catch(console.error);
