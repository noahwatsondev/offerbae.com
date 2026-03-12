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
db.collection('products').limit(1).get().then(snap => {
    console.log("advertiserId:", snap.docs[0].data().advertiserId);
    process.exit(0);
}).catch(e => console.error(e));
