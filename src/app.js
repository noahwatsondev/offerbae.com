const express = require('express');
const path = require('path');
const config = require('./config/env');
const dashboardController = require('./controllers/dashboardController');
const cron = require('node-cron');
const dataSync = require('./services/dataSync');
const { getGlobalSettings, getEnrichedAdvertisers, isRealCode, slugify, extractCodeFromDescription } = require('./services/db');
const firebaseAdmin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config({ override: true });

const app = express();

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
app.get('/mission-control/architecture', dashboardController.getArchitecture);
app.get('/mission-control/style', dashboardController.getStyle);
app.post('/mission-control/style', (req, res, next) => {

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


// Export the new controller function if it's not already exported
// Note: We need to make sure globalProductSearch is in the exports of dashboardController.js

// Helper to extract numeric percentage discount from description
const extractDiscountValue = (desc) => {
    if (!desc) return 0;
    const match = desc.match(/(\d+)%/);
    return match ? parseInt(match[1]) : 0;
};

// Helper to map a Firestore product doc into a view-ready object
// with all the fields that product-card.ejs expects
const mapProductDoc = (doc, overrides = {}) => {
    const data = doc.data ? doc.data() : doc;
    const id = doc.id || data.id;
    const price = parseFloat(data.price) || 0;
    const salePrice = parseFloat(data.salePrice) || 0;
    const hasDiscount = price > salePrice && salePrice > 0;
    return {
        ...data,
        id,
        price,
        salePrice,
        savings: hasDiscount ? price - salePrice : 0,
        discountPercent: hasDiscount ? Math.round((1 - salePrice / price) * 100) : 0,
        imageUrl: data.storageImageUrl || data.imageUrl,
        brandSlug: overrides.brandSlug || data.brandSlug || slugify(data.advertiserName || data.advertiser || ''),
        ...overrides
    };
};

// Helper to map a Firestore offer doc into a view-ready object.
// Auto-extracts code from description if the stored code field is invalid.
const mapOfferDoc = (doc, overrides = {}) => {
    const data = doc.data ? doc.data() : doc;
    const id = doc.id || data.id;
    let expiresAt = 'Ongoing';
    if (data.endDate) {
        try {
            const date = new Date(data.endDate);
            if (!isNaN(date.getTime())) expiresAt = date.toLocaleDateString();
        } catch (e) { }
    }
    const extractedCode = !isRealCode(data.code) ? extractCodeFromDescription(data.description) : null;
    const resolvedCode = isRealCode(data.code) ? data.code : extractedCode;
    const resolvedIsPromoCode = isRealCode(resolvedCode);
    return {
        ...data,
        id,
        expiresAt,
        code: resolvedCode || data.code,
        isPromoCode: resolvedIsPromoCode,
        discountBadge: resolvedIsPromoCode ? 'CODE' : (data.description?.match(/(\d+%)|(\$\d+)/)?.[0] || 'DEAL'),
        discountValue: extractCodeFromDescription(data.description) ? 0 : (data.discountValue || 0),
        updatedAtTime: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.updatedAtTime || 0),
        ...overrides
    };
};

// Helper to fetch and format global dynamic categories
const getGlobalCategories = async (prefetchedBrands = null) => {
    const enrichedBrands = prefetchedBrands || await getEnrichedAdvertisers();

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

    const otherItems = categoriesRaw.filter(c => c.name.toLowerCase().includes('other'));
    const mainCategories = categoriesRaw.filter(c => !c.name.toLowerCase().includes('other'))
        .sort((a, b) => a.name.localeCompare(b.name));

    return [
        { name: 'All Categories', slug: '' },
        ...mainCategories,
        ...otherItems
    ];
};

// --- Sidebar Global Caching Middleware ---
let sidebarCache = null;
let sidebarCacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const populateSidebar = async (req, res, next) => {
    try {
        const now = Date.now();
        if (sidebarCache && now - sidebarCacheTime < CACHE_TTL) {
            res.locals.sidebarData = sidebarCache;
            return next();
        }

        const db = firebaseAdmin.firestore();

        // Fetch 5 newest Brands
        const enrichedBrands = await getEnrichedAdvertisers();
        const newestBrands = enrichedBrands
            .filter(b => b.productCount > 0 || b.offerCount > 0)
            .sort((a, b) => {
                const aTime = a.updatedAt ? (a.updatedAt._seconds || new Date(a.updatedAt).getTime() || 0) : 0;
                const bTime = b.updatedAt ? (b.updatedAt._seconds || new Date(b.updatedAt).getTime() || 0) : 0;
                return bTime - aTime;
            })
            .slice(0, 5)
            .map(b => ({
                name: b.name,
                slug: b.slug,
                logoUrl: b.logoUrl,
                count: (b.productCount || 0) + (b.offerCount || 0)
            }));

        // Fetch 5 newest Products
        const productsSnapshot = await db.collection('products')
            .orderBy('updatedAt', 'desc')
            .limit(5)
            .get();
        const newestProducts = productsSnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                slug: data.slug,
                brandSlug: slugify(data.advertiserName || data.advertiser || ''),
                link: data.link || '',
                imageUrl: data.storageImageUrl || data.imageUrl,
                brandName: data.advertiserName || data.advertiser || '',
                price: data.price,
                salePrice: data.salePrice
            };
        });

        // Fetch 5 newest Offers
        // Note: For large collections, orderBy requires a composite index if combining with filters.
        // We'll just grab the 5 newest globally for the sidebar
        const offersSnapshot = await db.collection('offers')
            .orderBy('updatedAt', 'desc')
            .limit(5)
            .get();

        // Map logos for offers
        const brandLogoMap = new Map();
        enrichedBrands.forEach(b => {
            const brandId = (b.id || b.advertiserId || b.data_id || (b.raw_data && b.raw_data.id))?.toString();
            if (brandId && b.logoUrl) brandLogoMap.set(brandId, b.logoUrl);
        });

        const newestOffers = offersSnapshot.docs.map(doc => {
            const data = doc.data();
            const offId = (data.advertiserId || data.id || data.data_id)?.toString();

            let expiresAt = 'Ongoing';
            if (data.endDate) {
                try {
                    const date = new Date(data.endDate);
                    if (!isNaN(date.getTime())) expiresAt = date.toLocaleDateString();
                } catch (e) { }
            }

            return {
                id: doc.id,
                description: data.description || data.name,
                brandName: data.advertiser || 'Brand',
                isPromoCode: isRealCode(data.code),
                code: data.code,
                brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null,
                brandSlug: data.advertiserSlug || slugify(data.advertiser || data.advertiserName || ''),
                expiresAt,
                clickUrl: data.clickUrl || data.link
            };
        });

        sidebarCache = { newestBrands, newestProducts, newestOffers };
        sidebarCacheTime = now;
        res.locals.sidebarData = sidebarCache;
    } catch (err) {
        console.error('Error populating sidebar:', err);
        res.locals.sidebarData = { newestBrands: [], newestProducts: [], newestOffers: [] };
    }
    next();
};

