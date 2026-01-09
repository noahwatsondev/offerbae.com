const firebaseConfig = require('../config/firebase');
const dataSync = require('../services/dataSync');
const imageStore = require('../services/imageStore');
const multer = require('multer');
const axios = require('axios');
const { getAdvertiser, upsertAdvertiser, getGlobalSettings, updateGlobalSettings } = require('../services/db'); // Needed for updates

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
        console.log('Fetching data from Firestore...');

        // Use lazy db getter
        const db = firebaseConfig.db;

        // Fetch Advertisers
        console.log('Fetching advertisers collection...');
        const advSnapshot = await db.collection('advertisers').get();
        const advertisers = [];
        advSnapshot.forEach(doc => {
            advertisers.push(doc.data());
        });
        console.log(`Fetched ${advertisers.length} advertisers.`);

        // Fetch Product Count (Optimized)
        console.log('Fetching product count...');
        const productsCountSnap = await db.collection('products').count().get();
        const totalProducts = productsCountSnap.data().count;
        console.log(`Total products calculated: ${totalProducts}`);

        const productCounts = {};
        const saleProductCounts = {};

        // TEMPORARY PERFORMANCE FIX: Counts are now read directly from Advertiser Doc (denormalized)
        // See scripts/update_counts.js
        console.log('Using denormalized counts from advertiser docs.');

        // Total offers calculation (Optimized: Sum of denormalized)
        // const offersCountSnap = await db.collection('offers').count().get();
        // const totalOffers = offersCountSnap.data().count;
        const totalOffers = advertisers.reduce((sum, adv) => sum + (adv.offerCount || 0), 0);

        // Check if DB is empty
        if (advertisers.length === 0) {
            console.log('Database empty. Triggering initial sync (this may take a while)...');
            await dataSync.syncAll();
            return getDashboardData(req, res);
        }

        // Enrich advertisers
        const enrichedAdvertisers = advertisers.map(a => {
            return {
                ...a,
                ...a,
                productCount: a.productCount || 0,
                saleProductCount: a.saleProductCount || 0, // Not yet denormalized, keeping 0 or needing update
                offerCount: a.offerCount || 0,
                // Prioritize storageLogoUrl if exists, regardless of manual flag (logic handled in sync/upload)
                logoUrl: a.storageLogoUrl || a.logoUrl || (a.raw_data && a.raw_data.logoUrl ? a.raw_data.logoUrl : null)
            };
        });

        // Sort Advertisers: Product Count (Desc) -> Name (Asc)
        enrichedAdvertisers.sort((a, b) => {
            if (b.productCount !== a.productCount) {
                return b.productCount - a.productCount;
            }
            return a.name.localeCompare(b.name);
        });

        // Aggregate Stats by Network
        const networkStats = {
            Rakuten: { advertisers: 0, offers: 0, products: 0 },
            CJ: { advertisers: 0, offers: 0, products: 0 },
            AWIN: { advertisers: 0, offers: 0, products: 0 },
            Pepperjam: { advertisers: 0, offers: 0, products: 0 }
        };

        enrichedAdvertisers.forEach(adv => {
            const net = adv.network;
            if (networkStats[net]) {
                networkStats[net].advertisers++;
                networkStats[net].offers += (adv.offerCount || 0);
                networkStats[net].products += (adv.productCount || 0);
            }
        });

        // Populate counts maps for the view (it still expects them)
        const productCountsMap = {};
        const offerCountsMap = {};
        const saleProductCountsMap = {};

        enrichedAdvertisers.forEach(adv => {
            productCountsMap[adv.id] = adv.productCount || 0;
            offerCountsMap[adv.id] = adv.offerCount || 0;
            saleProductCountsMap[adv.id] = adv.saleProductCount || 0;
        });

        console.log('Rendering dashboard...');
        res.render('dashboard', {
            advertisers: enrichedAdvertisers,
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
                totalAdvertisers: enrichedAdvertisers.length,
                totalCoupons: totalOffers,
                networkDetailed: networkStats
            }
        });
        console.log('Dashboard rendered.');
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('Error loading dashboard: ' + error.message);
    }
};

