require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./service-account.json');

initializeApp({
    credential: cert(serviceAccount),
    projectId: 'offerbae-com',
    storageBucket: 'offerbae-com.firebasestorage.app'
});

const db = getFirestore();
db.collection('products').limit(5).get().then(snap => {
    snap.docs.forEach(doc => {
        let data = doc.data();
        console.log("advertiserId:", data.advertiserId, "type:", typeof data.advertiserId);
    });
    process.exit(0);
}).catch(e => console.error(e));