app.get('/', populateSidebar, async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const enrichedBrands = await getEnrichedAdvertisers();

        // Fetch top 6 on-sale products for the premium carousel
        const db = firebaseAdmin.firestore();
        const productsSnapshot = await db.collection('products')
            .where('savingsAmount', '>', 0)
            .orderBy('savingsAmount', 'desc')
            .limit(18)
            .get();

        const topSaleProducts = productsSnapshot.docs.map(doc => mapProductDoc(doc));

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
                return mapOfferDoc(doc, {
                    updatedAtTime: data.updatedAt ? (data.updatedAt._seconds || new Date(data.updatedAt).getTime()) : 0,
                    discountValue: extractDiscountValue(data.description || data.name),
                    brandSlug: data.advertiserSlug || slugify(data.advertiser || data.advertiserName || ''),
                    brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null
                });
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

        // Three-tier brand priority, each tier sorted by total count (products + offers) desc
        const brandSortByTotal = (a, b) =>
            ((b.productCount || 0) + (b.offerCount || 0)) - ((a.productCount || 0) + (a.offerCount || 0));

        const mapBrand = b => ({
            name: b.name,
            slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, ''),
            logoUrl: b.logoUrl,
            offerCount: b.offerCount || 0,
            productCount: b.productCount || 0,
            saleProductCount: b.saleProductCount || 0,
            hasPromoCodes: b.hasPromoCodes || false,
            categories: b.categories || (b.raw_data && b.raw_data.categories) || []
        });

        // Tier 1: on-sale products AND promo code offers
        const tier1 = enrichedBrands
            .filter(b => (b.saleProductCount > 0) && (b.hasPromoCodes === true))
            .sort(brandSortByTotal)
            .map(mapBrand);

        const tier1Names = new Set(tier1.map(b => b.name));

        // Tier 2: on-sale products AND any offers (not already in tier 1)
        const tier2 = enrichedBrands
            .filter(b => (b.saleProductCount > 0) && (b.offerCount > 0) && !tier1Names.has(b.name))
            .sort(brandSortByTotal)
            .map(mapBrand);

        const tier2Names = new Set(tier2.map(b => b.name));

        // Tier 3: has products AND any offers (not already in tiers 1 or 2)
        // Sub-sort: promo code brands first, then by total count desc
        const tier3Sort = (a, b) => {
            if (a.hasPromoCodes !== b.hasPromoCodes) return b.hasPromoCodes ? 1 : -1;
            return ((b.productCount || 0) + (b.offerCount || 0)) - ((a.productCount || 0) + (a.offerCount || 0));
        };
        const tier3 = enrichedBrands
            .filter(b => (b.productCount > 0) && (b.offerCount > 0) && !tier1Names.has(b.name) && !tier2Names.has(b.name))
            .sort(tier3Sort)
            .map(mapBrand);

        const allTiers = [...tier1, ...tier2, ...tier3];

        // Deduplicate by name and take first 16
        const seenNames = new Set();
        const uniquePerformanceBrands = [];
        for (const brand of allTiers) {
            if (!seenNames.has(brand.name)) {
                uniquePerformanceBrands.push(brand);
                seenNames.add(brand.name);
            }
            if (uniquePerformanceBrands.length >= 16) break;
        }

        const finalCategories = await getGlobalCategories(enrichedBrands);

        res.render('page', {
            settings,
            brands: uniquePerformanceBrands,
            products: topSaleProducts,
            offers: topOffers,
            categories: finalCategories,
            showBrands: true,
            showProducts: true,
            showOffers: true,
            brandsH2: "Partner Brands",
            brandsDescription: "Explore our curated directory of premium brand partners.",
            productsH2: "Trending Products",
            productsDescription: "Discover the most sought-after items curated by our editors.",
            offersH2: "Partner Perks",
            offersDescription: "Exclusive perks, rewards, and offers from our brand partners.",
            showBrandsLink: true,
            showProductsLink: true,
            showOffersLink: true,

            showProductsPagination: false,
            showOffersPagination: false,
            breadcrumbPath: []
        });
    } catch (err) {
        console.error('Error fetching settings for fresh build:', err);
        res.render('page', { settings: {}, brands: [], breadcrumbPath: [] });
    }
});

