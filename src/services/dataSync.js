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
let brandfetchSessionCount = 0;
const MAX_BRANDFETCH_PER_SESSION = 50; // systematic delivery of missing logos

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
    const nonCodes = [
        'N/A', 'NONE', 'NO CODE', 'NO CODE REQUIRED', 'NO COUPON CODE', 'NO COUPON CODE REQUIRED',
        'NO COUPON REQUIRED', 'NO PROMO CODE REQUIRED', 'NO PROMO REQUIRED',
        'SEE SITE', 'CLICK TO REVEAL', 'AUTO-APPLIED', 'ONLINE ONLY', 'NULL', 'UNDEFINED', '',
        'NO COUPON CODE NEEDED', 'NO CODE NEEDED', 'NO PROMO CODE NEEDED'
    ];
    return !nonCodes.includes(clean);
};

const extractCodeFromDescription = (desc) => {
    if (!desc) return null;
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
        if (word.length >= 3) {
            for (let i = 0; i <= word.length - 3; i++) {
                for (let len = 3; len <= 15 && i + len <= word.length; len++) {
                    keywords.add(word.substring(i, i + len));
                }
            }
        }
    });

    for (let i = 0; i < words.length - 1; i++) {
        keywords.add(`${words[i]} ${words[i + 1]}`);
    }

    return Array.from(keywords).slice(0, 100);
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

/**
 * Robust logo handling logic for all advertiser syncs.
 * 1. Preserves manual uploads from Mission Control.
 * 2. Caches native network logos.
 * 3. Falls back to Brandfetch only if native logo is missing, respecting session limits.
 */
const handleAdvertiserLogo = async (network, adv, existingData) => {
    // 1. Priority #1: Respect manual logos from Mission Control
    if (existingData && existingData.isManualLogo) {
        return {
            logoUrl: existingData.logoUrl,
            storageLogoUrl: existingData.storageLogoUrl,
            isManualLogo: true
        };
    }

    // 2. Priority #2: Native Logo from Affiliate Network
    let logoUrl = adv.logoUrl || (existingData ? existingData.logoUrl : null);
    let storageLogoUrl = existingData ? existingData.storageLogoUrl : null;
    const logoChanged = !existingData || existingData.logoUrl !== logoUrl;

    // If native logo shifted or is missing from storage, cache it now
    if (logoUrl && (logoChanged || !storageLogoUrl)) {
        const cached = await cacheImage(logoUrl, `advertisers/${network.toLowerCase()}`);
        if (cached) storageLogoUrl = cached;
    }

    // 3. Priority #3: Brandfetch (Only if native logo is completely missing)
    // This block is skipped if we have any valid storageLogoUrl (manual, cached native, or previous BF).
    if (!storageLogoUrl && adv.url && (logoChanged || brandfetchSessionCount < MAX_BRANDFETCH_PER_SESSION)) {
        const domain = brandfetch.extractDomain(adv.url);
        if (domain) {
            if (!logoChanged) brandfetchSessionCount++;

            const bfLogoUrl = await brandfetch.fetchLogo(domain);
            if (bfLogoUrl) {
                logoUrl = bfLogoUrl;
                storageLogoUrl = await cacheImage(logoUrl, `advertisers/${network.toLowerCase()}`);
            }
        }
    }

    return {
        logoUrl: logoUrl || null,
        storageLogoUrl: storageLogoUrl || null,
        isManualLogo: false
    };
};

/**
 * Ensures categories are preserved and not overwritten by empty data from networks.
 */
const handleAdvertiserCategories = (network, adv, existingData) => {
    // Priority 1: Respect already set categories if incoming is empty
    const incomingCats = Array.isArray(adv.categories) ? adv.categories : [];
    const internalCats = (existingData && Array.isArray(existingData.categories)) ? existingData.categories : [];

    // If incoming data from network has categories, we use them (network-fresh data)
    if (incomingCats.length > 0) {
        return {
            categories: incomingCats,
            isManualCategory: !!(existingData && existingData.isManualCategory)
        };
    }

    // If network data is empty, but we already have categories, keep ours!
    if (internalCats.length > 0) {
        return {
            categories: internalCats,
            isManualCategory: !!(existingData && existingData.isManualCategory)
        };
    }

    return {
        categories: [],
        isManualCategory: false
    };
};

