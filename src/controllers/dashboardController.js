const firebaseConfig = require('../config/firebase');
const dataSync = require('../services/dataSync');
const imageStore = require('../services/imageStore');
const multer = require('multer');
const axios = require('axios');
const { getAdvertiser, upsertAdvertiser, getGlobalSettings, updateGlobalSettings, getEnrichedAdvertisers } = require('../services/db'); // Needed for updates

// Configure Multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

const getStyle = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('style', { settings });
    } catch (e) {
        res.status(500).send('Error loading style page: ' + e.message);
    }
};

const updateStyle = async (req, res) => {
    try {
        const { logoText, logoStyles, headerStyles, filterInputStyles, categorySelectedStyles, categoryLinkStyles, categoryHoverStyles, bgColor, defaultLinkColor, offersCtaStyles, productsCtaStyles, offersCtaCountStyles, productsCtaCountStyles, categoriesHeading, categoriesHeadingStyles, offerRowStyles, offerImageStyles, offerPromoCodeStyles, offerTitleStyles, offerTimeLeftStyles, productRowStyles, productImageStyles, productTitleStyles, productPriceStyles, productSalePriceStyles } = req.body;
        const files = req.files || {};

        let settings = {
            logoText,
            logoStyles,
            headerStyles,
            filterInputStyles,
            categorySelectedStyles,
            categoryLinkStyles,
            categoryHoverStyles,
            bgColor,
            defaultLinkColor,
            offersCtaStyles,
            productsCtaStyles,
            offersCtaCountStyles,
            productsCtaCountStyles,
            categoriesHeading,
            categoriesHeadingStyles,
            offerRowStyles,
            offerImageStyles,
            offerPromoCodeStyles,
            offerTitleStyles,
            offerTimeLeftStyles,
            productRowStyles,
            productImageStyles,
            productTitleStyles,
            productPriceStyles,
            productSalePriceStyles
        };

        // Remove undefined keys so they don't break Firestore or overwrite existing settings with undefined (if merge logic was different)
        Object.keys(settings).forEach(key => settings[key] === undefined && delete settings[key]);

        // Handle Logo Upload
        if (files.logoImage && files.logoImage[0]) {
            const logoUrl = await imageStore.uploadImageBuffer(
                files.logoImage[0].buffer,
                files.logoImage[0].mimetype,
                'settings/logo'
            );
            settings.logoUrl = logoUrl;
        }

        // Handle Background Image Upload
        if (files.bgImage && files.bgImage[0]) {
            const bgUrl = await imageStore.uploadImageBuffer(
                files.bgImage[0].buffer,
                files.bgImage[0].mimetype,
                'settings/bg'
            );
            settings.bgImageUrl = bgUrl;
        }

        await updateGlobalSettings(settings);
        res.redirect('/mission-control/style');

    } catch (e) {
        console.error('Error updating styles:', e);
        res.status(500).send('Error updating styles: ' + e.message);
    }
};

const uploadStyleMiddleware = upload.fields([
    { name: 'logoImage', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 }
]);