// Top Brands Index
app.get('/brands', populateSidebar, async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const enrichedBrands = await getEnrichedAdvertisers();

        let brandsList = enrichedBrands
            .filter(b => b.name)
            .map(b => ({
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
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        const finalCategories = await getGlobalCategories(enrichedBrands);


        res.render('page', {
            settings,
            brands: brandsList,
            categories: finalCategories,
            showBrands: true,
            showProducts: false,
            showOffers: false,
            brandsH2: "Partner Brands",
            brandsDescription: "Explore our curated directory of premium brand partners.",
            showBrandsLink: false,
            pageH1: "Curated Partner Brands & Stores",
            breadcrumbPath: [{ name: 'Brands', url: '/brands' }]
        });
    } catch (err) {
        console.error('Error fetching brands for fresh build:', err);
        res.status(500).send("Error loading Brands");
    }
});

// Fresh Products Page
app.get('/products', populateSidebar, async (req, res) => {
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

        const products = productsSnapshot.docs.map(doc => mapProductDoc(doc));

        // Get total count for pagination (or at least check if there's more)
        const hasMore = products.length === limit;

        const finalCategories = await getGlobalCategories();

        res.render('page', {
            settings,
            products,
            categories: finalCategories,
            showBrands: false,
            showProducts: true,
            showOffers: false,
            productsH2: "Products",
            showProductsFilters: true,
            showProductsPagination: true,
            pageH1: "Discounted Products & Deals",
            currentPage: page,
            limit,
            onSale,
            hasMore,
            breadcrumbPath: [{ name: 'Products', url: '/products' }]
        });
    } catch (err) {
        console.error('Error loading fresh products:', err);
        res.status(500).send("Error loading Products");
    }
});

// Fresh Offers Page
app.get('/offers', populateSidebar, async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const db = firebaseAdmin.firestore();
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
                return mapOfferDoc(doc, {
                    updatedAtTime: data.updatedAt ? (data.updatedAt._seconds || new Date(data.updatedAt).getTime()) : 0,
                    discountValue: extractDiscountValue(data.description || data.name),
                    brandSlug: data.advertiserSlug || slugify(data.advertiser || data.advertiserName || ''),
                    brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null
                });
            })
            .filter(o => o.code && o.code !== 'N/A' && o.code !== '')
            .sort((a, b) => {
                if (b.discountValue !== a.discountValue) return b.discountValue - a.discountValue;
                return b.updatedAtTime - a.updatedAtTime;
            });

        const paginatedOffers = allOffers.slice(offset, offset + limit);
        const finalCategories = await getGlobalCategories(enrichedBrands);
        const hasMore = allOffers.length > offset + limit;

        res.render('page', {
            settings,
            offers: paginatedOffers,
            categories: finalCategories,
            showBrands: false,
            showProducts: false,
            showOffers: true,
            offersH2: "Offers",
            showOffersFilters: true,
            showOffersPagination: true,
            pageH1: "Latest Promo Codes & Coupon Offers",
            currentPage: page,
            limit,
            hasMore,
            breadcrumbPath: [{ name: 'Offers', url: '/offers' }]
        });
    } catch (err) {
        console.error('Error loading fresh offers:', err);
        res.status(500).send("Error loading Offers");
    }
});

