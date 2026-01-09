const firebaseConfig = require('../config/firebase');
const brandfetch = require('./brandfetch');
const rakutenService = require('./rakuten');
const cjService = require('./cj');
const awinService = require('./awin');
const pepperjamService = require('./pepperjam');
const { upsertAdvertiser, upsertOffer, upsertProduct, getAdvertiser, getProduct, logSyncComplete, getSyncHistory, pruneStaleRecords } = require('./db');
const imageStore = require('./imageStore');

// Global Sync State
let isGlobalSyncRunning = false;

const syncState = {
    Rakuten: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } },
    CJ: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } },
    AWIN: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } },
    Pepperjam: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } }
};

const getGlobalSyncState = () => syncState;

const resetState = (network) => {
    syncState[network] = {
        status: 'running',
        advertisers: { checked: 0, new: 0 },
        offers: { checked: 0, new: 0 },
        products: { checked: 0, new: 0 }
    };
};

// Helpers for Promo Code Detection
const isRealCode = (code) => {
    if (!code) return false;
    const clean = String(code).trim().toUpperCase();
    const nonCodes = ['N/A', 'NONE', 'NO CODE', '', 'NULL', 'UNDEFINED', 'SEE SITE', 'NO COUPON CODE'];
    return !nonCodes.includes(clean);
};

const extractCodeFromDescription = (desc) => {
    if (!desc) return null;
    // Common patterns for codes: "Use code: PROMO20", "CODE: DISCOUNT", etc.
    const patterns = [
        /code:\s*([A-Za-z0-9_-]{3,})/i,
        /promo code:\s*([A-Za-z0-9_-]{3,})/i,
        /coupon code:\s*([A-Za-z0-9_-]{3,})/i,
        /use code\s*([A-Za-z0-9_-]{3,})/i,
        /enter code\s*([A-Za-z0-9_-]{3,})/i
    ];
    for (const p of patterns) {
        const match = desc.match(p);
        if (match && match[1]) return match[1].toUpperCase();
    }
    return null;
};

const generateSearchKeywords = (text) => {
    if (!text) return [];
    const keywords = new Set();
    const clean = String(text).toLowerCase().replace(/[^a-z0-9]/g, ' ');
    const words = clean.split(/\s+/).filter(w => w.length >= 2);

    words.forEach(word => {
        keywords.add(word);
        // Generate n-grams (substrings) for true "contains" matching
        if (word.length >= 3) {
            for (let i = 0; i <= word.length - 3; i++) {
                // Generate substrings of length 3 to 15
                for (let len = 3; len <= 15 && i + len <= word.length; len++) {
                    keywords.add(word.substring(i, i + len));
                }
            }
        }
    });

    // Add bigrams for phrase matching
    for (let i = 0; i < words.length - 1; i++) {
        keywords.add(`${words[i]} ${words[i + 1]}`);
    }

    return Array.from(keywords).slice(0, 100); // Firestore limit is 100
};

const cacheImage = async (url, folder) => {
    try {
        if (!url) return null;
        if (!url.startsWith('http')) return null;
        return await imageStore.cacheImage(url, folder);
    } catch (e) {
        console.warn('Failed to cache image ' + url + ': ' + e.message);
        return null;
    }
};

const recalculateAdvertiserCounts = async (network, advertiserId) => {
    try {
        const db = firebaseConfig.db;
        const aid = String(advertiserId);
        const now = new Date();

        // Optimized counting using .count() - Match both string and number IDs
        const p1Snap = await db.collection('products')
            .where('network', '==', network)
            .where('advertiserId', '==', aid)
            .count().get();
        const p2Snap = await db.collection('products')
            .where('network', '==', network)
            .where('advertiserId', '==', Number(aid))
            .count().get();
        const actualProductCount = p1Snap.data().count + p2Snap.data().count;

        // Fetch all offers to check for expiration and promo codes
        const o1 = db.collection('offers').where('advertiserId', '==', aid).get();
        const o2 = db.collection('offers').where('advertiserId', '==', Number(aid)).get();
        const [os1, os2] = await Promise.all([o1, o2]);
        const allOffers = [...os1.docs.map(d => d.data()), ...os2.docs.map(d => d.data())];

        let activeOfferCount = 0;
        let hasActivePromoCode = false;

        for (const offer of allOffers) {
            const isExpired = offer.endDate && new Date(offer.endDate) < now;
            if (!isExpired) {
                activeOfferCount++;
                let code = offer.code;
                if (!isRealCode(code)) {
                    code = extractCodeFromDescription(offer.description);
                }
                if (isRealCode(code)) {
                    hasActivePromoCode = true;
                }
            }
        }

        // Atomic update of denormalized stats
        await upsertAdvertiser({
            id: aid,
            network: network,
            productCount: actualProductCount,
            offerCount: activeOfferCount,
            hasPromoCodes: hasActivePromoCode
        });

        return { products: actualProductCount, offers: activeOfferCount };
    } catch (e) {
        console.error(`[SYNC] Failed to recalculate counts for ${advertiserId}:`, e.message);
        return null;
    }
};

