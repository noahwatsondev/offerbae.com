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

const uploadLogo = async (localPath, advertiserId, destinationName) => {
    const bucket = firebaseAdmin.storage().bucket();
    const destPath = `advertisers/manual/${destinationName}`;
     await bucket.upload(localPath, {
        destination: destPath,
        public: true,
        metadata: {
            contentType: localPath.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
            cacheControl: 'public, max-age=31536000'
        }
    });
    return `https://storage.googleapis.com/${bucket.name}/${destPath}`;
};

const main = async () => {
    const db = await initializeApp();
    
    const tasks = [
        {
            id: 'Rakuten-39866',
            local: '/Users/noahwatson/.gemini/antigravity/brain/404f5ce4-9563-45b1-8448-def4b9297f3a/media__1773626650360.jpg',
            dest: 'canadapetcare_manual.jpg'
        },
        {
            id: 'Rakuten-53421',
            local: '/Users/noahwatson/.gemini/antigravity/brain/404f5ce4-9563-45b1-8448-def4b9297f3a/media__1773626664606.png',
            dest: 'stylevana_manual.png'
        }
    ];

    for (const task of tasks) {
        console.log(`Uploading logo for ${task.id}...`);
        const storageUrl = await uploadLogo(task.local, task.id, task.dest);
        console.log(`  Uploaded to: ${storageUrl}`);
        
        await db.collection('advertisers').doc(task.id).update({
            storageLogoUrl: storageUrl,
            logoUrl: storageUrl,
            isManualLogo: true,
            updatedAt: new Date()
        });
        console.log(`  Updated record ${task.id}!`);
    }
    console.log('Done!');
};

main().catch(console.error);