// Redirect legacy /coupons/:slug URLs to /offers/:slug
app.get('/coupons/:slug', (req, res) => {
    res.redirect(301, `/offers/${req.params.slug}`);
});

// Dynamic Route for the Brand Hub
app.get('/brands/:slug', populateSidebar, async (req, res) => {
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

        const finalCategories = await getGlobalCategories();

        const brand = {
            name: brandData.name,
            slug: brandData.slug,
            logoUrl: brandData.storageLogoUrl || brandData.logoUrl || (brandData.raw_data && brandData.raw_data.logoUrl),
            categories: (brandData.categories || []).map(catName => {
                const found = finalCategories.find(c => c.name.toLowerCase() === catName.toLowerCase());
                return {
                    name: catName,
                    slug: found ? found.slug : catName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '')
                };
            })
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
            // Auto-extract code from description if the stored code field is invalid
            const extractedCode = !isRealCode(data.code) ? extractCodeFromDescription(data.description) : null;
            const resolvedCode = isRealCode(data.code) ? data.code : extractedCode;
            return {
                ...data,
                id: doc.id,
                expiresAt,
                code: resolvedCode || data.code,
                isPromoCode: isRealCode(resolvedCode),
                brandSlug: brand.slug,
                brandLogo: brand.logoUrl,
                discountBadge: isRealCode(resolvedCode) ? 'CODE' : (data.description?.match(/(\d+%)|(\$\d+)/)?.[0] || 'DEAL')
            };
        });

        // 3. Fetch Products for this Brand
        const productsSnapshot = await db.collection('products')
            .where('advertiserId', '==', brandId)
            .limit(20)
            .get();

        const products = productsSnapshot.docs.map(doc => mapProductDoc(doc, { brandSlug: slugify((doc.data().advertiserName || doc.data().advertiser || '')) }));



        const isCouponRoute = req.path.startsWith('/coupons');

        const pageH1 = isCouponRoute
            ? `10+ ${brand.name} Promo Codes, Coupons & Discounts (${new Date().getFullYear()})`
            : `${brand.name}`;

        const pageH1Sub = isCouponRoute
            ? "Verified Offers & Deals"
            : "Explore Products & Offers";

        const breadcrumbUrl = isCouponRoute ? `/coupons/${brand.slug}` : `/brands/${brand.slug}`;
        const rootBreadcrumb = isCouponRoute ? { name: 'Coupons', url: '/offers' } : { name: 'Brands', url: '/brands' };

        res.render('page', {
            settings,
            brand,
            offers,
            products,
            categories: finalCategories,
            showBrands: false,
            showProducts: products.length > 0,
            showOffers: offers.length > 0,
            productsH2: "Top Products",
            offersH2: "Partner Perks",
            offersDescription: `Active promo codes and top deals from ${brand.name}.`,
            pageLogo: brand.logoUrl,
            pageH1: `${brand.name}`,
            pageH1Sub: "Explore Products & Offers",
            pageCategories: brand.categories,
            breadcrumbPath: [
                { name: 'Brands', url: '/brands' },
                { name: brand.name, url: `/brands/${brand.slug}` }
            ]
        });
    } catch (err) {
        console.error('Error resolving brand hub:', err);
        res.status(500).send("Error loading Brand Hub");
    }
});

// Products page for a brand — /products/:brandSlug
// Shows only products for that brand; links to /offers/:brandSlug for coupons
app.get('/products/:brandSlug', populateSidebar, async (req, res) => {
    try {
        const { brandSlug } = req.params;
        const settings = await getGlobalSettings();
        const firebase = require('./config/firebase');
        const db = firebase.db;

        const advSnapshot = await db.collection('advertisers')
            .where('slug', '==', brandSlug).limit(1).get();
        if (advSnapshot.empty) return res.status(404).render('404', { message: 'Brand not found' });

        const brandData = advSnapshot.docs[0].data();
        const brandId = (brandData.id || brandData.advertiserId || brandData.data_id || (brandData.raw_data && brandData.raw_data.id))?.toString();
        const brand = {
            name: brandData.name,
            slug: brandData.slug,
            logoUrl: brandData.storageLogoUrl || brandData.logoUrl || (brandData.raw_data && brandData.raw_data.logoUrl)
        };

        const productsSnapshot = await db.collection('products')
            .where('advertiserId', '==', brandId).limit(40).get();
        const products = productsSnapshot.docs.map(doc => mapProductDoc(doc, { brandSlug }));

        // Check if there are any offers to show the link
        const offersCountSnap = await db.collection('offers')
            .where('advertiserId', '==', brandId).limit(1).get();
        const hasOffers = !offersCountSnap.empty;

        const finalCategories = await getGlobalCategories();
        const pageCategories = (brandData.categories || []).map(catName => {
            const found = finalCategories.find(c => c.name.toLowerCase() === catName.toLowerCase());
            return {
                name: catName,
                slug: found ? found.slug : slugify(catName)
            };
        });

        res.render('page', {
            settings,
            brand,
            products,
            categories: finalCategories,
            showBrands: false,
            showOffers: false,
            showProducts: products.length > 0,
            productsH2: `${brand.name} Products`,
            pageLogo: brand.logoUrl,
            pageH1: `${brand.name} Products`,
            pageCategories,
            contextLink: hasOffers ? {
                text: '🏷️ Active Offers Available!',
                url: `/offers/${brandSlug}`
            } : null,
            breadcrumbPath: [
                { name: 'Products', url: '/products' },
                { name: brand.name, url: `/products/${brandSlug}` }
            ]
        });
    } catch (err) {
        console.error('Error loading brand products page:', err);
        res.status(500).send('Error loading Brand Products');
    }
});