/**
 * Performs a global audit of all advertiser product counts to ensure zero drift.
 * This should be run after a full sync cycle.
 */
const reconcileAllProductCounts = async () => {
    try {
        console.log('SYNC: Starting Global Product Count Reconciliation...');
        const db = firebaseConfig.db;
        const advSnapshot = await db.collection('advertisers').get();

        for (const doc of advSnapshot.docs) {
            const adv = doc.data();
            await recalculateAdvertiserCounts(adv.network, adv.id);
        }
        console.log('SYNC: Global Reconciliation complete.');
    } catch (e) {
        console.error('SYNC: Global reconciliation failed:', e.message);
    }
};


// Generic Sync Wrapper
const syncWithLog = async (network, syncFn) => {
    if (isGlobalSyncRunning) {
        console.log(`SYNC: A sync is already in progress. Skipping ${network} sync.`);
        return;
    }
    if (syncState[network].status === 'running') {
        console.log('SYNC: ' + network + ' already running. Skipping.');
        return;
    }
    isGlobalSyncRunning = true;
    resetState(network);
    const startTime = Date.now();
    try {
        await syncFn();
        syncState[network].status = 'complete';
        syncState[network].completedAt = Date.now();

        // Log to DB
        await logSyncComplete(network, {
            advertisers: syncState[network].advertisers,
            offers: syncState[network].offers,
            products: syncState[network].products,
            duration: (Date.now() - startTime) / 1000
        });

    } catch (e) {
        console.error('SYNC: ' + network + ' Failed', e);
        syncState[network].status = 'error';
        syncState[network].error = e.message;
    } finally {
        isGlobalSyncRunning = false;
    }
};


// --- Sync Logic per Network ---

// RAKUTEN
const syncRakutenAll = async () => {
    return syncWithLog('Rakuten', async () => {
        await syncRakutenAdvertisers();
        await syncRakutenCoupons();
        await syncRakutenProducts();
    });
};

const syncRakutenAdvertisers = async () => {
    console.log('SYNC: Fetching Rakuten advertisers...');
    const rakutenAdvs = await rakutenService.fetchAdvertisers();
    console.log(`SYNC: Found ${rakutenAdvs.length} Rakuten advertisers.`);

    const activeIds = new Set();
    // Generate Deep Links for all (rate-limited)
    const deepLinksMap = await rakutenService.generateDeepLinksForAll(rakutenAdvs);

    for (const adv of rakutenAdvs) {

        const advId = adv.mid || adv.id;
        const network = 'Rakuten';
        const existingData = await getAdvertiser(network, advId);

        let logoUrl = adv.logoUrl || (existingData ? existingData.logoUrl : null);
        let storageLogoUrl = existingData ? existingData.storageLogoUrl : null;

        // Reuse existing image if source URL hasn't changed (and we have a valid cache)
        const logoChanged = !existingData || existingData.logoUrl !== logoUrl;

        if (logoUrl && logoChanged) {
            storageLogoUrl = await cacheImage(logoUrl, 'advertisers/rakuten');
        }

        // If cache failed, the logoUrl is bad. Clear it so we don't save a broken link.
        if (!storageLogoUrl && logoChanged) {
            logoUrl = null;
        }

        // Fallback to Brandfetch if no logo OR if caching failed (broken link)
        // Only retry if we don't have a good one already
        if (!storageLogoUrl && adv.url) {
            if (!existingData || !existingData.storageLogoUrl) {
                const domain = brandfetch.extractDomain(adv.url);
                const bfLogoUrl = await brandfetch.fetchLogo(domain);
                if (bfLogoUrl) {
                    logoUrl = bfLogoUrl; // Update to use BF logo
                    storageLogoUrl = await cacheImage(logoUrl, 'advertisers/rakuten');
                }
            }
        }


        const cleanAdv = JSON.parse(JSON.stringify(adv)); // Strip undefined

        // Preserve manual logo if set
        const isManualLogo = existingData && existingData.isManualLogo;

        // Use generated deep link if available, otherwise preserve existing or null
        const affiliateHomeUrl = deepLinksMap[advId] || (existingData && existingData.affiliateHomeUrl) || null;

        const currentData = {
            id: advId,
            network: network,
            name: adv.name || adv.merchantname,
            status: 'Active',
            url: adv.url || adv.main_url || '',
            categories: adv.categories || [],
            country: adv.country || 'Unknown',
            logoUrl: isManualLogo ? (existingData.logoUrl || logoUrl) : (logoUrl || null),
            storageLogoUrl: isManualLogo ? existingData.storageLogoUrl : (storageLogoUrl || null),
            isManualLogo: isManualLogo || false,
            affiliateHomeUrl: affiliateHomeUrl, // New field
            raw_data: cleanAdv
        };

        const result = await upsertAdvertiser(currentData, existingData);
        if (result.status === 'created') {
            syncState.Rakuten.advertisers.new++;
        } else {
            syncState.Rakuten.advertisers.checked++;
        }
        activeIds.add(result.id);
    }
    await pruneStaleRecords('Rakuten', 'advertisers', Array.from(activeIds));
};

