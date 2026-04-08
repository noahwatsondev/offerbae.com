const sa = require('../service-account.json');
const firebaseAdmin = require('firebase-admin');
firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
const db = firebaseAdmin.firestore();
(async () => {
    const snap = await db.collection('advertisers').get();
    let missing = snap.docs.filter(d => !d.data().storageLogoUrl && !d.data().logoUrl);
    let counts = {};
    missing.forEach(d => {
        let n = d.data().network;
        counts[n] = (counts[n] || 0) + 1;
    });
    console.log('Missing logos by network:', counts);
    process.exit(0);
})();