// Offers page for a brand — /offers/:brandSlug
// Shows all coupons/deals for a brand; SEO-targeted for "[brand] coupon code" queries
app.get('/offers/:brandSlug', populateSidebar, async (req, res) => {
    try {
        const { brandSlug } = req.params;
        const settings = await getGlobalSettings();
        const firebase = require('./config/firebase');
        const db = firebase.db;

        const advSnapshot = await db.collection('advertisers')
            .where('slug', '==', brandSlug).limit(1).get();
        if (advSnapshot.empty) return res.status(404).render('404', { message: 'Brand not found' });

        const brandData = advSnapshot.docs[0].data();
        const brandId = (brandData.id || brandData.advertiserId || brandData.data_id || (brandData.raw_data && brandData.raw_data.id))?.toString();
        const brand = {
            name: brandData.name,
            slug: brandData.slug,
            logoUrl: brandData.storageLogoUrl || brandData.logoUrl || (brandData.raw_data && brandData.raw_data.logoUrl)
        };

        const offersSnapshot = await db.collection('offers')
            .where('advertiserId', '==', brandId).get();
        const offers = offersSnapshot.docs.map(doc => mapOfferDoc(doc, { brandSlug, brandLogo: brand.logoUrl }));

        const finalCategories = await getGlobalCategories();
        const pageCategories = (brandData.categories || []).map(catName => {
            const found = finalCategories.find(c => c.name.toLowerCase() === catName.toLowerCase());
            return {
                name: catName,
                slug: found ? found.slug : slugify(catName)
            };
        });

        // Check if there are products for cross-linking
        const productsCountSnap = await db.collection('products')
            .where('advertiserId', '==', brandId).limit(1).get();
        const hasProducts = !productsCountSnap.empty;

        res.render('page', {
            settings,
            brand,
            offers,
            categories: finalCategories,
            showBrands: false,
            showProducts: false,
            showOffers: offers.length > 0,
            offersH2: `${brand.name} Promo Codes & Offers`,
            offersDescription: `Verified promo codes and deals from ${brand.name}. Updated ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`,
            pageLogo: brand.logoUrl,
            pageH1: `${brand.name} Promo Codes and Discounts`,
            pageCategories,
            contextLink: hasProducts ? {
                text: '📦 View Available Products',
                url: `/products/${brandSlug}`
            } : null,
            breadcrumbPath: [
                { name: 'Offers', url: '/offers' },
                { name: brand.name, url: `/offers/${brandSlug}` }
            ]
        });
    } catch (err) {
        console.error('Error loading brand offers page:', err);
        res.status(500).send('Error loading Brand Offers');
    }
});

app.get('/products/:brandSlug/:productSlug', populateSidebar, async (req, res) => {
    try {
        const { brandSlug, productSlug } = req.params;
        const settings = await getGlobalSettings();
        const firebase = require('./config/firebase');
        const db = firebase.db;

        // Fetch product by slug and optionally by brand to ensure it's correct
        const productSnapshot = await db.collection('products')
            .where('slug', '==', productSlug)
            .limit(1)
            .get();

        if (productSnapshot.empty) {
            return res.status(404).render('404', { message: 'Product not found' });
        }

        const productDoc = productSnapshot.docs[0];
        const data = productDoc.data();

        const advSnapshot = await db.collection('advertisers')
            .where('slug', '==', brandSlug)
            .limit(1)
            .get();
        let pageLogo = null;
        let finalBrandName = data.advertiser || data.advertiserName || 'Brand';

        if (!advSnapshot.empty) {
            const advData = advSnapshot.docs[0].data();
            pageLogo = advData.storageLogoUrl || advData.logoUrl || (advData.raw_data && advData.raw_data.logoUrl);
            finalBrandName = advData.name || finalBrandName;
        }

        const productDetails = {
            ...data,
            id: productDoc.id,
            imageUrl: data.storageImageUrl || data.imageUrl,
            brandName: finalBrandName
        };

        const finalCategories = await getGlobalCategories();

        res.render('page', {
            settings,
            productDetails,
            categories: finalCategories,
            showBrands: false,
            showProducts: false,
            showOffers: false,
            showProductDetails: true,
            pageLogo,
            pageH1: productDetails.brandName,
            pageH1Sub: productDetails.name,
            breadcrumbPath: [
                { name: 'Products', url: '/products' },
                { name: productDetails.brandName, url: `/brands/${brandSlug}` },
                { name: productDetails.name, url: `/products/${brandSlug}/${productSlug}` }
            ]
        });
    } catch (err) {
        console.error('Error loading product details:', err);
        res.status(500).send("Error loading Product Details");
    }
});