const syncRakutenCoupons = async () => {
    console.log('SYNC: Fetching Rakuten Coupons...');
    try {
        const rawCoupons = await rakutenService.fetchCoupons();
        // Dedupe coupons based on link (Prioritize codes)
        const deduped = new Map();
        rawCoupons.forEach(c => {
            const existing = deduped.get(c.link);
            const hasCode = isRealCode(c.code) || !!extractCodeFromDescription(c.description);
            if (!existing || (hasCode && !(isRealCode(existing.code) || !!extractCodeFromDescription(existing.description)))) {
                deduped.set(c.link, c);
            }
        });
        const coupons = [...deduped.values()];
        const activeIds = new Set();
        const offerCountsMap = {};
        const hasCodesMap = {};
        for (const coupon of coupons) {
            const result = await upsertOffer({
                ...coupon,
                advertiserId: String(coupon.advertiserId), // Enforce String type
                network: 'Rakuten'
            });
            activeIds.add(result.id);

            const aid = String(coupon.advertiserId);
            const isExpired = coupon.endDate && new Date(coupon.endDate) < new Date();

            // Aggressive code detection
            let activeCode = coupon.code;
            if (!isRealCode(activeCode)) {
                activeCode = extractCodeFromDescription(coupon.description) || 'N/A';
            }

            if (!isExpired) {
                offerCountsMap[aid] = (offerCountsMap[aid] || 0) + 1;
                if (isRealCode(activeCode)) {
                    hasCodesMap[aid] = true;
                }
            }

            if (result.status === 'created') {
                syncState.Rakuten.offers.new++;
            } else {
                syncState.Rakuten.offers.checked++;
            }
        }

        // Update Advertiser Offer Counts
        console.log('SYNC: Updating Rakuten Advertiser Offer Counts...');
        for (const [aid, count] of Object.entries(offerCountsMap)) {
            await upsertAdvertiser({
                id: aid,
                network: 'Rakuten',
                offerCount: count,
                hasPromoCodes: hasCodesMap[aid] || false
            });
        }

        await pruneStaleRecords('Rakuten', 'offers', Array.from(activeIds));
    } catch (error) {
        console.error('SYNC: Error syncing Rakuten coupons:', error.message);
    }
};

const syncRakutenProducts = async (inputAdvs = null) => {
    console.log('SYNC: Fetching/Saving Rakuten Products (Sequential Mode)...');
    const advs = inputAdvs || await rakutenService.fetchAdvertisers();

    // We process advertisers sequentially to save memory and avoid OOM
    let processedCount = 0;
    const activeIds = new Set();
    const delayMs = 2000; // Rate limit delay

    for (const adv of advs) {
        processedCount++;
        console.log(`[Rakuten] Processing products for advertiser ${processedCount}/${advs.length}: ${adv.name} (${adv.id})...`);

        try {
            // Fetch directly for this single advertiser
            const products = await rakutenService.fetchProducts(adv.id);

            if (!products || products.length === 0) {
                // console.log(`[Rakuten] No products found for ${adv.name}.`);
                continue;
            }

            // Save immediately
            for (const p of products) {
                try {
                    const sku = p.sku || `${adv.id}-${p.name.substring(0, 20)}`;
                    const network = 'Rakuten';
                    const existingData = await getProduct(network, sku);

                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;

                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        try {
                            storageImageUrl = await cacheImage(p.imageUrl, 'products/rakuten');
                        } catch (imgErr) {
                            // ignore image error
                        }
                    }

                    const productData = {
                        sku: sku,
                        network: network,
                        advertiserId: String(adv.id), // Ensure string
                        advertiserName: adv.name || '',
                        name: p.name || 'Unknown Product',
                        searchKeywords: generateSearchKeywords(p.name),
                        price: p.price !== undefined ? p.price : null,
                        salePrice: p.salePrice !== undefined ? p.salePrice : null,
                        currency: p.currency || 'USD',
                        link: p.link || '',
                        imageUrl: p.imageUrl || null,
                        storageImageUrl: storageImageUrl,
                        description: p.description || '',
                        raw_data: JSON.parse(JSON.stringify(p))
                    };
                    Object.keys(productData).forEach(key => productData[key] === undefined && delete productData[key]);

                    const result = await upsertProduct(productData, existingData);
                    activeIds.add(result.id);

                    if (result.status === 'created') {
                        syncState.Rakuten.products.new++;
                    } else {
                        syncState.Rakuten.products.checked++;
                    }
                } catch (err) {
                    console.error(`[Rakuten] Failed to save product ${p.sku}:`, err.message);
                }
            }

            // Update Advertiser Stats immediately
            const saleCount = products.reduce((acc, p) => {
                const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                return (s > 0 && pr > s) ? acc + 1 : acc;
            }, 0);

            await upsertAdvertiser({
                id: adv.id,
                network: 'Rakuten',
                productCount: products.length,
                saleProductCount: saleCount,
                hasSaleItems: saleCount > 0
            });

        } catch (e) {
            console.error(`[Rakuten] Error fetching/saving for ${adv.name}:`, e.message);
        }

        // Rate limit delay between advertisers
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    await pruneStaleRecords('Rakuten', 'products', Array.from(activeIds));

    // Final Audit of counts to ensure UI matches DB exactly
    console.log('SYNC: Auditing final Rakuten counts...');
    for (const adv of advs) {
        await recalculateAdvertiserCounts('Rakuten', adv.id);
    }

    console.log('[Rakuten] Product sync complete.');
};