const getHomepage = async (req, res) => {
    console.log('ENTER: getHomepage');
    // For now, reuse the exact logic but render 'index'
    // In a real refactor, we might want to abstract the data fetching to a service
    // to avoid this massive code duplication.
    // For speed/risk reduction now, duplicate the logic.
    // Default empty data structure
    let advertisers = [];
    let totalProducts = 0;
    let totalOffers = 0;
    let enrichedAdvertisers = [];
    let networkStats = {
        Rakuten: { advertisers: 0, offers: 0, products: 0 },
        CJ: { advertisers: 0, offers: 0, products: 0 },
        AWIN: { advertisers: 0, offers: 0, products: 0 },
        Pepperjam: { advertisers: 0, offers: 0, products: 0 }
    };

    try {
        const db = firebaseConfig.db;

        // Fetch Advertisers
        console.log('Fetching Advertisers (LIMIT 10)...');
        try {
            // RESTORED:
            const advSnapshot = await db.collection('advertisers').get(); // Removed limit for full list
            // const advSnapshot = await db.collection('advertisers').limit(10).get();
            // console.log('Advertisers snapshot received. Size:', advSnapshot.size);
            advSnapshot.forEach(doc => advertisers.push(doc.data()));
            console.log(`Advertisers array populated. Count: ${advertisers.length}`);
        } catch (dbErr) {
            console.error('Error fetching advertisers (Offline?):', dbErr.message);
        }

        // Fetch Product Count
        try {
            // const productsCountSnap = await db.collection('products').count().get();
            // totalProducts = productsCountSnap.data().count;
            totalProducts = 0;
        } catch (dbErr) {
            console.error('Error fetching products count:', dbErr.message);
        }

        // Per-advertiser counts
        const productCounts = {}; // Deprecated in favor of denormalized fields
        const offerCounts = {}; // Deprecated
        const saleProductCounts = {}; // Deprecated but needed for render signature

        // Use mutated advertisers directly
        const enrichedAdvertisers = advertisers.map(a => ({
            ...a,
            productCount: a.productCount || 0,
            saleProductCount: a.saleProductCount || 0, // Use pre-calculated count from DB
            offerCount: a.offerCount || 0,
            logoUrl: a.storageLogoUrl || a.logoUrl || (a.raw_data && a.raw_data.logoUrl ? a.raw_data.logoUrl : null)
        }));

        enrichedAdvertisers.sort((a, b) => {
            if (b.productCount !== a.productCount) return b.productCount - a.productCount;
            return a.name.localeCompare(b.name);
        });

        const networkStats = {
            Rakuten: { advertisers: 0, offers: 0, products: 0 },
            CJ: { advertisers: 0, offers: 0, products: 0 },
            AWIN: { advertisers: 0, offers: 0, products: 0 },
            Pepperjam: { advertisers: 0, offers: 0, products: 0 }
        };
        enrichedAdvertisers.forEach(adv => {
            const net = adv.network;
            if (networkStats[net]) {
                networkStats[net].advertisers++;
                networkStats[net].offers += (adv.offerCount || 0);
                networkStats[net].products += (adv.productCount || 0);
            }
        });

        const settings = await getGlobalSettings();
        // const settings = {}; // MOCKED

        res.render('index', { // RENDER INDEX
            advertisers: enrichedAdvertisers,
            offerCounts: {},
            productCounts: {},
            saleProductCounts: {},
            settings: settings, // Pass settings to view
            stats: {
                rakuten: networkStats.Rakuten.advertisers,
                cj: networkStats.CJ.advertisers,
                awin: networkStats.AWIN.advertisers,
                pepperjam: networkStats.Pepperjam.advertisers,
                totalProducts: totalProducts,
                totalAdvertisers: enrichedAdvertisers.length,
                totalCoupons: totalOffers,
                networkDetailed: networkStats
            }
        });
    } catch (error) {
        res.status(500).send('Error loading homepage: ' + error.message);
    }
};


