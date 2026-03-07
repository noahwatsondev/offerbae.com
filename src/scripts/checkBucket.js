require('dotenv').config({ override: true });
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const rootSA = path.join(__dirname, '../../service-account.json');
const initOptions = {
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'offerbae-com.firebasestorage.app',
    projectId: process.env.GCP_PROJECT_ID || 'offerbae-com'
};
if (fs.existsSync(rootSA)) {
    initOptions.credential = firebaseAdmin.credential.cert(rootSA);
}
firebaseAdmin.initializeApp(initOptions);

const firebase = require('../config/firebase');

async function checkBucket() {
    const [files] = await firebase.bucket.getFiles();
    console.log(`Found ${files.length} files in bucket.`);

    let totalSize = 0;
    const extensions = {};
    const folders = {};

    for (let file of files) {
        const metadata = await file.getMetadata();
        const size = parseInt(metadata[0].size, 10);
        totalSize += size;

        const name = file.name;
        const ext = name.split('.').pop().toLowerCase();
        const folder = name.split('/')[0] || 'root';

        extensions[ext] = (extensions[ext] || 0) + 1;
        folders[folder] = (folders[folder] || 0) + 1;
    }

    console.log(`Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log('Extensions:', extensions);
    console.log('Folders:', folders);
}

checkBucket().then(() => {
    console.log('Done');
    process.exit(0);
}).catch(console.error);
