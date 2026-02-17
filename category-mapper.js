const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// --- Step 1: Initialize Firebase ---
async function init() {
    console.log("Initializing Firebase for Category Mapping...");
    const rootSA = path.join(__dirname, 'service-account.json');
    const initOptions = {
        projectId: 'offerbae-com',
        storageBucket: 'offerbae-com.firebasestorage.app'
    };

    if (fs.existsSync(rootSA)) {
        initOptions.credential = admin.credential.cert(rootSA);
    }

    if (!admin.apps.length) {
        admin.initializeApp(initOptions);
    }
}

// --- Step 2: Define Keyword Mapping ---
const CATEGORY_MAP = {
    'Fashion': [
        'apparel', 'clothing', 'fashion', 'jewelry', 'shoes', 'accessories', 'swimwear', 'underwear',
        'lingerie', 'watch', 'handbag', 'denim', 'jeans', 'boutique', 'dress', 'shirt', 'pants',
        'skirt', 'coat', 'jacket', 'footwear'
    ],
    'Beauty & Health': [
        'beauty', 'skincare', 'makeup', 'cosmetic', 'fragrance', 'perfume', 'hair', 'salon', 'spa',
        'clinic', 'dentist', 'optical', 'glasses', 'skin', 'shampoo', 'conditioner', 'serum',
        'eyewear', 'dermatology', 'wellness'
    ],
    'Home & Garden': [
        'furniture', 'decor', 'kitchen', 'appliance', 'bedding', 'hardware', 'tool', 'cleaning',
        'patio', 'rug', 'curtain', 'mattress'
    ],
    'Electronics': [
        'laptop', 'mobile', 'phone', 'camera', 'gaming', 'gadget', 'vpn', 'hosting',
        'smartwatch', 'headphones', 'soundbar', 'television', 'hardware', 'computing'
    ],
    'Travel': [
        'travel', 'hotel', 'flight', 'airline', 'vacation', 'resort', 'cruise', 'car rental', 'tour',
        'luggage', 'booking', 'accommodation', 'trip'
    ],
    'Food & Beverage': [
        'grocery', 'restaurant', 'coffee', 'tea', 'wine', 'spirit', 'alcohol', 'snack', 'candy',
        'dessert', 'meal', 'brewery'
    ],
    'Sports & Outdoors': [
        'sport', 'outdoor', 'athletic', 'equipment', 'camping', 'hiking', 'fishing',
        'bicycle', 'yoga', 'running', 'gym'
    ],
    'Pets': [
        'pet', 'dog', 'cat', 'animal', 'veterinary', 'grooming'
    ],
    'Services & Business': [
        'legal', 'finance', 'insurance', 'marketing', 'consulting', 'employment', 'job',
        'training', 'education', 'learning', 'course'
    ],
    'Kids & Baby': [
        'kid', 'baby', 'child', 'nursery', 'maternity', 'toddler'
    ],
    'Gifts & Occasions': [
        'gift', 'occasion', 'card', 'flower', 'party', 'wedding', 'holiday', 'personalized'
    ]
};

// --- Step 3: Run Mapper ---
async function runMapper() {
    await init();
    const db = admin.firestore();

    console.log('Fetching brands for category mapping...');
    const snapshot = await db.collection('advertisers').get();

    let updatedCount = 0;
    let batch = db.batch();
    let batchSize = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();

        // Skip if already has categories or was manually touched
        if ((data.categories && data.categories.length > 0) || data.isManualCategory) {
            continue;
        }

        const searchText = `${data.name} ${data.description || ''} ${data.manualDescription || ''}`.toLowerCase();
        const detectedCategories = new Set();

        for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
            for (const keyword of keywords) {
                // Use word boundaries for better accuracy
                const regex = new RegExp(`\\b${keyword}(s|es)?\\b`, 'i');
                if (regex.test(searchText)) {
                    detectedCategories.add(category);
                    break;
                }
            }
        }

        if (detectedCategories.size > 0) {
            const newCats = Array.from(detectedCategories).slice(0, 3); // Limit to top 3
            console.log(`Brand: ${data.name} -> Detected: ${newCats.join(', ')}`);

            batch.update(doc.ref, {
                categories: newCats,
                isManualCategory: true // Mark as "System Verified/Manual" so sync doesn't overwrite
            });

            updatedCount++;
            batchSize++;

            if (batchSize >= 400) {
                await batch.commit();
                batch = db.batch();
                batchSize = 0;
            }
        }
    }

    if (batchSize > 0) {
        await batch.commit();
        console.log(`COMPLETED: Updated ${updatedCount} brands with categories.`);
    } else {
        console.log('No brands needed category updates.');
    }

    process.exit(0);
}

runMapper().catch(err => {
    console.error('Mapper failed:', err);
    process.exit(1);
});