const refreshData = async (req, res) => {
    console.log('ENTER: refreshData');
    try {
        console.log('Manual refresh triggered.');
        await dataSync.syncAll();
        console.log('Manual refresh complete.');
        res.redirect('/');
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


const updateHomeLink = async (req, res) => {
    try {
        const { id } = req.params;
        const { homeLink } = req.body;
        const adv = await getAdvertiser('Rakuten', id) || await getAdvertiser('CJ', id) || await getAdvertiser('AWIN', id); // Try to find by ID across networks. Ideally we pass network or have a better lookup.
        // Actually, getAdvertiser needs network. 
        // We can optimize this by passing network from frontend or searching.
        // For now, let's search or rely on ID uniqueness if possible? 
        // Wait, the rows in dashboard know their network. Let's pass it or look it up.
        // Simplest: The ID in the route is the numeric ID. `getAdvertiser` needs `network` + `id`.
        // BUT, `upsertAdvertiser` constructs the ID.
        // Let's look up the doc directly if possible or iterate networks.

        // BETTER APPROACH: The frontend knows the network. Let's assume we can find it.
        // Or, since we have the full doc ID constructed in `dataSync` as `Network-Id`, maybe we should assume the route param is just the ID.
        // Let's try to find the document by querying the collection for the `id` field?
        // Or just iterate standard networks.

        let network = 'Rakuten'; // Default attempt
        let existing = await getAdvertiser('Rakuten', id);
        if (!existing) {
            existing = await getAdvertiser('CJ', id);
            network = 'CJ';
        }
        if (!existing) {
            existing = await getAdvertiser('AWIN', id);
            network = 'AWIN';
        }

        if (!existing) {
            return res.status(404).json({ success: false, error: 'Advertiser not found' });
        }

        await upsertAdvertiser({
            ...existing,
            manualHomeUrl: homeLink
        }, existing);

        res.json({ success: true });

    } catch (error) {
        console.error('Error updating home link:', error);
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
            responseType: 'stream'
        });

        res.set('Content-Type', response.headers['content-type']);
        res.set('Access-Control-Allow-Origin', '*'); // Allow all origins for this proxy
        response.data.pipe(res);
    } catch (e) {
        console.error('Proxy error:', e.message);
        res.status(500).send('Error fetching image');
    }
};



const debugFyreLux = async (req, res) => {
    try {
        const db = firebaseConfig.db;
        console.log('DEBUG: Finding FyreLux advertisers...');
        const advSnapshot = await db.collection('advertisers').where('name', '==', 'FyreLux').get();

        const results = [];
        if (advSnapshot.empty) {
            return res.json({ message: 'No FyreLux advertisers found.' });
        }

        for (const doc of advSnapshot.docs) {
            const adv = doc.data();
            const id = adv.id;

            // Check products for this ID (string and number)
            const pSnapStr = await db.collection('products').where('advertiserId', '==', String(id)).count().get();
            const pSnapNum = await db.collection('products').where('advertiserId', '==', Number(id)).count().get();

            // Check offers too
            const oSnap = await db.collection('offers').where('advertiserId', '==', String(id)).count().get();

            results.push({
                docId: doc.id,
                advId: id,
                name: adv.name,
                productsCountString: pSnapStr.data().count,
                productsCountNumber: pSnapNum.data().count,
                offersCount: oSnap.data().count
            });
        }

        res.json({ success: true, count: results.length, data: results });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
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
    uploadLogoMiddleware,
    getHomepage,
    getArchitecture,
    getStyle,
    updateStyle,
    uploadStyleMiddleware,
    proxyImage,
    debugFyreLux
};
