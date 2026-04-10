require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const axios = require('axios');
const serviceAccount = require('../service-account.json');

// Initialize Firebase
if (!require('firebase-admin/app').getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

const SERPAPI_KEY = process.env.SERPAPI_KEY;

async function searchGoogleShopping(productName, brandName) {
    if (!SERPAPI_KEY) throw new Error('SERPAPI_KEY not found in .env');

    try {
        const query = `${brandName} ${productName}`;
        console.log(`🔍 Searching: ${query}`);
        
        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                engine: 'google_shopping',
                q: query,
                api_key: SERPAPI_KEY,
                num: 3,
                gl: 'us',
                hl: 'en'
            }
        });

        const results = response.data.shopping_results || [];
        if (results.length > 0) {
            console.log('--- FIRST RESULT SAMPLE ---');
            // Log a few interesting fields to see what's available
            const r = results[0];
            console.log({
                title: r.title,
                price: r.price,
                rating: r.rating,
                reviews: r.reviews,
                product_id: r.product_id,
                extensions: r.extensions
            });
            console.log('---------------------------');
        }
        
        const match = results.find(r => r.product_id || r.title);
        return match;
    } catch (err) {
        console.error(`Search failed: ${err.message}`);
        return null;
    }
}

async function enrichProducts(brandName = 'KitchenAid', limitCount = 10) {
    if (!SERPAPI_KEY) {
        console.error('❌ ERROR: SERPAPI_KEY missing from .env. Please add it to start enrichment.');
        return;
    }

    const searchBrand = brandName.split(' ')[0]; 

    let brandId = null;
    if (brandName) {
        const advSnap = await db.collection('advertisers')
            .where('name', '==', brandName)
            .limit(1)
            .get();
        if (!advSnap.empty) {
            const rawId = advSnap.docs[0].data().advertiserId || advSnap.docs[0].id;
            brandId = rawId.split('-').pop(); 
        }
    }

    let query = db.collection('products');
    if (brandId) {
        query = query.where('advertiserId', '==', brandId);
    }

    const snapshot = await query.limit(limitCount).get(); 
    console.log(`🚀 Starting SerpApi Enrichment for ${snapshot.size} products...`);

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.enriched_at && data.rating && !process.env.FORCE) {
            console.log(`⏭️ Skipping ${data.name} (Already enriched)`);
            continue;
        }

        console.log(`\n--- Processing: ${data.name} ---`);
        
        const match = await searchGoogleShopping(data.name, searchBrand);
        
        if (match) {
            const reviewsUrl = match.product_id ? `https://www.google.com/shopping/product/${match.product_id}/reviews?gl=us&hl=en` : null;
            
            await doc.ref.set({
                enriched_at: new Date(),
                google_product_id: match.product_id || null,
                reviews_url: reviewsUrl,
                rating: match.rating || data.rating || null,
                reviewCount: match.reviews || data.reviewCount || null,
                specifications: match.extensions ? { "Highlights": match.extensions.join(', ') } : null,
                source: 'serpapi_shopping'
            }, { merge: true });
            
            console.log(`✅ SUCCESS: [${match.title}]`);
            console.log(`   └ Rating: ${match.rating || 'N/A'} | Reviews: ${match.reviews || 0}`);
            if (reviewsUrl) console.log(`   └ Review Link: ${reviewsUrl}`);
        } else {
            console.log('⚠️ No match found on Google Shopping.');
        }

        await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n✨ All done.');
}

const args = process.argv.slice(2);
const targetBrand = args[0] || 'KitchenAid Major Appliances';
const targetLimit = parseInt(args[1]) || 5;

enrichProducts(targetBrand, targetLimit);
