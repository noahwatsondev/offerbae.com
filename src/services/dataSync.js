const brandfetch = require('./brandfetch');
const rakutenService = require('./rakuten');
const cjService = require('./cj');
const awinService = require('./awin');
const { upsertAdvertiser, upsertOffer, upsertProduct, getAdvertiser, getProduct, logSyncComplete, getSyncHistory, pruneStaleRecords } = require('./db');
const imageStore = require('./imageStore');

// Global Sync State
const syncState = {
    Rakuten: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } },
    CJ: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } },
    AWIN: { status: 'idle', advertisers: { checked: 0, new: 0 }, offers: { checked: 0, new: 0 }, products: { checked: 0, new: 0 } }
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

// Generic Sync Wrapper
const syncWithLog = async (network, syncFn) => {
    if (syncState[network].status === 'running') {
        console.log('SYNC: ' + network + ' already running. Skipping.');
        return;
    }
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
    }
};

const syncRakutenCoupons = async () => {
    console.log('SYNC: Fetching Rakuten Coupons...');
    try {
        const rawCoupons = await rakutenService.fetchCoupons();
        // Dedupe coupons based on link (or other uniqueness criteria)
        const coupons = [...new Map(rawCoupons.map(c => [c.link, c])).values()];
        const activeIds = new Set();

        for (const coupon of coupons) {
            const result = await upsertOffer({
                ...coupon,
                advertiserId: String(coupon.advertiserId), // Enforce String type
                network: 'Rakuten'
            });
            activeIds.add(result.id);

            if (result.status === 'created') {
                syncState.Rakuten.offers.new++;
            } else {
                syncState.Rakuten.offers.checked++;
            }
        }
        await pruneStaleRecords('Rakuten', 'offers', Array.from(activeIds));
    } catch (error) {
        console.error('SYNC: Error syncing Rakuten coupons:', error.message);
    }
};

const syncRakutenProducts = async (inputAdvs = null) => {
    console.log('SYNC: Fetching/Saving Rakuten Products...');
    const advs = inputAdvs || await rakutenService.fetchAdvertisers();
    const productsMap = await rakutenService.fetchProductsForAll(advs);

    const activeIds = new Set();
    for (const [advId, products] of Object.entries(productsMap)) {
        for (const p of products) {
            try {
                // ... (existing logic)
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
                    advertiserId: advId,
                    name: p.name || 'Unknown Product',
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
                console.error(`SYNC: Failed to save Rakuten product ${p.sku}:`, err.message);
            }
        }
    }
    // Update Advertiser Stats (Sale Counts)
    console.log('SYNC: Updating Rakuten Advertiser Stats...');
    for (const adv of advs) {
        const advId = adv.mid || adv.id;
        const products = productsMap[advId] || [];
        const saleCount = products.reduce((acc, p) => {
            const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
            const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
            return (s > 0 && pr > s) ? acc + 1 : acc;
        }, 0);

        try {
            await upsertAdvertiser({
                id: advId,
                network: 'Rakuten',
                saleProductCount: saleCount,
                hasSaleItems: saleCount > 0
            });
        } catch (err) {
            console.error(`SYNC: Failed to update stats for Rakuten adv ${advId}:`, err.message);
        }
    }

    await pruneStaleRecords('Rakuten', 'products', Array.from(activeIds));
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
        const offers = [...new Map(rawOffers.map(o => [o.link, o])).values()];
        const activeIds = new Set();

        for (const offer of offers) {
            const cleanOffer = JSON.parse(JSON.stringify(offer));
            const result = await upsertOffer({
                ...cleanOffer,
                advertiserId: String(cleanOffer.advertiserId), // Enforce String type
                network: 'CJ'
            });
            activeIds.add(result.id);

            if (result.status === 'created') {
                syncState.CJ.offers.new++;
            } else {
                syncState.CJ.offers.checked++;
            }
        }
        await pruneStaleRecords('CJ', 'offers', Array.from(activeIds));
    } catch (error) {
        console.error('SYNC: Error syncing CJ links:', error.message);
    }
};