app.get('/offers/:brandSlug/:offerId', populateSidebar, async (req, res) => {
    try {
        const { brandSlug, offerId } = req.params;
        const settings = await getGlobalSettings();
        const firebase = require('./config/firebase');
        const db = firebase.db;

        // 1. Fetch the specific offer by document ID
        const offerSnapshot = await db.collection('offers').doc(offerId).get();
        if (!offerSnapshot.exists) {
            return res.status(404).render('404', { message: 'Offer not found' });
        }
        const offerData = offerSnapshot.data();
        let expiresAt = 'Ongoing';
        if (offerData.endDate) {
            try {
                const d = new Date(offerData.endDate);
                if (!isNaN(d.getTime())) expiresAt = d.toLocaleDateString();
            } catch (e) { }
        }
        const modalOffer = {
            ...offerData,
            id: offerSnapshot.id,
            expiresAt,
            isPromoCode: isRealCode(offerData.code),
            brandSlug,
            brandName: offerData.advertiser || 'Brand'
        };

        // 2. Fetch the Brand Hub data (same as /brands/:slug)
        const advSnapshot = await db.collection('advertisers')
            .where('slug', '==', brandSlug)
            .limit(1)
            .get();
        if (advSnapshot.empty) {
            return res.status(404).render('404', { message: 'Brand not found' });
        }
        const brandData = advSnapshot.docs[0].data();
        const brandId = (brandData.id || brandData.advertiserId || brandData.data_id || (brandData.raw_data && brandData.raw_data.id))?.toString();
        const finalCategories = await getGlobalCategories();

        const brand = {
            name: brandData.name,
            slug: brandData.slug,
            logoUrl: brandData.storageLogoUrl || brandData.logoUrl || (brandData.raw_data && brandData.raw_data.logoUrl),
        };

        // Enrich modalOffer with brand logo
        modalOffer.brandLogo = brand.logoUrl;

        const offersSnapshot = await db.collection('offers')
            .where('advertiserId', '==', brandId)
            .get();
        const offers = offersSnapshot.docs.map(doc => {
            const d = doc.data();
            let exp = 'Ongoing';
            if (d.endDate) {
                try {
                    const date = new Date(d.endDate);
                    if (!isNaN(date.getTime())) exp = date.toLocaleDateString();
                } catch (e) { }
            }
            return {
                ...d,
                id: doc.id,
                expiresAt: exp,
                isPromoCode: isRealCode(d.code),
                brandSlug,
                brandLogo: brand.logoUrl
            };
        });

        // SEO-targeted H1 for "[brand] coupon code" queries
        const pageH1 = `${brand.name} Promo Codes and Discounts`;

        res.render('page', {
            settings,
            brand,
            offers,
            modalOffer,
            categories: finalCategories,
            showBrands: false,
            showProducts: false,
            showOffers: offers.length > 0,
            offersH2: `${brand.name} Promo Codes & Offers`,
            offersDescription: `Verified promo codes and deals from ${brand.name}. Updated ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.`,
            pageLogo: brand.logoUrl,
            pageH1,
            breadcrumbPath: [
                { name: 'Offers', url: '/offers' },
                { name: brand.name, url: `/brands/${brandSlug}` },
                { name: 'Promo Codes', url: `/offers/${brandSlug}/${offerId}` }
            ]
        });
    } catch (err) {
        console.error('Error loading offer landing page:', err);
        res.status(500).send('Error loading Offer');
    }
});

app.get('/categories', populateSidebar, async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const enrichedBrands = await getEnrichedAdvertisers();
        const finalCategories = await getGlobalCategories(enrichedBrands);

        res.render('page', {
            settings,
            categories: finalCategories,
            showBrands: false,
            showProducts: false,
            showOffers: false,
            showCategories: true,
            pageH1: "Browse by Category",
            breadcrumbPath: [
                { name: 'Categories', url: '/categories' }
            ]
        });
    } catch (err) {
        console.error('Error loading categories:', err);
        res.status(500).send("Error loading Categories");
    }
});