// CJ
const syncCJAll = async () => {
    return syncWithLog('CJ', async () => {
        await syncCJAdvertisers();
        await syncCJLinks();
        await syncCJProducts();
    });
};

const syncCJAdvertisers = async () => {
    console.log('SYNC: Fetching CJ advertisers...');
    const cjAdvs = await cjService.fetchAdvertisers();
    console.log(`SYNC: Found ${cjAdvs.length} CJ advertisers.`);

    const activeIds = new Set();
    for (const adv of cjAdvs) {
        const existingData = await getAdvertiser('CJ', adv.id);

        let logoUrl = adv.logoUrl;
        let storageLogoUrl = existingData ? existingData.storageLogoUrl : null;
        const logoChanged = !existingData || existingData.logoUrl !== logoUrl;

        if (logoUrl && logoChanged) {
            storageLogoUrl = await cacheImage(logoUrl, 'advertisers/cj');
        }
        if (!storageLogoUrl && logoChanged) logoUrl = null;

        if (!storageLogoUrl && adv.url) {
            if (!existingData || !existingData.storageLogoUrl) {
                const domain = brandfetch.extractDomain(adv.url);
                const bfLogoUrl = await brandfetch.fetchLogo(domain);
                if (bfLogoUrl) {
                    logoUrl = bfLogoUrl;
                    storageLogoUrl = await cacheImage(logoUrl, 'advertisers/cj');
                }
            }
        }

        const cleanAdv = JSON.parse(JSON.stringify(adv));
        const result = await upsertAdvertiser({
            id: adv.id,
            network: 'CJ',
            name: adv.name,
            status: adv.status || 'joined',
            url: adv.url || '',
            categories: adv.categories || [],
            country: adv.country || 'Unknown',
            logoUrl: logoUrl || null,
            storageLogoUrl: storageLogoUrl || null,
            raw_data: cleanAdv
        }, existingData);

        activeIds.add(result.id); // 2. Add result.id to set.

        if (result.status === 'created') {
            syncState.CJ.advertisers.new++;
        } else {
            syncState.CJ.advertisers.checked++;
        }
    }
    await pruneStaleRecords('CJ', 'advertisers', Array.from(activeIds)); // 3. Call pruneStaleRecords at end.
};

const syncCJLinks = async () => {
    console.log('SYNC: Fetching CJ Links/Offers...');
    try {
        const rawOffers = await cjService.fetchOffers();
        const links = [...new Map(rawOffers.map(o => [o.link, o])).values()]; // Renamed 'offers' to 'links'
        const activeIds = new Set();
        const offerCountsMap = {};
        const hasCodesMap = {};

        for (const link of links) {
            const result = await upsertOffer({
                ...link,
                advertiserId: String(link.advertiserId), // Enforce String type
                network: 'CJ'
            });
            activeIds.add(result.id);

            const aid = String(link.advertiserId);
            const isExpired = link.endDate && new Date(link.endDate) < new Date();

            // Aggressive code detection
            let activeCode = link.code;
            if (!isRealCode(activeCode)) {
                activeCode = extractCodeFromDescription(link.description) || 'N/A';
            }

            if (!isExpired) {
                offerCountsMap[aid] = (offerCountsMap[aid] || 0) + 1;
                if (isRealCode(activeCode)) {
                    hasCodesMap[aid] = true;
                }
            }

            if (result.status === 'created') {
                syncState.CJ.offers.new++;
            } else {
                syncState.CJ.offers.checked++;
            }
        }

        // Update Advertiser Offer Counts
        console.log('SYNC: Updating CJ Advertiser Offer Counts...');
        for (const [aid, count] of Object.entries(offerCountsMap)) {
            await upsertAdvertiser({
                id: aid,
                network: 'CJ',
                offerCount: count,
                hasPromoCodes: hasCodesMap[aid] || false
            });
        }

        await pruneStaleRecords('CJ', 'offers', Array.from(activeIds));
    } catch (error) {
        console.error('SYNC: Error syncing CJ links:', error.message);
    }
};

