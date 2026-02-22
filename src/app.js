const express = require('express');
const path = require('path');
const config = require('./config/env');
const dashboardController = require('./controllers/dashboardController');
const productController = require('./controllers/productController');
const cron = require('node-cron');
const dataSync = require('./services/dataSync');
const { getGlobalSettings } = require('./services/db');
const firebaseAdmin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config({ override: true });

console.log('[DEBUG-ENV] Available Env Vars:', Object.keys(process.env).join(', '));

const app = express();

app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// --- Helper function to get a secret (Env Var Only) ---
// We have removed Google Secret Manager to strictly rely on Environment Variables
// which provides better stability on platforms like Render.
const getSecret = (name) => {
    if (process.env[name]) {
        return process.env[name];
    }
    return undefined;
};

// --- App Initialization ---
const initializeApp = async () => {
    try {
        console.log("Attempting to load configuration...");

        // --- STEP 1: Load Firebase Creds ---
        // We rely on standard GOOGLE_APPLICATION_CREDENTIALS env var pointing to a file.
        // On Render, this points to /etc/secrets/service-account.json
        // On Local, it might point to ./service-account.json or be undefined.

        // Debug logging
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            console.log(`[DEBUG] GOOGLE_APPLICATION_CREDENTIALS is set to: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
        } else {
            console.log('[DEBUG] GOOGLE_APPLICATION_CREDENTIALS is NOT set. Firebase might fail if not on GCP.');
        }

        // Helper to strip quotes if present
        const cleanStr = (s) => s ? s.replace(/^["']|["']$/g, '').trim() : s;

        const rootSA = path.join(__dirname, '../service-account.json');
        let projectId = cleanStr(process.env.GCP_PROJECT_ID);

        // Force correct project ID if incorrectly set in environment
        if (projectId === 'wide-graph-464200-d7') {
            console.log(`[WARN] Stale Project ID detected. Overriding with 'offerbae-com'.`);
            projectId = 'offerbae-com';
        }

        const storageBucket = cleanStr(process.env.FIREBASE_STORAGE_BUCKET) || 'offerbae-com.firebasestorage.app';

        const initOptions = {
            storageBucket: storageBucket,
            projectId: projectId || 'offerbae-com'
        };

        // If local service-account.json exists, use it as it's the verified credential for offerbae-com
        if (fs.existsSync(rootSA)) {
            console.log(`[DEBUG] Found local service-account.json at ${rootSA}. Using for initialization.`);
            initOptions.credential = firebaseAdmin.credential.cert(rootSA);
        }

        if (!firebaseAdmin.apps.length) {
            console.log(`[DEBUG] Initializing Firebase Admin SDK with options:`, JSON.stringify(initOptions));
            const app = firebaseAdmin.initializeApp(initOptions);
            console.log(`[DEBUG] Firebase initialized. Project ID from Options: ${app.options.projectId || 'Auto-Detected'}`);
            console.log("Firebase Admin SDK initialized successfully.");
        }

        // --- STEP 2: Load API credentials ---
        const secretsMap = {
            'RAKUTEN_CLIENT_ID': 'RAKUTEN_CLIENT_ID',
            'RAKUTEN_CLIENT_SECRET': 'RAKUTEN_CLIENT_SECRET',
            'RAKUTEN_SITE_ID': 'RAKUTEN_SITE_ID',
            'CJ_PERSONAL_ACCESS_TOKEN': 'CJ_PERSONAL_ACCESS_TOKEN',
            'CJ_COMPANY_ID': 'CJ_COMPANY_ID',
            'CJ_WEBSITE_ID': 'CJ_WEBSITE_ID',
            'AWIN_ACCESS_TOKEN': 'AWIN_ACCESS_TOKEN',
            'AWIN_PUBLISHER_ID': 'AWIN_PUBLISHER_ID',
            'BRANDFETCH_API_KEY': 'BRANDFETCH_API_KEY',
            'PEPPERJAM_API_KEY': 'PEPPERJAM_API_KEY'
        };

        for (const [secretName, envName] of Object.entries(secretsMap)) {
            const val = await getSecret(secretName);
            if (val) {
                process.env[envName] = val;
            }
        }

        console.log('API credentials loaded and environment configured.');

    } catch (error) {
        console.error("Error initializing app:", error.message);
    }
};


// View Engine Setup
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');
app.set('view cache', false); // Disable view caching

// Global Cache-Control Middleware
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    // Enhanced CSP for local development stability and devtools compatibility
    res.set('Content-Security-Policy', "default-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*;");
    next();
});

// Favicon Routing
app.get('/favicon.ico', (req, res) => res.redirect('/favicon.png'));

// Chrome DevTools Connectivity
app.all('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(200).json({ ok: true });
});

// Static Files
app.use(express.static(path.join(__dirname, '../public'), {
    etag: false,
    lastModified: false
}));

// Explicit manual sync route for debugging/triggering
app.get('/update/full-sync', async (req, res) => {
    try {
        await dataSync.syncAll();
        res.send('Sync initiated. Check server logs.');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for CJ only
app.get('/update/cj-sync', async (req, res) => {
    try {
        // Run in background, don't await
        dataSync.syncCJAll().catch(e => console.error(e));
        res.send('CJ Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for Rakuten only
app.get('/update/rakuten-sync', async (req, res) => {
    try {
        dataSync.syncRakutenAll().catch(e => console.error(e));
        res.send('Rakuten Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for AWIN only
app.get('/update/awin-sync', async (req, res) => {
    try {
        dataSync.syncAWINAll().catch(e => console.error(e));
        res.send('AWIN Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for Pepperjam only
app.get('/update/pepperjam-sync', async (req, res) => {
    try {
        dataSync.syncPepperjamAll().catch(e => console.error(e));
        res.send('Pepperjam Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Sync Status & History API
app.get('/api/sync-status', (req, res) => {
    res.json(dataSync.getGlobalSyncState());
});

app.get('/api/sync-history/:network', async (req, res) => {
    try {
        const history = await dataSync.getSyncHistory(req.params.network);
        res.json(history);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Routes
// Routes
// Routes
app.get('/', dashboardController.getNewHomepage);
app.get('/mission-control/architecture', dashboardController.getArchitecture);
app.get('/mission-control/style', dashboardController.getStyle);
app.post('/mission-control/style', (req, res, next) => {
    console.log('DEBUG: Hit /mission-control/style route');
    next();
}, dashboardController.uploadStyleMiddleware, dashboardController.updateStyle);
app.post('/refresh', dashboardController.refreshData);
app.get('/api/advertiser/:id/products', dashboardController.getAdvertiserProducts);
app.get('/api/advertiser/:id/offers', dashboardController.getAdvertiserOffers);
// Logo Upload & Reset Routes
app.post('/api/advertiser/:id/logo/upload', dashboardController.uploadLogoMiddleware, dashboardController.uploadLogo);
app.post('/api/advertiser/:id/logo/reset', dashboardController.resetLogo);
app.post('/api/advertiser/:id/homelink', express.json(), dashboardController.updateHomeLink);
app.post('/api/advertiser/:id/description', express.json(), dashboardController.updateDescription);
app.get('/api/products/search', dashboardController.globalProductSearch);
app.get('/api/proxy-image', dashboardController.proxyImage);
app.get('/mission-control', dashboardController.getDashboardData);

// SEO & Catalog Routes (Must be last to avoid catching specific routes)
app.get('/brands', dashboardController.getHomepage);
app.get('/brand/:idSlug', productController.getCatalogPage);
app.get('/categories', productController.getCategoriesPage);
app.get('/category/:slug', productController.getCategoryPage);
app.get('/offers', productController.getOffersListPage);
app.get('/offer/:brandSlug/:idSlug', productController.getOfferDetailPage);
app.get('/products', productController.getProductsListPage);
app.get('/product/:brandSlug/:idSlug', productController.getProductDetail);
app.get('/calendar', productController.getCalendarListPage);
app.get('/calendar/:slug', productController.getCalendarEventPage);
app.get('/journal', productController.getJournalListPage);
app.get('/journal/:slug', productController.getJournalArticlePage);

// Export the new controller function if it's not already exported
// Note: We need to make sure globalProductSearch is in the exports of dashboardController.js

// Helper to extract numeric percentage discount from description
const extractDiscountValue = (desc) => {
    if (!desc) return 0;
    const match = desc.match(/(\d+)%/);
    return match ? parseInt(match[1]) : 0;
};

app.get('/fresh', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const { getEnrichedAdvertisers } = require('./services/db');
        const enrichedBrands = await getEnrichedAdvertisers();

        // Fetch top 6 on-sale products for the premium carousel
        const db = firebaseAdmin.firestore();
        const productsSnapshot = await db.collection('products')
            .where('savingsAmount', '>', 0)
            .orderBy('savingsAmount', 'desc')
            .limit(12)
            .get();

        const topSaleProducts = productsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                price: parseFloat(data.price) || 0,
                salePrice: parseFloat(data.salePrice) || 0,
                savings: data.savingsAmount || 0,
                discountPercent: data.price && data.salePrice ? Math.round((1 - (data.salePrice / data.price)) * 100) : 0
            };
        });

        // Fetch active offers with codes and sort by discount/recency
        const offersSnapshot = await db.collection('offers')
            .get();

        // Map logoUrls from enrichedBrands for quick lookup
        const brandLogoMap = new Map();
        enrichedBrands.forEach(b => {
            const brandId = (b.id || b.advertiserId || b.data_id || (b.raw_data && b.raw_data.id))?.toString();
            if (brandId && b.logoUrl) {
                brandLogoMap.set(brandId, b.logoUrl);
            }
        });

        const topOffers = offersSnapshot.docs
            .map(doc => {
                const data = doc.data();
                let expiresAt = 'Ongoing';
                if (data.endDate) {
                    try {
                        const date = new Date(data.endDate);
                        if (!isNaN(date.getTime())) {
                            expiresAt = date.toLocaleDateString();
                        }
                    } catch (e) { }
                }

                const offId = (data.advertiserId || data.id || data.data_id)?.toString();
                return {
                    ...data,
                    id: doc.id,
                    expiresAt,
                    updatedAtTime: data.updatedAt ? (data.updatedAt._seconds || new Date(data.updatedAt).getTime()) : 0,
                    discountValue: extractDiscountValue(data.description || data.name),
                    isPromoCode: !!(data.code && data.code !== 'N/A' && data.code !== ''), brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null
                };
            })
            .filter(o => o.code && o.code !== 'N/A' && o.code !== '') // Stick to codes only
            .sort((a, b) => {
                // Sort by discountValue desc, then updatedAtTime desc
                if (b.discountValue !== a.discountValue) {
                    return b.discountValue - a.discountValue;
                }
                return b.updatedAtTime - a.updatedAtTime;
            })
            .slice(0, 9);

        // Filter for brands that have BOTH on-sale products AND code offers
        let performanceBrands = enrichedBrands.filter(b => (b.saleProductCount > 0) && (b.hasPromoCodes === true)).map(b => ({
            name: b.name,
            slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
            logoUrl: b.logoUrl,
            offerCount: b.offerCount || 0,
            productCount: b.productCount || 0,
            saleProductCount: b.saleProductCount || 0,
            hasPromoCodes: b.hasPromoCodes || false,
            categories: b.categories || (b.raw_data && b.raw_data.categories) || []
        }));

        // Extract unique categories
        const { slugify } = require('./services/db');
        const categoryMap = new Map();
        enrichedBrands.forEach(b => {
            const cats = b.categories || (b.raw_data && b.raw_data.categories) || [];
            cats.forEach(c => {
                if (c && !categoryMap.has(c)) {
                    categoryMap.set(c, slugify(c));
                }
            });
        });
        const categoriesRaw = Array.from(categoryMap.entries())
            .map(([name, slug]) => ({ name: name.trim(), slug }));

        // Refine list: Add "All Categories" to start and move all "Other..." items to end
        const otherItems = categoriesRaw.filter(c => c.name.toLowerCase().includes('other'));
        const mainCategories = categoriesRaw.filter(c => !c.name.toLowerCase().includes('other'))
            .sort((a, b) => a.name.localeCompare(b.name));

        const finalCategories = [
            { name: 'All Categories', slug: '' },
            ...mainCategories,
            ...otherItems
        ];

        // Deduplicate by name to ensure unique brands
        const uniquePerformanceBrands = [];
        const seenNames = new Set();
        for (const brand of performanceBrands) {
            if (!seenNames.has(brand.name)) {
                uniquePerformanceBrands.push(brand);
                seenNames.add(brand.name);
            }
        }

        res.render('fresh-index', {
            settings,
            brands: uniquePerformanceBrands,
            categories: finalCategories,
            topSaleProducts,
            topOffers,
            breadcrumbPath: []
        });
    } catch (err) {
        console.error('Error fetching settings for fresh build:', err);
        res.render('fresh-index', { settings: {}, brands: [], breadcrumbPath: [] });
    }
});

// Top Brands Index
app.get('/fresh/brands', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const { getEnrichedAdvertisers } = require('./services/db');
        const enrichedBrands = await getEnrichedAdvertisers();

        let brandsList = enrichedBrands.map(b => ({
            name: b.name,
            slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
            logoUrl: b.logoUrl,
            offerCount: b.offerCount || 0,
            productCount: b.productCount || 0,
            saleProductCount: b.saleProductCount || 0,
            hasPromoCodes: b.hasPromoCodes || false,
            categories: b.categories || (b.raw_data && b.raw_data.categories) || []
        }));

        // Filter for brands with content and sort alphabetically by name by default
        brandsList = brandsList.filter(b => (b.offerCount + b.productCount) > 0)
            .sort((a, b) => a.name.localeCompare(b.name));

        // Extract unique categories
        const { slugify } = require('./services/db');
        const categoryMap = new Map();
        enrichedBrands.forEach(b => {
            const cats = b.categories || (b.raw_data && b.raw_data.categories) || [];
            cats.forEach(c => {
                if (c && !categoryMap.has(c)) {
                    categoryMap.set(c, slugify(c));
                }
            });
        });
        const categoriesRaw = Array.from(categoryMap.entries())
            .map(([name, slug]) => ({ name: name.trim(), slug }));

        // Refine list: Add "All Categories" to start and move all "Other..." items to end
        const otherItems = categoriesRaw.filter(c => c.name.toLowerCase().includes('other'));
        const mainCategories = categoriesRaw.filter(c => !c.name.toLowerCase().includes('other'))
            .sort((a, b) => a.name.localeCompare(b.name));

        const finalCategories = [
            { name: 'All Categories', slug: '' },
            ...mainCategories,
            ...otherItems
        ];

        res.render('fresh-brands', {
            settings,
            brands: brandsList,
            categories: finalCategories,
            pageH1: "Top Brands with Amazing Products and Offers",
            breadcrumbPath: [{ name: 'Brands', url: '/fresh/brands' }]
        });
    } catch (err) {
        console.error('Error fetching brands for fresh build:', err);
        res.status(500).send("Error loading Brands");
    }
});

// Fresh Products Page
app.get('/fresh/products', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const db = firebaseAdmin.firestore();

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 60;
        const onSale = req.query.onSale !== 'false'; // Default to true
        const offset = (page - 1) * limit;

        let query = db.collection('products');

        if (onSale) {
            query = query.where('savingsAmount', '>', 0).orderBy('savingsAmount', 'desc');
        } else {
            // If not on sale, maybe order by name or something standard
            query = query.orderBy('name');
        }

        const productsSnapshot = await query
            .offset(offset)
            .limit(limit)
            .get();

        const products = productsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                price: parseFloat(data.price) || 0,
                salePrice: parseFloat(data.salePrice) || 0,
                savings: data.savingsAmount || 0,
                discountPercent: data.price && data.salePrice ? Math.round((1 - (data.salePrice / data.price)) * 100) : 0
            };
        });

        // Get total count for pagination (or at least check if there's more)
        const hasMore = products.length === limit;

        res.render('fresh-products', {
            settings,
            products,
            pageH1: "Products",
            currentPage: page,
            limit,
            onSale,
            hasMore,
            breadcrumbPath: [{ name: 'Products', url: '/fresh/products' }]
        });
    } catch (err) {
        console.error('Error loading fresh products:', err);
        res.status(500).send("Error loading Products");
    }
});

// Fresh Offers Page
app.get('/fresh/offers', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const db = firebaseAdmin.firestore();
        const { getEnrichedAdvertisers } = require('./services/db');
        const enrichedBrands = await getEnrichedAdvertisers();

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 60;
        const offset = (page - 1) * limit;

        // Map logoUrls
        const brandLogoMap = new Map();
        enrichedBrands.forEach(b => {
            const brandId = (b.id || b.advertiserId || b.data_id || (b.raw_data && b.raw_data.id))?.toString();
            if (brandId && b.logoUrl) brandLogoMap.set(brandId, b.logoUrl);
        });

        // We fetch all code-bearing offers for sorting/paging on server
        // Note: For very large datasets, we'd want to index discountValue and updatedAtTime in Firestore
        const offersSnapshot = await db.collection('offers')
            .get();

        const allOffers = offersSnapshot.docs
            .map(doc => {
                const data = doc.data();
                let expiresAt = 'Ongoing';
                if (data.endDate) {
                    try {
                        const date = new Date(data.endDate);
                        if (!isNaN(date.getTime())) expiresAt = date.toLocaleDateString();
                    } catch (e) { }
                }

                const offId = (data.advertiserId || data.id || data.data_id)?.toString();
                return {
                    ...data,
                    id: doc.id,
                    expiresAt,
                    updatedAtTime: data.updatedAt ? (data.updatedAt._seconds || new Date(data.updatedAt).getTime()) : 0,
                    discountValue: extractDiscountValue(data.description || data.name),
                    isPromoCode: !!(data.code && data.code !== 'N/A' && data.code !== ''),
                    brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null
                };
            })
            .filter(o => o.code && o.code !== 'N/A' && o.code !== '')
            .sort((a, b) => {
                if (b.discountValue !== a.discountValue) return b.discountValue - a.discountValue;
                return b.updatedAtTime - a.updatedAtTime;
            });

        const paginatedOffers = allOffers.slice(offset, offset + limit);
        const hasMore = allOffers.length > offset + limit;

        res.render('fresh-offers', {
            settings,
            offers: paginatedOffers,
            pageH1: "Offers",
            currentPage: page,
            limit,
            hasMore,
            breadcrumbPath: [{ name: 'Offers', url: '/fresh/offers' }]
        });
    } catch (err) {
        console.error('Error loading fresh offers:', err);
        res.status(500).send("Error loading Offers");
    }
});

// Dynamic Route for the Brand Hub
app.get('/fresh/brands/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const settings = await getGlobalSettings();
        const firebase = require('./config/firebase');
        const db = firebase.db;

        // 1. Fetch Advertiser by Slug
        const advSnapshot = await db.collection('advertisers')
            .where('slug', '==', slug)
            .limit(1)
            .get();

        if (advSnapshot.empty) {
            return res.status(404).render('404', { message: 'Brand not found' });
        }

        const brandDoc = advSnapshot.docs[0];
        const brandData = brandDoc.data();
        const brandId = (brandData.id || brandData.advertiserId || brandData.data_id || (brandData.raw_data && brandData.raw_data.id))?.toString();

        const brand = {
            name: brandData.name,
            slug: brandData.slug,
            logoUrl: brandData.storageLogoUrl || brandData.logoUrl || (brandData.raw_data && brandData.raw_data.logoUrl)
        };

        // 2. Fetch Offers for this Brand
        const offersSnapshot = await db.collection('offers')
            .where('advertiserId', '==', brandId)
            .get();

        const offers = offersSnapshot.docs.map(doc => {
            const data = doc.data();
            let expiresAt = 'Ongoing';
            if (data.endDate) {
                try {
                    const date = new Date(data.endDate);
                    if (!isNaN(date.getTime())) expiresAt = date.toLocaleDateString();
                } catch (e) { }
            }
            return {
                ...data,
                id: doc.id,
                expiresAt,
                isPromoCode: !!(data.code && data.code !== 'N/A' && data.code !== ''),
                discountBadge: data.isPromoCode ? 'CODE' : (data.description?.match(/(\d+%)|(\$\d+)/)?.[0] || 'DEAL')
            };
        });

        // 3. Fetch Products for this Brand
        const productsSnapshot = await db.collection('products')
            .where('advertiserId', '==', brandId)
            .limit(20)
            .get();

        const products = productsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                imageUrl: data.storageImageUrl || data.imageUrl
            };
        });

        res.render('fresh-brand', {
            settings,
            brand,
            offers,
            products,
            pageH1: `${brand.name} Deals & Products`,
            breadcrumbPath: [
                { name: 'Brands', url: '/fresh/brands' },
                { name: brand.name, url: `/fresh/brands/${brand.slug}` }
            ]
        });
    } catch (err) {
        console.error('Error resolving brand hub:', err);
        res.status(500).send("Error loading Brand Hub");
    }
});

app.get('/api/fresh/offers', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 9;
        const offset = parseInt(req.query.offset) || 0;

        const db = firebaseAdmin.firestore();

        const offersSnapshot = await db.collection('offers')
            .get();

        // Fetch brands to get logos for the API response as well
        const brandsSnapshot = await db.collection('advertisers').get();
        const brandLogoMap = new Map();
        brandsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const brandId = (data.id || data.advertiserId || data.data_id || (data.raw_data && data.raw_data.id))?.toString();
            const logo = data.storageLogoUrl || data.logoUrl || (data.raw_data && data.raw_data.logoUrl);
            if (brandId && logo) {
                brandLogoMap.set(brandId, logo);
            }
        });

        const allOffers = offersSnapshot.docs
            .map(doc => {
                const data = doc.data();
                let expiresAt = 'Ongoing';
                if (data.endDate) {
                    try {
                        const date = new Date(data.endDate);
                        if (!isNaN(date.getTime())) {
                            expiresAt = date.toLocaleDateString();
                        }
                    } catch (e) { }
                }

                const offId = (data.advertiserId || data.id || data.data_id)?.toString();
                return {
                    ...data,
                    id: doc.id,
                    expiresAt,
                    updatedAtTime: data.updatedAt ? (data.updatedAt._seconds || new Date(data.updatedAt).getTime()) : 0,
                    discountValue: extractDiscountValue(data.description || data.name),
                    isPromoCode: !!(data.code && data.code !== 'N/A' && data.code !== ''), brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null
                };
            })
            .filter(o => o.code && o.code !== 'N/A' && o.code !== '') // Stick to codes only
            .sort((a, b) => {
                if (b.discountValue !== a.discountValue) {
                    return b.discountValue - a.discountValue;
                }
                return b.updatedAtTime - a.updatedAtTime;
            });

        const paginatedOffers = allOffers.slice(offset, offset + limit);
        const hasMore = allOffers.length > offset + limit;

        res.json({
            offers: paginatedOffers,
            hasMore
        });
    } catch (err) {
        console.error('Error fetching fresh offers:', err);
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});

app.get('/api/fresh/search', async (req, res) => {
    try {
        const q = req.query.q;
        if (!q || q.length < 2) return res.json({ brands: [], products: [], offers: [] });

        const firebase = require('./config/firebase');
        const lowerStr = q.toLowerCase();
        const upperStr = q.toUpperCase();
        const searchStr = q.charAt(0).toUpperCase() + q.slice(1);

        // Helper for Firestore prefix search
        const prefixSearch = async (collection, field, overrideStr = null) => {
            const str = overrideStr || searchStr;
            const snapshot = await firebase.db.collection(collection)
                .where(field, '>=', str)
                .where(field, '<=', str + '\uf8ff')
                .limit(5)
                .get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };

        const [
            brandsTitle, brandsLower, brandsUpper, brandsLiteral,
            productsTitle, productsLower, productsUpper, productsLiteral,
            offersByDesc, offersByAdvertiser, offersByAdvertiserLower, offersByLiteral
        ] = await Promise.all([
            prefixSearch('advertisers', 'name'),
            prefixSearch('advertisers', 'name', lowerStr),
            prefixSearch('advertisers', 'name', upperStr),
            prefixSearch('advertisers', 'name', q), // Literal search for "UNice" etc.
            prefixSearch('products', 'name'),
            prefixSearch('products', 'name', lowerStr),
            prefixSearch('products', 'name', upperStr),
            prefixSearch('products', 'name', q),
            prefixSearch('offers', 'description'),
            prefixSearch('offers', 'advertiser'),
            prefixSearch('offers', 'advertiser', lowerStr),
            prefixSearch('offers', 'advertiser', q)
        ]);

        // Combine and deduplicate
        const dedup = (arrs) => {
            const map = new Map();
            arrs.flat().forEach(item => {
                if (item && item.id) map.set(item.id, item);
            });
            return Array.from(map.values()).slice(0, 5);
        };

        const finalBrands = dedup([brandsTitle, brandsLower, brandsUpper, brandsLiteral]);
        const finalProducts = dedup([productsTitle, productsLower, productsUpper, productsLiteral]);
        const finalOffers = dedup([offersByDesc, offersByAdvertiser, offersByAdvertiserLower, offersByLiteral]);

        console.log(`[Search] Query: "${q}" -> B:${finalBrands.length}, P:${finalProducts.length}, O:${finalOffers.length}`);

        // Enforce specific fields and formatting for the frontend
        res.json({
            brands: finalBrands.map(b => ({
                name: b.name,
                slug: b.slug,
                logoUrl: b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl)
            })),
            products: finalProducts.map(p => ({
                name: p.name,
                slug: p.slug,
                imageUrl: p.storageImageUrl || p.imageUrl,
                price: p.price,
                salePrice: p.salePrice
            })),
            offers: finalOffers.map(o => ({
                name: o.description || o.name,
                id: o.id,
                network: o.network,
                isPromoCode: !!o.promoCode,
                advertiser: o.advertiser
            }))
        });
    } catch (err) {
        console.error('Search API Error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

// 404 Handler
app.use((req, res) => {
    res.status(404).render('404', { message: "We couldn't find what you were looking for.", pageH1: 'Not Found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('GLOBAL ERROR:', err);
    res.status(500).render('404', { message: "Internal Server Error: " + err.message, pageH1: 'Error' });
});

// Initialize and Start Server
initializeApp().then(() => {
    // Schedule task to run every 4 hours
    cron.schedule('0 */4 * * *', () => {
        console.log('CRON: Starting scheduled data sync...');
        dataSync.syncAll();
    });

    app.listen(config.port, () => {
        console.log(`Server running at http://localhost:${config.port}`);
    });
});