const getDashboardData = async (req, res) => {
    console.log('ENTER: getDashboardData');
    try {
        const advertisers = await getEnrichedAdvertisers();
        const db = firebaseConfig.db;

        // Fetch Product Count (Optimized)
        const productsCountSnap = await db.collection('products').count().get();
        const totalProducts = productsCountSnap.data().count;
        const totalOffers = advertisers.reduce((sum, adv) => sum + (adv.offerCount || 0), 0);

        // Check if DB is empty
        if (advertisers.length === 0) {
            console.log('Database empty. Triggering initial sync...');
            await dataSync.syncAll();
            return getDashboardData(req, res);
        }

        // Aggregate Stats by Network
        const networkStats = {
            Rakuten: { advertisers: 0, offers: 0, products: 0 },
            CJ: { advertisers: 0, offers: 0, products: 0 },
            AWIN: { advertisers: 0, offers: 0, products: 0 },
            Pepperjam: { advertisers: 0, offers: 0, products: 0 }
        };

        console.log(`[DEBUG] Aggregating ${advertisers.length} advertisers...`);
        advertisers.forEach(adv => {
            const net = adv.network;
            if (networkStats[net]) {
                networkStats[net].advertisers++;
                networkStats[net].offers += (adv.offerCount || 0);
                networkStats[net].products += (adv.productCount || 0);
            } else {
                console.log(`[DEBUG] Unknown network: "${net}" for advertiser: ${adv.name}`);
            }
        });

        console.log(`[DEBUG] Network Stats:`, JSON.stringify(networkStats));

        res.render('dashboard', {
            advertisers,
            offerCounts: {},
            productCounts: {},
            saleProductCounts: {},
            networks: Object.keys(networkStats),
            stats: {
                rakuten: networkStats.Rakuten.advertisers,
                cj: networkStats.CJ.advertisers,
                awin: networkStats.AWIN.advertisers,
                pepperjam: networkStats.Pepperjam.advertisers,
                totalProducts: totalProducts,
                totalAdvertisers: advertisers.length,
                totalCoupons: totalOffers,
                networkDetailed: networkStats
            }
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('Error loading dashboard: ' + error.message);
    }
};

const getHomepage = async (req, res) => {
    console.log('ENTER: getHomepage');
    try {
        const advertisers = await getEnrichedAdvertisers();
        const settings = await getGlobalSettings();
        const totalOffers = advertisers.reduce((sum, adv) => sum + (adv.offerCount || 0), 0);

        const networkStats = {
            Rakuten: { advertisers: 0, offers: 0, products: 0 },
            CJ: { advertisers: 0, offers: 0, products: 0 },
            AWIN: { advertisers: 0, offers: 0, products: 0 },
            Pepperjam: { advertisers: 0, offers: 0, products: 0 }
        };

        advertisers.forEach(adv => {
            const net = adv.network;
            if (networkStats[net]) {
                networkStats[net].advertisers++;
                networkStats[net].offers += (adv.offerCount || 0);
                networkStats[net].products += (adv.productCount || 0);
            }
        });

        res.render('index', {
            advertisers,
            offerCounts: {},
            productCounts: {},
            saleProductCounts: {},
            settings: settings,
            stats: {
                rakuten: networkStats.Rakuten.advertisers,
                cj: networkStats.CJ.advertisers,
                awin: networkStats.AWIN.advertisers,
                pepperjam: networkStats.Pepperjam.advertisers,
                totalProducts: 0, // Not used in index currently but kept for interface stability
                totalAdvertisers: advertisers.length,
                totalCoupons: totalOffers,
                networkDetailed: networkStats
            }
        });
    } catch (error) {
        res.status(500).send('Error loading brands page: ' + error.message);
    }
};

const getNewHomepage = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const db = firebaseConfig.db;

        // Fetch a larger pool of products with savingsAmount
        // This allows us to filter for brand diversity in memory
        const productsSnapshot = await db.collection('products')
            .where('savingsAmount', '>', 0)
            .orderBy('savingsAmount', 'desc')
            .limit(500) // Fetch more than we need to allow for filtering
            .get();

        console.log(`[Homepage] Fetched ${productsSnapshot.size} products for mixed grid`);

        const topSaleProducts = [];
        const brandCounts = {};
        const MAX_PER_BRAND = 3;

        productsSnapshot.forEach(doc => {
            if (topSaleProducts.length >= 24) return;

            const product = doc.data();
            const brandId = product.advertiserId || 'unknown';

            // Ensure brand diversity: skip if we already have enough from this store
            if (brandCounts[brandId] >= MAX_PER_BRAND) {
                return;
            }

            brandCounts[brandId] = (brandCounts[brandId] || 0) + 1;

            topSaleProducts.push({
                ...product,
                id: doc.id,
                price: parseFloat(product.price) || 0,
                salePrice: parseFloat(product.salePrice) || 0,
                savings: product.savingsAmount || 0
            });
        });

        console.log(`[Homepage] Rendering ${topSaleProducts.length} mixed items across ${Object.keys(brandCounts).length} brands`);

        res.render('home', {
            settings,
            topSaleProducts
        });
    } catch (e) {
        console.error('Error loading homepage:', e);
        res.status(500).send('Error loading homepage: ' + e.message);
    }
};

const getComingSoon = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('coming-soon', { settings });
    } catch (e) {
        res.status(500).send('Error loading homepage: ' + e.message);
    }
};