const syncCJProducts = async () => {
    console.log('SYNC: Fetching/Saving CJ Products (Incremental Mode)...');
    try {
        const advs = await cjService.fetchAdvertisers();
        const activeIds = new Set();
        const salesStats = {}; // advertiserId -> saleCount
        const productCounts = {}; // advertiserId -> totalCount

        // Define the callback to process each page of CJ products
        const onPage = async (products, pageNum) => {
            // console.log(`[CJ] Page ${pageNum}: Processing ${products.length} products...`);
            for (const p of products) {
                try {
                    const network = 'CJ';
                    const sku = p.sku;
                    if (!sku) continue;

                    const aid = String(p.advertiserId);
                    productCounts[aid] = (productCounts[aid] || 0) + 1;

                    const existingData = await getProduct(network, sku);

                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;

                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        try {
                            storageImageUrl = await cacheImage(p.imageUrl, 'products/cj');
                        } catch (imgErr) {
                            // Suppress
                        }
                    }

                    const productData = {
                        sku: sku,
                        network: 'CJ',
                        advertiserId: String(p.advertiserId),
                        advertiserName: p.advertiserName || '',
                        name: p.name || 'Unknown Product',
                        searchKeywords: generateSearchKeywords(p.name),
                        price: p.price !== undefined ? p.price : null,
                        salePrice: p.salePrice !== undefined ? p.salePrice : null,
                        currency: p.currency || 'USD',
                        link: p.link || '',
                        imageUrl: p.imageUrl || null,
                        storageImageUrl: storageImageUrl,
                        description: p.description || '',
                        raw_data: JSON.parse(JSON.stringify(p))
                    };

                    Object.keys(productData).forEach(key => productData[key] === undefined && delete productData[key]);

                    const result = await upsertProduct(productData, existingData);
                    activeIds.add(result.id);

                    if (result.status === 'created') {
                        syncState.CJ.products.new++;
                    } else {
                        syncState.CJ.products.checked++;
                    }

                    // Track sales count for stats
                    const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                    const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                    if (s > 0 && pr > s) {
                        const aid = String(p.advertiserId);
                        salesStats[aid] = (salesStats[aid] || 0) + 1;
                    }

                } catch (err) {
                    console.error(`[CJ] Failed to save product ${p.sku}:`, err.message);
                }
            }
        };

        // Run the fetch with the callback
        await cjService.fetchProducts(onPage);

        // Update Advertiser Stats
        console.log('SYNC: Updating CJ Advertiser Stats...');
        for (const adv of advs) {
            const aid = String(adv.id);
            const saleCount = salesStats[aid] || 0;
            const pCount = productCounts[aid] || 0;
            try {
                await upsertAdvertiser({
                    id: adv.id,
                    network: 'CJ',
                    productCount: pCount,
                    saleProductCount: saleCount,
                    hasSaleItems: saleCount > 0
                });
            } catch (err) {
                console.error(`SYNC: Failed to update stats for CJ adv ${adv.id}:`, err.message);
            }
        }

        await pruneStaleRecords('CJ', 'products', Array.from(activeIds));

        // Final Audit of counts
        console.log('SYNC: Auditing final CJ counts...');
        for (const adv of advs) {
            await recalculateAdvertiserCounts('CJ', adv.id);
        }

        console.log('[CJ] Product sync complete.');

    } catch (error) {
        console.error('SYNC: Error syncing CJ products:', error.message);
    }
};


// AWIN
const syncAWINAll = async () => {
    return syncWithLog('AWIN', async () => {
        await syncAWINAdvertisers();
        await syncAWINOffers();
        await syncAWINProducts();
    });
};

