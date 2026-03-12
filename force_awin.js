require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./service-account.json');

// Initialize Firebase
initializeApp({
    credential: cert(serviceAccount),
    projectId: 'offerbae-com',
    storageBucket: 'offerbae-com.firebasestorage.app'
});

// Important: ensure firebase.js db is correctly initialized
const firebaseMod = require('./src/config/firebase');
// Overwrite db in firebase mod if needed, or if it uses default app it should be fine

const dataSync = require("./src/services/dataSync");

(async () => {
    try {
        console.log("Starting manual AWIN products sync...");
        await dataSync.syncAWINProducts();
        console.log("AWIN sync complete.");
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
})();