app.get('/categories/:categorySlug', populateSidebar, async (req, res) => {
    try {
        const { categorySlug } = req.params;
        const settings = await getGlobalSettings();
        const enrichedBrands = await getEnrichedAdvertisers();
        const finalCategories = await getGlobalCategories(enrichedBrands);

        // Find category name from slug
        const categoryDetails = finalCategories.find(c => c.slug === categorySlug) || { name: 'Category' };

        const categoryBrands = enrichedBrands.filter(b => {
            const cats = b.categories || (b.raw_data && b.raw_data.categories) || [];
            return cats.some(c => c.toLowerCase() === categoryDetails.name.toLowerCase());
        });

        // We could theoretically fetch filtered products/offers from Firestore here too.
        // For now, pass down the brands matched to this category.

        res.render('page', {
            settings,
            brands: categoryBrands,
            categories: finalCategories,
            showBrands: true,
            showProducts: false,
            showOffers: false,
            brandsH2: `Brands in ${categoryDetails.name}`,
            offersDescription: `Active promo codes and deals in ${categoryDetails.name}.`,
            pageH1: `Best ${categoryDetails.name} Promo Codes & Deals`,
            breadcrumbPath: [
                { name: 'Categories', url: '/categories' },
                { name: categoryDetails.name, url: `/categories/${categorySlug}` }
            ]
        });

    } catch (err) {
        console.error('Error loading category:', err);
        res.status(500).send("Error loading Category");
    }
});

