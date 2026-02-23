const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const rootSA = path.join(__dirname, './service-account.json');
const initOptions = {
    projectId: 'offerbae-com'
};

if (fs.existsSync(rootSA)) {
    initOptions.credential = admin.credential.cert(rootSA);
}

admin.initializeApp(initOptions);
const db = admin.firestore();

async function testBrands() {
    try {
        console.log('Testing Brands enrichment...');
        const advSnapshot = await db.collection('advertisers').get();
        console.log(`Found ${advSnapshot.size} advertisers.`);

        const advertisers = [];
        advSnapshot.forEach(doc => {
            const data = doc.data();
            advertisers.push({
                ...data,
                productCount: data.productCount || 0,
                saleProductCount: data.saleProductCount || 0,
                offerCount: data.offerCount || 0,
            });
        });

        const newestBrands = advertisers
            .filter(b => b.productCount > 0 || b.offerCount > 0)
            .sort((a, b) => {
                const aTime = a.updatedAt ? (a.updatedAt._seconds || new Date(a.updatedAt).getTime() || 0) : 0;
                const bTime = b.updatedAt ? (b.updatedAt._seconds || new Date(b.updatedAt).getTime() || 0) : 0;
                return bTime - aTime;
            })
            .slice(0, 5);

        console.log(`Found ${newestBrands.length} newest brands.`);
        newestBrands.forEach(b => console.log(`- ${b.name} (updatedAt: ${JSON.stringify(b.updatedAt)})`));

    } catch (err) {
        console.error('Error in testBrands:', err.message);
    }
    process.exit();
}

testBrands();