const recalculateAdvertiserCounts = async (network, advertiserId) => {
    try {
        const db = firebaseConfig.db;
        const aid = String(advertiserId);
        const now = new Date();

        const p1Snap = await db.collection('products')
            .where('network', '==', network)
            .where('advertiserId', '==', aid)
            .count().get();
        const p2Snap = await db.collection('products')
            .where('network', '==', network)
            .where('advertiserId', '==', Number(aid))
            .count().get();
        const actualProductCount = p1Snap.data().count + p2Snap.data().count;

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
    brandfetchSessionCount = 0;
    resetState(network);
    const startTime = Date.now();
    try {
        await syncFn();
        syncState[network].status = 'complete';
        syncState[network].completedAt = Date.now();
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

// --- RAKUTEN ---
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
    const deepLinksMap = await rakutenService.generateDeepLinksForAll(rakutenAdvs);

    for (const adv of rakutenAdvs) {
        const advId = adv.mid || adv.id;
        const network = 'Rakuten';
        const existingData = await getAdvertiser(network, advId);

        const logoResults = await handleAdvertiserLogo(network, adv, existingData);
        const catResults = handleAdvertiserCategories(network, adv, existingData);
        const affiliateHomeUrl = deepLinksMap[advId] || (existingData && existingData.affiliateHomeUrl) || null;

        const currentData = {
            id: advId,
            network: network,
            name: adv.name || '',
            status: 'Active',
            url: adv.url || '',
            categories: catResults.categories,
            isManualCategory: catResults.isManualCategory,
            country: adv.country || 'Unknown',
            description: adv.description || null,
            logoUrl: logoResults.logoUrl,
            storageLogoUrl: logoResults.storageLogoUrl,
            isManualLogo: logoResults.isManualLogo,
            affiliateHomeUrl: affiliateHomeUrl,
            raw_data: JSON.parse(JSON.stringify(adv))
        };

        const result = await upsertAdvertiser(currentData, existingData);
        if (result.status === 'created') {
            syncState.Rakuten.advertisers.new++;
        } else {
            syncState.Rakuten.advertisers.checked++;
        }
        activeIds.add(result.id);
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await pruneStaleRecords('Rakuten', 'advertisers', Array.from(activeIds));
};

const syncRakutenCoupons = async () => {
    console.log('SYNC: Fetching Rakuten Coupons...');
    try {
        const rawCoupons = await rakutenService.fetchCoupons();
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
                advertiserId: String(coupon.advertiserId),
                network: 'Rakuten'
            });
            activeIds.add(result.id);
            const aid = String(coupon.advertiserId);
            const isExpired = coupon.endDate && new Date(coupon.endDate) < new Date();
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
    let processedCount = 0;
    const activeIds = new Set();
    const delayMs = 1500;
    for (const adv of advs) {
        processedCount++;
        const advId = adv.mid || adv.id;
        console.log(`[Rakuten] Processing products for advertiser ${processedCount}/${advs.length}: ${adv.name} (${advId})...`);
        try {
            const products = await rakutenService.fetchProducts(advId);
            if (!products || products.length === 0) continue;
            for (const p of products) {
                try {
                    const sku = p.sku || `${advId}-${p.name.substring(0, 20)}`;
                    const network = 'Rakuten';
                    const existingData = await getProduct(network, sku);
                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;
                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        storageImageUrl = await cacheImage(p.imageUrl, 'products/rakuten');
                    }
                    const productData = {
                        sku: sku,
                        network: network,
                        advertiserId: String(advId),
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
            const saleCount = products.reduce((acc, p) => {
                const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                return (s > 0 && pr > s) ? acc + 1 : acc;
            }, 0);
            await upsertAdvertiser({
                id: advId,
                network: 'Rakuten',
                productCount: products.length,
                saleProductCount: saleCount,
                hasSaleItems: saleCount > 0
            });
        } catch (e) {
            console.error(`[Rakuten] Error fetching/saving for ${adv.name}:`, e.message);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    await pruneStaleRecords('Rakuten', 'products', Array.from(activeIds));
};

// --- CJ ---
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
        const network = 'CJ';
        const existingData = await getAdvertiser(network, adv.id);
        const logoResults = await handleAdvertiserLogo(network, adv, existingData);
        const catResults = handleAdvertiserCategories(network, adv, existingData);

        const result = await upsertAdvertiser({
            id: adv.id,
            network: network,
            name: adv.name,
            status: adv.status || 'joined',
            url: adv.url || '',
            description: adv.description || null,
            categories: catResults.categories,
            isManualCategory: catResults.isManualCategory,
            country: adv.country || 'Unknown',
            logoUrl: logoResults.logoUrl,
            storageLogoUrl: logoResults.storageLogoUrl,
            isManualLogo: logoResults.isManualLogo,
            raw_data: JSON.parse(JSON.stringify(adv))
        }, existingData);
        activeIds.add(result.id);
        if (result.status === 'created') {
            syncState.CJ.advertisers.new++;
        } else {
            syncState.CJ.advertisers.checked++;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await pruneStaleRecords('CJ', 'advertisers', Array.from(activeIds));
};

const syncCJLinks = async () => {
    console.log('SYNC: Fetching CJ Links/Offers...');
    try {
        const rawOffers = await cjService.fetchOffers();
        const links = [...new Map(rawOffers.map(o => [o.link, o])).values()];
        const activeIds = new Set();
        const offerCountsMap = {};
        const hasCodesMap = {};
        for (const link of links) {
            const result = await upsertOffer({
                ...link,
                advertiserId: String(link.advertiserId),
                network: 'CJ'
            });
            activeIds.add(result.id);
            const aid = String(link.advertiserId);
            const isExpired = link.endDate && new Date(link.endDate) < new Date();
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
    console.log('SYNC: Fetching/Saving CJ Products...');
    try {
        const activeIds = new Set();
        const salesStats = {};
        const productCounts = {};
        const onPage = async (products, pageNum) => {
            for (const p of products) {
                try {
                    const sku = p.sku;
                    if (!sku) continue;
                    const aid = String(p.advertiserId);
                    productCounts[aid] = (productCounts[aid] || 0) + 1;
                    const existingData = await getProduct('CJ', sku);
                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;
                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        storageImageUrl = await cacheImage(p.imageUrl, 'products/cj');
                    }
                    const productData = {
                        ...p,
                        storageImageUrl: storageImageUrl,
                        searchKeywords: generateSearchKeywords(p.name)
                    };
                    const result = await upsertProduct(productData, existingData);
                    activeIds.add(result.id);
                    if (result.status === 'created') syncState.CJ.products.new++;
                    else syncState.CJ.products.checked++;
                    const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                    const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                    if (s > 0 && pr > s) salesStats[aid] = (salesStats[aid] || 0) + 1;
                } catch (err) {
                    console.error(`[CJ] Product err:`, err.message);
                }
            }
        };
        await cjService.fetchProducts(onPage);
        const advs = await cjService.fetchAdvertisers();
        for (const adv of advs) {
            const aid = String(adv.id);
            await upsertAdvertiser({
                id: adv.id,
                network: 'CJ',
                productCount: productCounts[aid] || 0,
                saleProductCount: salesStats[aid] || 0,
                hasSaleItems: (salesStats[aid] || 0) > 0
            });
        }
        await pruneStaleRecords('CJ', 'products', Array.from(activeIds));
    } catch (error) {
        console.error('SYNC: CJ products err:', error.message);
    }
};

// --- AWIN ---
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
        const network = 'AWIN';
        const existingData = await getAdvertiser(network, adv.id);
        const logoResults = await handleAdvertiserLogo(network, adv, existingData);
        const catResults = handleAdvertiserCategories(network, adv, existingData);

        const result = await upsertAdvertiser({
            id: adv.id,
            network: network,
            name: adv.name,
            status: adv.status || 'joined',
            url: adv.url || '',
            description: adv.description || null,
            categories: catResults.categories,
            isManualCategory: catResults.isManualCategory,
            country: adv.country || 'Unknown',
            logoUrl: logoResults.logoUrl,
            storageLogoUrl: logoResults.storageLogoUrl,
            isManualLogo: logoResults.isManualLogo,
            raw_data: JSON.parse(JSON.stringify(adv))
        }, existingData);
        activeIds.add(result.id);
        if (result.status === 'created') syncState.AWIN.advertisers.new++;
        else syncState.AWIN.advertisers.checked++;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    await pruneStaleRecords('AWIN', 'advertisers', Array.from(activeIds));
};

const syncAWINOffers = async () => {
    console.log('SYNC: Fetching AWIN Offers...');
    try {
        const rawOffers = await awinService.fetchOffers();
        const offers = [...new Map(rawOffers.map(o => [o.link, o])).values()];
        const activeIds = new Set();
        const offerCountsMap = {};
        const hasCodesMap = {};
        for (const offer of offers) {
            const result = await upsertOffer({
                ...offer,
                advertiserId: String(offer.advertiserId),
                network: 'AWIN'
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
                if (isRealCode(activeCode)) hasCodesMap[aid] = true;
            }
            if (result.status === 'created') syncState.AWIN.offers.new++;
            else syncState.AWIN.offers.checked++;
        }
        for (const [aid, count] of Object.entries(offerCountsMap)) {
            await upsertAdvertiser({
                id: aid,
                network: 'AWIN',
                offerCount: count,
                hasPromoCodes: hasCodesMap[aid] || false
            });
        }
        await pruneStaleRecords('AWIN', 'offers', Array.from(activeIds));
    } catch (e) {
        console.error('AWIN offers err:', e.message);
    }
};

const syncAWINProducts = async () => {
    console.log('SYNC: Fetching/Saving AWIN Products...');
    try {
        const advs = await awinService.fetchAdvertisers();
        const activeIds = new Set();
        const delayMs = 1500;
        let processed = 0;
        for (const adv of advs) {
            processed++;
            // console.log(`[AWIN] Products ${processed}/${advs.length}: ${adv.name}`); // Debug log
            const products = await awinService.fetchProducts(adv.id);
            if (!products || products.length === 0) continue;
            for (const p of products) {
                try {
                    const existingData = await getProduct('AWIN', p.sku);
                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;
                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        storageImageUrl = await cacheImage(p.imageUrl, 'products/awin');
                    }
                    const productData = {
                        ...p,
                        storageImageUrl: storageImageUrl,
                        searchKeywords: generateSearchKeywords(p.name)
                    };
                    const result = await upsertProduct(productData, existingData);
                    activeIds.add(result.id);
                    if (result.status === 'created') syncState.AWIN.products.new++;
                    else syncState.AWIN.products.checked++;
                } catch (err) {
                    console.error('AWIN prod save err:', err.message);
                }
            }
            const saleCount = products.reduce((acc, p) => {
                const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                return (s > 0 && pr > s) ? acc + 1 : acc;
            }, 0);
            await upsertAdvertiser({
                id: adv.id,
                network: 'AWIN',
                productCount: products.length,
                saleProductCount: saleCount,
                hasSaleItems: saleCount > 0
            });
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        await pruneStaleRecords('AWIN', 'products', Array.from(activeIds));
    } catch (e) {
        console.error('AWIN products err:', e.message);
    }
};

// --- PEPPERJAM ---
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
        const network = 'Pepperjam';
        const existingData = await getAdvertiser(network, adv.id);
        const logoResults = await handleAdvertiserLogo(network, adv, existingData);
        const catResults = handleAdvertiserCategories(network, adv, existingData);

        const result = await upsertAdvertiser({
            id: adv.id,
            network: network,
            name: adv.name,
            status: adv.status,
            url: adv.url || '',
            categories: catResults.categories,
            isManualCategory: catResults.isManualCategory,
            country: 'Unknown',
            description: adv.description || null,
            logoUrl: logoResults.logoUrl,
            storageLogoUrl: logoResults.storageLogoUrl,
            isManualLogo: logoResults.isManualLogo,
            raw_data: JSON.parse(JSON.stringify(adv))
        }, existingData);
        activeIds.add(result.id);
        if (result.status === 'created') syncState.Pepperjam.advertisers.new++;
        else syncState.Pepperjam.advertisers.checked++;
        await new Promise(resolve => setTimeout(resolve, 100));
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
            const result = await upsertOffer({ ...offer, network: 'Pepperjam' });
            activeIds.add(result.id);
            const aid = String(offer.advertiserId);
            const isExpired = offer.endDate && new Date(offer.endDate) < new Date();
            let activeCode = offer.code;
            if (!isRealCode(activeCode)) activeCode = extractCodeFromDescription(offer.description) || 'N/A';
            if (!isExpired) {
                offerCountsMap[aid] = (offerCountsMap[aid] || 0) + 1;
                if (isRealCode(activeCode)) hasCodesMap[aid] = true;
            }
            if (result.status === 'created') syncState.Pepperjam.offers.new++;
            else syncState.Pepperjam.offers.checked++;
        }
        for (const [aid, count] of Object.entries(offerCountsMap)) {
            await upsertAdvertiser({ id: aid, network: 'Pepperjam', offerCount: count, hasPromoCodes: hasCodesMap[aid] || false });
        }
        await pruneStaleRecords('Pepperjam', 'offers', Array.from(activeIds));
    } catch (e) {
        console.error('PJ offers err:', e.message);
    }
};

const syncPepperjamProducts = async () => {
    console.log('SYNC: Fetching Pepperjam Products...');
    const activeIds = new Set();
    const productCounts = {};
    const salesStats = {};
    try {
        await pepperjamService.fetchProducts(async (products, page) => {
            for (const p of products) {
                try {
                    const aid = String(p.advertiserId);
                    productCounts[aid] = (productCounts[aid] || 0) + 1;
                    const existingData = await getProduct('Pepperjam', p.sku);
                    let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                    const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;
                    if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                        storageImageUrl = await cacheImage(p.imageUrl, 'products/pepperjam');
                    }
                    const result = await upsertProduct({ ...p, storageImageUrl: storageImageUrl, searchKeywords: generateSearchKeywords(p.name) }, existingData);
                    activeIds.add(result.id);
                    if (result.status === 'created') syncState.Pepperjam.products.new++;
                    else syncState.Pepperjam.products.checked++;
                    const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                    const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                    if (s > 0 && pr > s) salesStats[aid] = (salesStats[aid] || 0) + 1;
                } catch (err) { }
            }
        });
        const advs = await pepperjamService.fetchAdvertisers();
        for (const adv of advs) {
            const aid = String(adv.id);
            await upsertAdvertiser({ id: adv.id, network: 'Pepperjam', productCount: productCounts[aid] || 0, saleProductCount: salesStats[aid] || 0, hasSaleItems: (salesStats[aid] || 0) > 0 });
        }
        await pruneStaleRecords('Pepperjam', 'products', Array.from(activeIds));
    } catch (e) { }
};

const syncAll = async () => {
    if (isGlobalSyncRunning) return;
    isGlobalSyncRunning = true;
    try {
        console.log('SYNC: Starting Global Full Sync...');

        // Phase 1: Advertisers
        syncState.Rakuten.status = 'running';
        await syncRakutenAdvertisers();
        syncState.CJ.status = 'running';
        await syncCJAdvertisers();
        syncState.AWIN.status = 'running';
        await syncAWINAdvertisers();
        syncState.Pepperjam.status = 'running';
        await syncPepperjamAdvertisers();

        // Phase 2: Offers
        await syncRakutenCoupons();
        await syncCJLinks();
        await syncAWINOffers();
        await syncPepperjamOffers();

        // Phase 3: Products
        await syncRakutenProducts();
        syncState.Rakuten.status = 'complete';

        await syncCJProducts();
        syncState.CJ.status = 'complete';

        await syncAWINProducts();
        syncState.AWIN.status = 'complete';

        await syncPepperjamProducts();
        syncState.Pepperjam.status = 'complete';

        await reconcileAllProductCounts();
        console.log('SYNC: Global Full Sync Complete.');
    } catch (e) {
        console.error('SYNC: Global Full Sync Failed:', e);
    } finally {
        isGlobalSyncRunning = false;
        // Ensure all statuses are reset if they didn't reach complete
        Object.keys(syncState).forEach(net => {
            if (syncState[net].status === 'running') syncState[net].status = 'complete';
        });
    }
};

module.exports = {
    syncAll,
    syncRakutenAll,
    syncCJAll,
    syncAWINAll,
    syncPepperjamAll,
    syncRakutenAdvertisers,
    syncCJAdvertisers,
    syncAWINAdvertisers,
    syncRakutenProducts,
    syncAWINProducts,
    syncCJProducts,
    syncRakutenCoupons,
    syncCJLinks,
    syncAWINOffers,
    syncPepperjamAdvertisers,
    syncPepperjamOffers,
    syncPepperjamProducts,
    getGlobalSyncState,
    getSyncHistory,
    recalculateAdvertiserCounts
};