app.get('/api/offers', async (req, res) => {
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
                    isPromoCode: isRealCode(data.code), brandLogo: brandLogoMap.get(offId || '') || data.logoUrl || null
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

app.get('/api/search', async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json({ brands: [], products: [], offers: [], categories: [] });

        const firebase = require('./config/firebase');
        const db = firebase.db;

        // Normalize the query into tokens for keyword matching
        const tokens = q.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 2);

        // Use the longest token as the primary keyword (most specific)
        const primaryToken = tokens.sort((a, b) => b.length - a.length)[0] || q.toLowerCase();
        const searchStr = q.charAt(0).toUpperCase() + q.slice(1); // Title case

        // Helper: Firestore prefix-range query (exact prefix match fallback)
        const prefixSearch = async (collection, field, str) => {
            const snap = await db.collection(collection)
                .where(field, '>=', str)
                .where(field, '<=', str + '\uf8ff')
                .limit(6)
                .get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };

        // Helper: Firestore array-contains keyword search
        const keywordSearch = async (collection, token) => {
            const snap = await db.collection(collection)
                .where('searchKeywords', 'array-contains', token)
                .limit(8)
                .get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };

        // Helper: Category search — find advertisers whose categories array contains the query word
        const categorySearch = async (token) => {
            const snap = await db.collection('advertisers')
                .where('categories', 'array-contains', token)
                .limit(6)
                .get();
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };

        // Helper: Advertiser search via categories (try variations)
        const categoryVariants = [
            q.toLowerCase(),
            q.charAt(0).toUpperCase() + q.slice(1).toLowerCase(),
            q.toUpperCase(),
            ...tokens
        ];

        const [
            brandsKeyword, brandsPrefixTitle, brandsPrefixLower, brandsPrefixLiteral,
            productsKeyword, productsPrefixTitle, productsPrefixLower,
            offersByAdvertiserPrefix, offersByDescPrefix, offersByAdvertiserLower,
            brandsFromCategories
        ] = await Promise.all([
            keywordSearch('advertisers', primaryToken),
            prefixSearch('advertisers', 'name', searchStr),
            prefixSearch('advertisers', 'name', q.toLowerCase()),
            prefixSearch('advertisers', 'name', q),
            keywordSearch('products', primaryToken),
            prefixSearch('products', 'name', searchStr),
            prefixSearch('products', 'name', q.toLowerCase()),
            prefixSearch('offers', 'advertiser', searchStr),
            prefixSearch('offers', 'description', searchStr),
            prefixSearch('offers', 'advertiser', q.toLowerCase()),
            // Category search — try the primary token and title case
            categorySearch(categoryVariants[0]).then(r =>
                r.length ? r : categorySearch(categoryVariants[1])
            )
        ]);

        // Deduplicate across multiple result arrays, return up to maxCount
        const dedup = (arrs, maxCount = 5) => {
            const map = new Map();
            arrs.flat().forEach(item => {
                if (item && item.id && !map.has(item.id)) map.set(item.id, item);
            });
            return Array.from(map.values()).slice(0, maxCount);
        };

        const finalBrands = dedup([brandsKeyword, brandsPrefixTitle, brandsPrefixLower, brandsPrefixLiteral]);
        const finalProducts = dedup([productsKeyword, productsPrefixTitle, productsPrefixLower]);
        const finalOffers = dedup([offersByAdvertiserPrefix, offersByDescPrefix, offersByAdvertiserLower]);

        // Create a quick lookup map for advertiser logos to attach to offers
        const finalBrandIdsSearch = new Set(
            [...offersByAdvertiserPrefix, ...offersByDescPrefix, ...offersByAdvertiserLower]
                .map(o => o.advertiserId || o.data_id || (o.raw_data && o.raw_data.advertiserId))
                .filter(Boolean)
        );
        let brandLogoMap = new Map();
        if (finalBrandIdsSearch.size > 0) {
            // Need to fetch logos for these advertisers to show on offers
            // We'll just grab any matched brands from our earlier queries first to save DB reads
            [...brandsKeyword, ...brandsPrefixTitle, ...brandsPrefixLower, ...brandsPrefixLiteral, ...brandsFromCategories].forEach(b => {
                const bId = (b.id || b.advertiserId || b.data_id)?.toString();
                if (bId) brandLogoMap.set(bId, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
            });

            // If any are still missing, we could fetch them, but for autocomplete performance
            // we will rely on what we have, or fallback to default icon
            const missingBrandIds = Array.from(finalBrandIdsSearch).filter(id => !brandLogoMap.has(id));
            if (missingBrandIds.length > 0) {
                const chunks = [];
                for (let i = 0; i < missingBrandIds.length; i += 30) {
                    chunks.push(missingBrandIds.slice(i, i + 30));
                }
                await Promise.all(chunks.map(async chunk => {
                    // Handle permutations like 1234, CJ-1234, RT-1234
                    const expandedChunk = [...chunk];
                    chunk.forEach(id => {
                        expandedChunk.push(`CJ-${id}`);
                        expandedChunk.push(`RT-${id}`);
                        expandedChunk.push(`AWIN-${id}`);
                    });

                    const safeChunk = expandedChunk.slice(0, 30); // Firestore IN queries are limited

                    // 1. By Document ID
                    const snapId = await db.collection('advertisers').where('__name__', 'in', safeChunk).get();
                    snapId.docs.forEach(doc => {
                        const b = doc.data();
                        const bId = (doc.id || b.advertiserId || b.id || b.data_id)?.toString();
                        if (bId) brandLogoMap.set(bId, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
                        // Also associate with raw ID from offer
                        const possibleRaw = doc.id.replace(/^(CJ|RT|AWIN)-/i, '');
                        brandLogoMap.set(possibleRaw, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
                    });

                    // 2. By `advertiserId` field
                    const snapAdvId = await db.collection('advertisers').where('advertiserId', 'in', safeChunk).get();
                    snapAdvId.docs.forEach(doc => {
                        const b = doc.data();
                        const bId = (doc.id || b.advertiserId || b.id || b.data_id)?.toString();
                        if (bId) brandLogoMap.set(bId, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
                        const rawAdvId = b.advertiserId?.toString();
                        if (rawAdvId) brandLogoMap.set(rawAdvId, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
                    });

                    // 3. By raw `id` field
                    const snapRawId = await db.collection('advertisers').where('id', 'in', safeChunk).get();
                    snapRawId.docs.forEach(doc => {
                        const b = doc.data();
                        const bId = (doc.id || b.advertiserId || b.id || b.data_id)?.toString();
                        if (bId) brandLogoMap.set(bId, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
                        const rawId = b.id?.toString();
                        if (rawId) brandLogoMap.set(rawId, b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl));
                    });
                }));
            }
        }

        // Category results: show brands from that category that aren't already in finalBrands
        const finalBrandIds = new Set(finalBrands.map(b => b.id));
        const categoryBrands = brandsFromCategories.filter(b => !finalBrandIds.has(b.id)).slice(0, 4);

        console.log(`[Search] Query: "${q}" (token: "${primaryToken}") → B:${finalBrands.length}, P:${finalProducts.length}, O:${finalOffers.length}, Cat:${categoryBrands.length}`);

        res.json({
            brands: finalBrands.map(b => ({
                name: b.name,
                slug: b.slug,
                logoUrl: b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl)
            })),
            products: finalProducts.map(p => ({
                name: p.name,
                slug: p.slug,
                brandName: p.advertiser || p.advertiserName || p.brand || '',
                brandSlug: p.brandSlug || p.advertiserSlug || slugify(p.advertiserName || p.advertiser || ''),
                imageUrl: p.storageImageUrl || p.imageUrl,
                price: p.price,
                salePrice: p.salePrice
            })),
            offers: finalOffers.map(o => {
                const advId = (o.advertiserId || o.data_id || (o.raw_data && o.raw_data.advertiserId))?.toString();
                return {
                    name: o.description || o.name,
                    id: o.id,
                    advertiser: o.advertiser || o.advertiserName,
                    brandSlug: o.brandSlug || o.advertiserSlug || slugify(o.advertiser || ''),
                    brandLogo: brandLogoMap.get(advId) || o.logoUrl || null,
                    isPromoCode: isRealCode(o.code || o.promoCode)
                };
            }),
            categoryBrands: categoryBrands.map(b => ({
                name: b.name,
                slug: b.slug,
                logoUrl: b.storageLogoUrl || b.logoUrl || (b.raw_data && b.raw_data.logoUrl),
                categories: b.categories || []
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
