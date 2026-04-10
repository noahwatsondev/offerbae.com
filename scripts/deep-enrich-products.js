const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const serviceAccount = require('../service-account.json');

puppeteer.use(StealthPlugin());

// Initialize Firebase
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function enrichProducts(brandName = 'Stylevana', limitCount = 10) {
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
    console.log(`Found ${snapshot.size} products for ${brandName || 'All'}`);

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.enriched_at && data.rating && !process.env.FORCE) {
            console.log(`Skipping ${data.name} (Already enriched)`);
            continue;
        }

        console.log(`Processing [${data.brandName}] ${data.name}...`);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        try {
            await page.goto(data.link, { waitUntil: 'networkidle2', timeout: 60000 });
            const finalUrl = page.url();

            // Extract content
            const results = await page.evaluate(() => {
                const enriched = {};
                
                // 1. JSON-LD
                const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                for (const script of scripts) {
                    try {
                        const json = JSON.parse(script.innerHTML);
                        const items = Array.isArray(json) ? json : [json];
                        for (const item of items) {
                            const product = item['@type'] === 'Product' ? item : (item['@graph'] ? item['@graph'].find(t => t['@type'] === 'Product') : null);
                            if (product) {
                                if (product.aggregateRating) {
                                    enriched.ratingValue = parseFloat(product.aggregateRating.ratingValue);
                                    enriched.reviewCount = parseInt(product.aggregateRating.reviewCount);
                                }
                                if (product.description) enriched.longDescription = product.description;
                                if (product.sku) enriched.sku = product.sku;
                            }
                        }
                    } catch (e) {}
                }

                // 2. Specifications (Simplified for browser)
                const specs = {};
                document.querySelectorAll('table tr, .product-attribute-list li').forEach(el => {
                    const label = (el.querySelector('th, .label') || {}).innerText?.trim();
                    const value = (el.querySelector('td, .value') || {}).innerText?.trim();
                    if (label && value && label.length < 50) specs[label] = value;
                });
                if (Object.keys(specs).length > 0) enriched.specifications = specs;

                // 3. Brand specific (Stylevana)
                if (window.location.href.includes('stylevana.com')) {
                    const ingEl = document.querySelector('#product-attribute-specs-table-ingredients') || document.querySelector('.ingredients-content');
                    if (ingEl) enriched.ingredients = ingEl.innerText.trim();
                }

                return enriched;
            });

            await doc.ref.set({
                enriched_at: new Date(),
                final_url: finalUrl,
                rating: results.ratingValue || null,
                reviewCount: results.reviewCount || null,
                longDescription: results.longDescription || null,
                specifications: results.specifications || null,
                ingredients: results.ingredients || null,
                sku: results.sku || data.sku || null
            }, { merge: true });

            console.log(`✅ Success: ${data.name} (Rating: ${results.ratingValue || 'N/A'})`);

        } catch (err) {
            console.error(`❌ Failed: ${data.name} - ${err.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
    console.log('Done.');
}

enrichProducts('Stylevana', 10);