const syncAWINAdvertisers = async () => {
    console.log('SYNC: Fetching AWIN advertisers...');
    const awinAdvs = await awinService.fetchAdvertisers();
    console.log(`SYNC: Found ${awinAdvs.length} AWIN advertisers.`);

    const activeIds = new Set();
    for (const adv of awinAdvs) {
        const existingData = await getAdvertiser('AWIN', adv.id);
        // ... (existing vars)
        let logoUrl = adv.logoUrl;
        let storageLogoUrl = existingData ? existingData.storageLogoUrl : null;
        const logoChanged = !existingData || existingData.logoUrl !== logoUrl;

        if (logoUrl && logoChanged) {
            storageLogoUrl = await cacheImage(logoUrl, 'advertisers/awin');
        }
        if (!storageLogoUrl && logoChanged) logoUrl = null;

        if (!storageLogoUrl && adv.url) {
            if (!existingData || !existingData.storageLogoUrl) {
                // ... (brandfetch)
                const domain = brandfetch.extractDomain(adv.url);
                const bfLogoUrl = await brandfetch.fetchLogo(domain);
                if (bfLogoUrl) {
                    logoUrl = bfLogoUrl;
                    storageLogoUrl = await cacheImage(logoUrl, 'advertisers/awin');
                }
            }
        }

        const cleanAdv = JSON.parse(JSON.stringify(adv));
        const result = await upsertAdvertiser({
            id: adv.id,
            network: 'AWIN',
            name: adv.name,
            status: adv.status || 'joined',
            url: adv.url || '',
            categories: adv.categories || [],
            country: adv.country,
            logoUrl: logoUrl || null,
            storageLogoUrl: storageLogoUrl || null,
            raw_data: cleanAdv
        }, existingData);
        activeIds.add(result.id);

        if (result.status === 'created') {
            syncState.AWIN.advertisers.new++;
        } else {
            syncState.AWIN.advertisers.checked++;
        }
    }
    await pruneStaleRecords('AWIN', 'advertisers', Array.from(activeIds));
};

const syncAWINOffers = async () => {
    console.log('SYNC: Fetching AWIN Offers...');
    const rawOffers = await awinService.fetchOffers();
    const offers = [...new Map(rawOffers.map(o => [o.link, o])).values()];
    const activeIds = new Set();
    const offerCountsMap = {};
    const hasCodesMap = {};

    for (const offer of offers) {
        try {
            const cleanOffer = JSON.parse(JSON.stringify(offer));
            const result = await upsertOffer({
                ...cleanOffer,
                advertiserId: String(cleanOffer.advertiserId), // Enforce String type for ID matching
                network: 'AWIN'
            });
            activeIds.add(result.id);

            const aid = String(offer.advertiserId);
            const isExpired = offer.endDate && new Date(offer.endDate) < new Date();

            // Aggressive code detection
            let activeCode = offer.code;
            if (!isRealCode(activeCode)) {
                activeCode = extractCodeFromDescription(offer.description) || 'N/A';
            }

            if (!isExpired) {
                offerCountsMap[aid] = (offerCountsMap[aid] || 0) + 1;
                if (isRealCode(activeCode)) {
                    hasCodesMap[aid] = true;
                }
            }

            if (result.status === 'created') {
                syncState.AWIN.offers.new++;
            } else {
                syncState.AWIN.offers.checked++;
            }
        } catch (err) {
            console.error(`SYNC: Failed to save AWIN offer:`, err.message);
        }
    }

    // Update Advertiser Offer Counts
    console.log('SYNC: Updating AWIN Advertiser Offer Counts...');
    for (const [aid, count] of Object.entries(offerCountsMap)) {
        await upsertAdvertiser({
            id: aid,
            network: 'AWIN',
            offerCount: count,
            hasPromoCodes: hasCodesMap[aid] || false
        });
    }
    await pruneStaleRecords('AWIN', 'offers', Array.from(activeIds));
};

const syncAWINProducts = async (inputAdvs = null) => {
    console.log('SYNC: Fetching/Saving AWIN Products (Sequential Mode)...');
    const advs = inputAdvs || await awinService.fetchAdvertisers();

    // We process sequentially to prevent OOM
    let processedCount = 0;
    const activeIds = new Set();
    const delayMs = 1500; // Rate limit delay

    for (const adv of advs) {
        processedCount++;
        console.log(`[AWIN] Processing products for advertiser ${processedCount}/${advs.length}: ${adv.name} (${adv.id})...`);

        try {
            // Fetch directly for this single advertiser
            // Note: AWIN fetchProducts returns products for that advertiser
            const products = await awinService.fetchProducts(adv.id);

            if (!products || products.length === 0) {
                continue;
            }

            console.log(`[AWIN] Saving ${products.length} products for ${adv.name}...`);

            // Save immediately
            for (const p of products) {
                try {
                    const sku = p.sku;
                    const network = 'AWIN';
                    // We need to determine if it exists. 
                    // p.sku is standard from AWIN service.

                    if (!sku) continue;

                    let existingData = await getProduct(network, sku);

                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;

                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        try {
                            storageImageUrl = await cacheImage(p.imageUrl, 'products/awin');
                        } catch (imgErr) {
                            // ignore
                        }
                    }

                    const productData = {
                        sku: sku,
                        network: 'AWIN',
                        advertiserId: String(adv.id), // Ensure string
                        advertiserName: adv.name || '',
                        name: p.name || 'Unknown Product',
                        searchKeywords: generateSearchKeywords(p.name),
                        price: p.price !== undefined ? p.price : null,
                        salePrice: p.salePrice !== undefined ? p.salePrice : null,
                        currency: p.currency || 'USD',
                        link: p.link || '',
                        imageUrl: p.imageUrl || null,
                        storageImageUrl: storageImageUrl,
                        description: p.description || '',
                        raw_data: JSON.parse(JSON.stringify(p))
                    };
                    Object.keys(productData).forEach(key => productData[key] === undefined && delete productData[key]);

                    const result = await upsertProduct(productData, existingData);
                    activeIds.add(result.id);

                    if (result.status === 'created') {
                        syncState.AWIN.products.new++;
                    } else {
                        syncState.AWIN.products.checked++;
                    }

                } catch (err) {
                    console.error(`[AWIN] Failed to save product ${p.sku}:`, err.message);
                }
            }

            // Update Advertiser Stats
            const saleCount = products.reduce((acc, p) => {
                const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                return (s > 0 && pr > s) ? acc + 1 : acc;
            }, 0);

            try {
                await upsertAdvertiser({
                    id: adv.id,
                    network: 'AWIN',
                    productCount: products.length,
                    saleProductCount: saleCount,
                    hasSaleItems: saleCount > 0
                });
            } catch (err) {
                // Ignore
            }

        } catch (e) {
            console.error(`[AWIN] Error fetching/saving for ${adv.name}:`, e.message);
        }

        // Rate limit delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    await pruneStaleRecords('AWIN', 'products', Array.from(activeIds));

    // Final Audit of counts
    console.log('SYNC: Auditing final AWIN counts...');
    for (const adv of advs) {
        await recalculateAdvertiserCounts('AWIN', adv.id);
    }

    console.log('[AWIN] Product sync complete.');
};