const syncCJProducts = async () => {
    console.log('SYNC: Fetching/Saving CJ Products...');
    try {
        const advs = await cjService.fetchAdvertisers();
        const products = await cjService.fetchProducts();
        console.log(`SYNC: processing ${products.length} CJ products...`);

        const activeIds = new Set();
        for (const p of products) {
            try {
                const network = 'CJ';
                const existingData = await getProduct(network, p.sku);

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
                    sku: p.sku,
                    network: 'CJ',
                    advertiserId: String(p.advertiserId), // Enforce String
                    name: p.name || 'Unknown Product',
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
            } catch (err) {
                console.error(`SYNC: Failed to save CJ product ${p.sku}:`, err.message);
            }
        }
        // Update Advertiser Stats
        console.log('SYNC: Updating CJ Advertiser Stats...');
        // Group products by advertiser
        const productsByAdv = {};
        products.forEach(p => {
            const aid = String(p.advertiserId);
            if (!productsByAdv[aid]) productsByAdv[aid] = [];
            productsByAdv[aid].push(p);
        });

        for (const adv of advs) {
            const products = productsByAdv[String(adv.id)] || [];
            const saleCount = products.reduce((acc, p) => {
                const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
                const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
                return (s > 0 && pr > s) ? acc + 1 : acc;
            }, 0);

            try {
                await upsertAdvertiser({
                    id: adv.id,
                    network: 'CJ',
                    saleProductCount: saleCount,
                    hasSaleItems: saleCount > 0
                });
            } catch (err) {
                console.error(`SYNC: Failed to update stats for CJ adv ${adv.id}:`, err.message);
            }
        }

        await pruneStaleRecords('CJ', 'products', Array.from(activeIds));
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

    for (const offer of offers) {
        try {
            const cleanOffer = JSON.parse(JSON.stringify(offer));
            const result = await upsertOffer({
                ...cleanOffer,
                advertiserId: String(cleanOffer.advertiserId), // Enforce String type for ID matching
                network: 'AWIN'
            });
            activeIds.add(result.id);

            if (result.status === 'created') {
                syncState.AWIN.offers.new++;
            } else {
                syncState.AWIN.offers.checked++;
            }
        } catch (err) {
            console.error(`SYNC: Failed to save AWIN offer:`, err.message);
        }
    }
    await pruneStaleRecords('AWIN', 'offers', Array.from(activeIds));
};

const syncAWINProducts = async (inputAdvs = null) => {
    console.log('SYNC: Fetching/Saving AWIN Products...');
    const advs = inputAdvs || await awinService.fetchAdvertisers();
    const productsMap = await awinService.fetchProductsForAll(advs);

    const activeIds = new Set();
    for (const [advId, products] of Object.entries(productsMap)) {
        for (const p of products) {
            try {
                // ... (fields)
                const sku = p.sku;
                const network = 'AWIN';
                let existingData = null;
                if (p.sku) {
                    existingData = await getProduct(network, p.sku);
                }

                let storageImageUrl = existingData ? existingData.storageImageUrl : null;
                const imageChanged = !existingData || existingData.imageUrl !== p.imageUrl;

                if (p.imageUrl && (imageChanged || !storageImageUrl)) {
                    storageImageUrl = await cacheImage(p.imageUrl, 'products/awin');
                }

                const productData = {
                    sku: p.sku || `AWIN-${advId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                    network: 'AWIN',
                    advertiserId: advId,
                    name: p.name || 'Unknown Product',
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
                // Stats: Check if new
                if (result.isNew) {
                    syncState.AWIN.products.new++;
                }
                syncState.AWIN.products.checked++;
            } catch (err) {
                console.error(`SYNC: Failed to save AWIN product ${p.sku}:`, err.message);
            }
        }
    }
    // Update Advertiser Stats
    console.log('SYNC: Updating AWIN Advertiser Stats...');
    for (const adv of advs) {
        const products = productsMap[adv.id] || [];
        const saleCount = products.reduce((acc, p) => {
            const s = parseFloat(String(p.salePrice).replace(/[^0-9.-]+/g, "")) || 0;
            const pr = parseFloat(String(p.price).replace(/[^0-9.-]+/g, "")) || 0;
            return (s > 0 && pr > s) ? acc + 1 : acc;
        }, 0);

        try {
            await upsertAdvertiser({
                id: adv.id,
                network: 'AWIN',
                saleProductCount: saleCount,
                hasSaleItems: saleCount > 0
            });
        } catch (err) {
            console.error(`SYNC: Failed to update stats for AWIN adv ${adv.id}:`, err.message);
        }
    }

    await pruneStaleRecords('AWIN', 'products', Array.from(activeIds));
};

const syncAdvertisers = async () => {
    console.log('SYNC: Starting Advertiser Sync (Parallel)...');
    await Promise.allSettled([
        syncRakutenAdvertisers().catch(e => console.error('Rakuten Advertiser Sync Failed:', e.message)),
        syncCJAdvertisers().catch(e => console.error('CJ Advertiser Sync Failed:', e.message)),
        syncAWINAdvertisers().catch(e => console.error('AWIN Advertiser Sync Failed:', e.message))
    ]);
};

const syncOffers = async () => {
    console.log('SYNC: Starting Offer/Link Sync (Parallel)...');
    await Promise.allSettled([
        syncRakutenCoupons().catch(e => console.error('Rakuten Coupon Sync Failed:', e.message)),
        syncCJLinks().catch(e => console.error('CJ Link Sync Failed:', e.message)),
        syncAWINOffers().catch(e => console.error('AWIN Offer Sync Failed:', e.message))
    ]);
};

const syncProducts = async () => {
    console.log('SYNC: Starting Product Sync (Parallel)...');
    await Promise.allSettled([
        syncRakutenProducts().catch(e => console.error('Rakuten Product Sync Failed:', e.message)),
        syncCJProducts().catch(e => console.error('CJ Product Sync Failed:', e.message)),
        syncAWINProducts().catch(e => console.error('AWIN Product Sync Failed:', e.message))
    ]);
};

const syncAll = async () => {
    console.log('SYNC: Starting Full Sync...');
    const startTime = Date.now();
    await syncAdvertisers();
    await syncOffers();
    await syncProducts();
    const duration = (Date.now() - startTime) / 1000;
    console.log(`SYNC: Full Sync Complete in ${duration}s.`);
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
    getGlobalSyncState,
    getSyncHistory
};