const refreshData = async (req, res) => {
    console.log('ENTER: refreshData');
    try {
        console.log('Manual global refresh triggered.');
        // Run in background so UI doesn't hang
        dataSync.syncAll().catch(err => console.error('Global Sync Error:', err));

        // Redirect immediately
        res.redirect('/mission-control');
    } catch (error) {
        console.error('Error triggering refresh:', error);
        res.status(500).send('Error triggering refresh');
    }
};

const getArchitecture = async (req, res) => {
    try {
        res.render('architecture');
    } catch (error) {
        res.status(500).send('Error loading architecture page: ' + error.message);
    }
};

const getAdvertiserProducts = async (req, res) => {
    try {
        const { id } = req.params;
        const q = req.query.q ? req.query.q.toLowerCase().trim() : null;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const offset = (page - 1) * limit;

        console.log(`[DEBUG] getAdvertiserProducts - ID: ${id}, Query: "${q}"`);

        const db = firebaseConfig.db;

        // We need to check for products using both String and Number versions of the ID 
        // because old data may still be stored as Numbers.
        const idTypes = [String(id)];
        if (!isNaN(id)) idTypes.push(Number(id));

        let products = [];
        let total = 0;

        // Fetch all matching products (limited to sensible amount for counting/fallback)
        // Note: For very large sets with mixed types, we'd need a more complex pagination approach.
        // But since we are migrating to Strings, this hybrid approach works for current data.
        const fetchAllMatches = async (queryFn) => {
            const results = [];
            for (const typeId of idTypes) {
                const snap = await queryFn(db.collection('products').where('advertiserId', '==', typeId)).get();
                snap.forEach(doc => results.push(doc.data()));
            }
            return results;
        };

        try {
            if (q && q.length >= 2) {
                // Search Mode: Optimized fetching
                const qTokens = q.split(/\s+/).filter(t => t.length >= 2);
                const mainToken = qTokens[0];

                // For search, we limit the initial pool to avoid OOM/Slowdowns 
                // but still provide enough for relevant pages.
                const searchLimit = 2000;

                const fetchSubset = async (queryFn) => {
                    const results = [];
                    for (const typeId of idTypes) {
                        const snap = await queryFn(db.collection('products')
                            .where('advertiserId', '==', typeId))
                            .limit(searchLimit)
                            .get();
                        snap.forEach(doc => results.push(doc.data()));
                    }
                    return results;
                };

                const kwResults = await fetchSubset(qRef => qRef.where('searchKeywords', 'array-contains', mainToken));

                let filtered = kwResults;
                if (qTokens.length > 1) {
                    filtered = kwResults.filter(p => {
                        const searchStr = (p.name || '').toLowerCase();
                        return qTokens.every(token => searchStr.includes(token));
                    });
                }

                total = filtered.length;
                products = filtered.slice(offset, offset + limit);
            } else {
                // Normal Mode: ULTRA FAST
                // 1. Get total from Advertiser record (denormalized)
                const advDoc = await db.collection('advertisers').doc(`Rakuten-${id}`).get() ||
                    await db.collection('advertisers').doc(`CJ-${id}`).get() ||
                    await db.collection('advertisers').doc(`AWIN-${id}`).get();

                if (advDoc && advDoc.exists) {
                    total = advDoc.data().productCount || 0;
                } else {
                    // Fallback to quick count if advertiser record missing
                    const countPromises = idTypes.map(typeId =>
                        db.collection('products').where('advertiserId', '==', typeId).count().get()
                    );
                    const snaps = await Promise.all(countPromises);
                    total = snaps.reduce((acc, s) => acc + s.data().count, 0);
                }

                // 2. Paginated fetch (prioritize string ID)
                const stringSnap = await db.collection('products')
                    .where('advertiserId', '==', String(id))
                    .orderBy('updatedAt', 'desc') // Ensure stable sort for pagination
                    .offset(offset)
                    .limit(limit)
                    .get();

                stringSnap.forEach(doc => products.push(doc.data()));

                if (products.length < limit && idTypes.length > 1) {
                    const remainingLimit = limit - products.length;
                    const numberSnap = await db.collection('products')
                        .where('advertiserId', '==', Number(id))
                        .orderBy('updatedAt', 'desc')
                        .limit(remainingLimit)
                        .get();
                    numberSnap.forEach(doc => products.push(doc.data()));
                }
            }
        } catch (queryErr) {
            console.error('[ERROR] Optimized product query failed:', queryErr);
            // Minimal fallback
            const fallbackSnap = await db.collection('products').where('advertiserId', '==', String(id)).limit(limit).get();
            fallbackSnap.forEach(doc => products.push(doc.data()));
            total = products.length;
        }

        res.json({
            success: true,
            products,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (e) {
        console.error('[ERROR] getAdvertiserProducts Top Level:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

const globalProductSearch = async (req, res) => {
    try {
        const q = req.query.q;
        if (!q || q.length < 2) return res.json({ success: true, products: [] });

        const db = firebaseConfig.db;
        const qTokens = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
        const mainToken = qTokens[0];

        console.log(`[DEBUG] Global search tokens:`, qTokens);

        // 1. Broad fetch using the primary token
        const snapshot = await db.collection('products')
            .where('searchKeywords', 'array-contains', mainToken)
            .limit(100)
            .get();

        const products = [];
        const seenIds = new Set();

        snapshot.forEach(doc => {
            const data = doc.data();
            const id = doc.id;

            // Refine in memory: Ensure ALL tokens appear somewhere in the product name
            const name = (data.name || '').toLowerCase();
            const allMatch = qTokens.every(token => name.includes(token));

            if (allMatch && !seenIds.has(id)) {
                products.push(data);
                seenIds.add(id);
                if (products.length >= 15) return; // Cap at 15 high-quality matches
            }
        });

        // 2. Fallback prefix search if low results (for legacy data)
        if (products.length < 5) {
            const capitalizedQ = q.charAt(0).toUpperCase() + q.slice(1);
            const prefixSnapshot = await db.collection('products')
                .where('name', '>=', capitalizedQ)
                .where('name', '<=', capitalizedQ + '\uf8ff')
                .limit(5)
                .get();

            prefixSnapshot.forEach(doc => {
                const data = doc.data();
                if (!seenIds.has(doc.id)) {
                    products.push(data);
                    seenIds.add(doc.id);
                }
            });
        }

        res.json({ success: true, products: products.slice(0, 15) });
    } catch (e) {
        console.error('[ERROR] Global search failed:', e);
        res.status(500).json({ success: false, error: e.message });
    }
};

const getAdvertiserOffers = async (req, res) => {
    try {
        const { id } = req.params;
        const db = firebaseConfig.db;
        // Check for string vs number ID
        let snapshot = await db.collection('offers').where('advertiserId', '==', String(id)).get();
        if (snapshot.empty) {
            snapshot = await db.collection('offers').where('advertiserId', '==', Number(id)).get();
        }

        const now = new Date();
        const offers = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Filter out expired offers
            if (data.endDate && new Date(data.endDate) < now) return;
            offers.push(data);
        });

        // Sort offers: Code-based results first, then by date (soonest expiry first)
        offers.sort((a, b) => {
            const hasCodeA = (a.code && a.code !== 'N/A') ? 1 : 0;
            const hasCodeB = (b.code && b.code !== 'N/A') ? 1 : 0;
            if (hasCodeA !== hasCodeB) return hasCodeB - hasCodeA;

            const dateA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
            const dateB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
            return dateA - dateB;
        });

        res.json({ success: true, offers });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

// --- LOGO UPLOAD LOGIC ---

// Helper middleware for single file upload
const uploadLogoMiddleware = upload.single('logo');

const uploadLogo = async (req, res) => {
    try {
        const { id } = req.params;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        console.log(`Uploading logo for advertiser ${id}...`);

        // 1. Upload to Storage
        const publicUrl = await imageStore.uploadImageBuffer(
            file.buffer,
            file.mimetype,
            'advertisers/manual'
        );

        // 2. Update Firestore
        // We need to fetch the existing advertiser to get the network (needed for ID construction in db.js)
        // Actually db.js `upsertAdvertiser` takes `advertiserData`. 
        // We need to know the 'network' to construct the doc ID or just fetch it first.

        // Brute force fetch to find the advertiser doc since we only have numeric ID from params
        // Or assume we can find it via the ID in the loop.
        // Wait, our routes don't pass network, only ID. ID is unique per network, but across networks?
        // IDs might collide across networks (unlikely but possible).
        // Best to find the doc first.

        const db = firebaseConfig.db;
        const advertisersRef = db.collection('advertisers');
        // Try to find by ID field (string or number)
        // Since we don't know the network part of the ID, we query.

        const snapshot = await advertisersRef.where('id', '==', String(id)).limit(1).get(); // Check string
        let docSnap = snapshot.empty ? null : snapshot.docs[0];

        if (!docSnap) {
            // Try number
            const numSnapshot = await advertisersRef.where('id', '==', Number(id)).limit(1).get();
            docSnap = numSnapshot.empty ? null : numSnapshot.docs[0];
        }

        if (!docSnap) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        const advData = docSnap.data();

        // Update fields
        await docSnap.ref.update({
            storageLogoUrl: publicUrl,
            logoUrl: publicUrl, // Ensure display logic sees this immediately
            isManualLogo: true,
            updatedAt: new Date()
        });

        console.log(`Logo updated for ${id}: ${publicUrl}`);
        res.json({ success: true, url: publicUrl });

    } catch (e) {
        console.error('Error uploading logo:', e);
        res.status(500).json({ success: false, error: 'Upload failed: ' + e.message });
    }
};

const resetLogo = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Resetting logo for advertiser ${id}...`);

        const db = firebaseConfig.db;
        const advertisersRef = db.collection('advertisers');

        const snapshot = await advertisersRef.where('id', '==', String(id)).limit(1).get();
        let docSnap = snapshot.empty ? null : snapshot.docs[0];

        if (!docSnap) {
            const numSnapshot = await advertisersRef.where('id', '==', Number(id)).limit(1).get();
            docSnap = numSnapshot.empty ? null : numSnapshot.docs[0];
        }

        if (!docSnap) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        const advData = docSnap.data();

        // Revert to original URL if available in raw_data, or null
        // And reset manual flag
        const originalUrl = (advData.raw_data && advData.raw_data.logoUrl) ? advData.raw_data.logoUrl : null;

        await docSnap.ref.update({
            storageLogoUrl: null, // Clear cached version so sync can re-fetch or clear
            logoUrl: originalUrl, // Revert to known original
            isManualLogo: false,
            updatedAt: new Date()
        });

        console.log(`Logo reset for ${id}`);
        res.json({ success: true });

    } catch (e) {
        console.error('Error resetting logo:', e);
        res.status(500).json({ success: false, error: 'Reset failed: ' + e.message });
    }
};


// Helper to find an advertiser across all possible networks
const findAdvertiser = async (id) => {
    const networks = ['Rakuten', 'CJ', 'AWIN', 'Pepperjam'];
    for (const net of networks) {
        const adv = await getAdvertiser(net, id);
        if (adv) return { adv, network: net };
    }
    return null;
};

const updateHomeLink = async (req, res) => {
    try {
        const { id } = req.params;
        const { homeLink } = req.body;
        const result = await findAdvertiser(id);

        if (!result) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        await upsertAdvertiser({
            ...result.adv,
            manualHomeUrl: homeLink
        }, result.adv);

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating home link:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

const updateDescription = async (req, res) => {
    try {
        const { id } = req.params;
        const { description } = req.body;
        const result = await findAdvertiser(id);

        if (!result) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        await upsertAdvertiser({
            ...result.adv,
            manualDescription: description
        }, result.adv);

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating description:', error);
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

const proxyImage = async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).send('URL is required');
        }

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 5000
        });

        res.set('Content-Type', response.headers['content-type']);
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=86400'); // 24 hour cache
        response.data.pipe(res);
    } catch (e) {
        console.error('Proxy error:', e.message);
        res.status(500).send('Error fetching image');
    }
};



module.exports = {
    getDashboardData,
    refreshData,
    getAdvertiserProducts,
    getAdvertiserOffers,
    globalProductSearch,
    uploadLogo,
    resetLogo,
    updateHomeLink,
    updateDescription,
    uploadLogoMiddleware,
    getHomepage,
    getNewHomepage,
    getComingSoon,
    getArchitecture,
    getStyle,
    updateStyle,
    uploadStyleMiddleware,
    proxyImage
};