// Pepperjam
const syncPepperjamAll = async () => {
    return syncWithLog('Pepperjam', async () => {
        await syncPepperjamAdvertisers();
        await syncPepperjamOffers();
        await syncPepperjamProducts();
    });
};

const syncPepperjamAdvertisers = async () => {
    console.log('SYNC: Fetching Pepperjam advertisers...');
    const advs = await pepperjamService.fetchAdvertisers();
    console.log(`SYNC: Found ${advs.length} Pepperjam advertisers.`);

    const activeIds = new Set();
    for (const adv of advs) {
        const existingData = await getAdvertiser('Pepperjam', adv.id);

        let logoUrl = null;
        let storageLogoUrl = existingData ? existingData.storageLogoUrl : null;

        // Pepperjam doesn't provide logos in advertiser list, so fallback to Brandfetch
        if (!storageLogoUrl && adv.url) {
            const domain = brandfetch.extractDomain(adv.url);
            const bfLogoUrl = await brandfetch.fetchLogo(domain);
            if (bfLogoUrl) {
                logoUrl = bfLogoUrl;
                storageLogoUrl = await cacheImage(logoUrl, 'advertisers/pepperjam');
            }
        }

        const result = await upsertAdvertiser({
            id: adv.id,
            network: 'Pepperjam',
            name: adv.name,
            status: adv.status,
            url: adv.url || '',
            categories: adv.categories || [],
            country: 'Unknown',
            logoUrl: logoUrl,
            storageLogoUrl: storageLogoUrl,
            raw_data: adv
        }, existingData);

        activeIds.add(result.id);

        if (result.status === 'created') {
            syncState.Pepperjam.advertisers.new++;
        } else {
            syncState.Pepperjam.advertisers.checked++;
        }
    }
    await pruneStaleRecords('Pepperjam', 'advertisers', Array.from(activeIds));
};

const syncPepperjamOffers = async () => {
    console.log('SYNC: Fetching Pepperjam Offers...');
    try {
        const offers = await pepperjamService.fetchOffers();
        const activeIds = new Set();
        const offerCountsMap = {};
        const hasCodesMap = {};

        for (const offer of offers) {
            const result = await upsertOffer({
                ...offer,
                advertiserId: String(offer.advertiserId),
                network: 'Pepperjam'
            });
            activeIds.add(result.id);

            const aid = String(offer.advertiserId);
            const isExpired = offer.endDate && new Date(offer.endDate) < new Date();

            let activeCode = offer.code;
            if (!isRealCode(activeCode)) {
                activeCode = extractCodeFromDescription(offer.description) || 'N/A';
            }

            if (!isExpired) {
                offerCountsMap[aid] = (offerCountsMap[aid] || 0) + 1;
                if (isRealCode(activeCode)) {
                    hasCodesMap[aid] = true;
                }
            }

            if (result.status === 'created') {
                syncState.Pepperjam.offers.new++;
            } else {
                syncState.Pepperjam.offers.checked++;
            }
        }

        for (const [aid, count] of Object.entries(offerCountsMap)) {
            await upsertAdvertiser({
                id: aid,
                network: 'Pepperjam',
                offerCount: count,
                hasPromoCodes: hasCodesMap[aid] || false
            });
        }

        await pruneStaleRecords('Pepperjam', 'offers', Array.from(activeIds));
    } catch (error) {
        console.error('SYNC: Error syncing Pepperjam offers:', error.message);
    }
};

const syncPepperjamProducts = async () => {
    console.log('SYNC: Fetching Pepperjam Products...');
    const activeIds = new Set();

    try {
        await pepperjamService.fetchProducts(async (products, page) => {
            for (const p of products) {
                try {
                    const sku = p.sku;
                    const existingData = await getProduct('Pepperjam', sku);

                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;

                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        storageImageUrl = await cacheImage(p.imageUrl, 'products/pepperjam');
                    }

                    const productData = {
                        ...p,
                        storageImageUrl: storageImageUrl,
                        searchKeywords: generateSearchKeywords(p.name)
                    };

                    const result = await upsertProduct(productData, existingData);
                    activeIds.add(result.id);

                    if (result.status === 'created') {
                        syncState.Pepperjam.products.new++;
                    } else {
                        syncState.Pepperjam.products.checked++;
                    }
                } catch (err) {
                    console.error(`[Pepperjam] Failed to save product ${p.sku}:`, err.message);
                }
            }
        });

        await pruneStaleRecords('Pepperjam', 'products', Array.from(activeIds));

        // Audit counts
        console.log('SYNC: Auditing final Pepperjam counts...');
        const advs = await pepperjamService.fetchAdvertisers();
        for (const adv of advs) {
            await recalculateAdvertiserCounts('Pepperjam', adv.id);
        }

        console.log('[Pepperjam] Product sync complete.');
    } catch (error) {
        console.error('SYNC: Error syncing Pepperjam products:', error.message);
    }
};

const syncAdvertisers = async () => {
    console.log('SYNC: Starting Advertiser Sync (Sequential Mode)...');
    await syncRakutenAdvertisers().catch(e => console.error('Rakuten Advertiser Sync Failed:', e.message));
    await syncCJAdvertisers().catch(e => console.error('CJ Advertiser Sync Failed:', e.message));
    await syncAWINAdvertisers().catch(e => console.error('AWIN Advertiser Sync Failed:', e.message));
    await syncPepperjamAdvertisers().catch(e => console.error('Pepperjam Advertiser Sync Failed:', e.message));
};

const syncOffers = async () => {
    console.log('SYNC: Starting Offer/Link Sync (Sequential Mode)...');
    await syncRakutenCoupons().catch(e => console.error('Rakuten Coupon Sync Failed:', e.message));
    await syncCJLinks().catch(e => console.error('CJ Link Sync Failed:', e.message));
    await syncAWINOffers().catch(e => console.error('AWIN Offer Sync Failed:', e.message));
    await syncPepperjamOffers().catch(e => console.error('Pepperjam Offer Sync Failed:', e.message));
};

const syncProducts = async () => {
    console.log('SYNC: Starting Product Sync (Sequential Mode)...');
    await syncRakutenProducts().catch(e => console.error('Rakuten Product Sync Failed:', e.message));
    await syncCJProducts().catch(e => console.error('CJ Product Sync Failed:', e.message));
    await syncAWINProducts().catch(e => console.error('AWIN Product Sync Failed:', e.message));
    await syncPepperjamProducts().catch(e => console.error('Pepperjam Product Sync Failed:', e.message));
};

const syncAll = async () => {
    if (isGlobalSyncRunning) {
        console.log('SYNC: A sync is already in progress. Skipping syncAll.');
        return;
    }
    isGlobalSyncRunning = true;
    console.log('SYNC: Starting Full Sync...');
    const startTime = Date.now();
    try {
        await syncAdvertisers();
        await syncOffers();
        await syncProducts();

        // Audit everything at the end to ensure denormalized counts are 100% correct
        await reconcileAllProductCounts();

        const duration = (Date.now() - startTime) / 1000;
        console.log(`SYNC: Full Sync Complete in ${duration}s.`);
    } catch (e) {
        console.error('SYNC: Full Sync Failed:', e.message);
    } finally {
        isGlobalSyncRunning = false;
    }
};

module.exports = {
    syncAdvertisers,
    syncProducts,
    syncOffers,
    syncAll,
    syncRakutenAll,
    syncCJAll,
    syncAWINAll,
    syncRakutenAdvertisers,
    syncCJAdvertisers,
    syncAWINAdvertisers,
    syncRakutenProducts,
    syncAWINProducts,
    syncCJProducts,
    syncRakutenCoupons,
    syncCJLinks,
    syncAWINOffers,
    syncPepperjamAll,
    syncPepperjamAdvertisers,
    syncPepperjamOffers,
    syncPepperjamProducts,
    getGlobalSyncState,
    getSyncHistory,
    recalculateAdvertiserCounts
};
