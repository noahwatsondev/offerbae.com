const axios = require('axios');
const btoa = require('btoa');
const { Parser } = require('xml2js');
const config = require('../config/env');

const xmlParser = new Parser({
    explicitArray: false,
    ignoreAttrs: true,
});

let rakuTokenCache = { value: null, expires: 0 };

const getRakutenToken = async () => {
    if (rakuTokenCache.value && Date.now() < rakuTokenCache.expires) {
        return rakuTokenCache.value;
    }

    if (!config.rakuten.clientId || !config.rakuten.clientSecret || !config.rakuten.siteId) {
        throw new Error('Rakuten API credentials are missing.');
    }

    try {
        const tokenKey = btoa(`${config.rakuten.clientId}:${config.rakuten.clientSecret}`);
        const response = await axios.post(
            'https://api.linksynergy.com/token',
            `scope=${config.rakuten.siteId}`,
            {
                headers: {
                    'Authorization': `Bearer ${tokenKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        if (!response.data || !response.data.access_token) {
            throw new Error('Rakuten token response missing access_token');
        }

        rakuTokenCache.value = response.data.access_token;
        rakuTokenCache.expires = Date.now() + (3300 * 1000); // Cache for 55 mins

        // Add console.log to inspect raw data for token response
        if (response.data) {
            // console.log('Rakuten Token Raw Data Keys:', Object.keys(response.data));
        }

        return response.data.access_token;
    } catch (error) {
        console.error('Error fetching Rakuten token:', error.message);
        throw error;
    }
};

const fetchAdvertisers = async () => {
    try {
        const token = await getRakutenToken();
        const allPartnerships = [];
        let page = 1;
        const limit = 200; // Max limit

        // Step 1: Fetch all partnerships
        while (true) {
            console.log(`Fetching Rakuten partnerships page ${page}...`);
            const response = await axios.get(
                `https://api.linksynergy.com/v1/partnerships?partner_status=active&limit=${limit}&page=${page}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            }
            );

            const partnerships = response.data.partnerships;
            if (!partnerships || partnerships.length === 0) {
                break;
            }

            if (page === 1 && partnerships.length > 0) {
                // console.log('Rakuten Partnerships Raw Data Keys (first item):', Object.keys(partnerships[0]));
            }

            allPartnerships.push(...partnerships);
            page++;

            const totalPages = Math.ceil(response.data._metadata.total / limit);
            if (page > totalPages) {
                break;
            }
        }

        // Step 2: Fetch detailed advertiser info for each partnership to get correct URLs
        console.log(`Fetching detailed info for ${allPartnerships.length} Rakuten advertisers...`);
        const advertiserDetails = await Promise.all(
            allPartnerships.map(async (p, index) => {
                try {
                    const advResponse = await axios.get(
                        `https://api.linksynergy.com/v2/advertisers/${p.advertiser.id}`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/json'
                        }
                    });
                    if (index === 0) {
                        // console.log('Rakuten Advertiser Details Raw Data Keys:', Object.keys(advResponse.data));
                    }
                    return advResponse.data;
                } catch (error) {
                    console.error(`Failed to fetch details for advertiser ${p.advertiser.id}:`, error.message);
                    return null;
                }
            })
        );

        // Step 3: Combine partnership data with detailed advertiser info
        return allPartnerships.map((p, index) => {
            const details = advertiserDetails[index];
            return {
                id: p.advertiser.id,
                name: p.advertiser.name,
                network: 'Rakuten',
                status: p.status,
                url: details?.advertiser?.url || p.advertiser.url || null, // Access nested advertiser.url
                country: details?.advertiser?.contact?.country || 'Unknown',
                description: details?.advertiser?.description || details?.advertiser?.shortDescription || details?.advertiser?.longDescription || null,
                categories: p.advertiser.categories || []
            };
        });

    } catch (error) {
        console.error('Error fetching Rakuten partnerships:', error.message);
        return [];
    }
};



const getValue = (obj, keys) => {
    if (!obj) return null;
    const lowerKeys = keys.map(k => k.toLowerCase());
    for (const key of Object.keys(obj)) {
        if (lowerKeys.includes(key.toLowerCase())) {
            const val = obj[key];
            return Array.isArray(val) && val.length === 1 ? val[0] : val;
        }
    }
    return null;
};

const fetchCoupons = async () => {
    try {
        const token = await getRakutenToken();
        console.log('Fetching Rakuten coupons...');
        const response = await axios.get(
            'https://api.linksynergy.com/coupon/1.0', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }
        );

        const xmlData = response.data;
        const result = await xmlParser.parseStringPromise(xmlData);

        // Robustly find couponFeed
        const feed = getValue(result, ['couponfeed', 'couponFeed']);

        if (!feed) {
            console.log('Rakuten: No coupon feed found in response.');
            if (result) console.log('Rakuten Available Keys:', Object.keys(result));
            return [];
        }

        // Robustly find coupons list
        const couponsData = getValue(feed, ['coupon', 'link']); // 'link' is a common alternative in Rakuten feeds

        if (!couponsData) {
            console.log('Rakuten: No coupons/links found in feed.');
            return [];
        }

        const coupons = Array.isArray(couponsData) ? couponsData : [couponsData];

        return coupons.map(coupon => ({
            network: 'Rakuten',
            advertiser: getValue(coupon, ['advertisername', 'advertiser_name']) || 'Unknown',
            advertiserId: getValue(coupon, ['advertiserid', 'mid']),
            description: getValue(coupon, ['offerdescription', 'description', 'text']),
            code: getValue(coupon, ['couponcode', 'code']) || 'N/A',
            startDate: getValue(coupon, ['offerstartdate', 'start_date', 'begin_date']),
            endDate: getValue(coupon, ['offerenddate', 'end_date']),
            link: getValue(coupon, ['clickurl', 'link_url', 'click_url']),
            imageUrl: getValue(coupon, ['couponimageurl', 'offerimageurl', 'image_url']) || null
        }));

    } catch (error) {
        console.error('Error fetching Rakuten coupons:', error.message);
        return [];
    }
};

const fetchProducts = async (advertiserId) => {
    try {
        const token = await getRakutenToken();

        const allItems = [];
        let page = 1;
        const maxPerPage = 100; // Rakuten max usually around 100

        while (true) {
            // Fetch products per page
            const response = await axios.get(
                `https://api.linksynergy.com/productsearch/1.0?mid=${advertiserId}&max=${maxPerPage}&page=${page}`,
                {
                    headers: { 'Authorization': `Bearer ${token}` }
                }
            );

            const result = await xmlParser.parseStringPromise(response.data);
            const root = result.result || result.productSearchResponse || result.ProductSearchResponse;

            if (!root) break;

            const itemsData = root.item;
            if (!itemsData) break;

            const items = Array.isArray(itemsData) ? itemsData : [itemsData];

            if (items.length === 0) break;

            allItems.push(...items);

            if (items.length < maxPerPage) break;

            page++;
            // Safety break to prevent infinite loops if API misbehaves
            if (page > 100) break;

            // Rate Limit Protection: Delay between pages
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        return allItems.map(item => ({
            network: 'Rakuten',
            advertiserId: getValue(item, ['mid']),
            name: getValue(item, ['productname', 'product_name']),
            sku: getValue(item, ['sku']),
            price: item.price ? (item.price._ || item.price) : null,
            salePrice: item.saleprice ? (item.saleprice._ || item.saleprice) : null,
            currency: item.price && item.price.$ ? item.price.$.currency : 'USD',
            description: item.description ? (item.description.short || item.description.long) : null,
            link: getValue(item, ['linkurl', 'link_url']),
            imageUrl: getValue(item, ['imageurl', 'image_url'])
        }));

    } catch (error) {
        // Log generic error but don't spam console if it's just no products or 404
        console.error(`Error fetching Rakuten products for ${advertiserId}:`, error.message);
        return [];
    }
};

const fetchProductsForAll = async (advertisers) => {
    console.log(`Starting Rakuten product fetch for ${advertisers.length} advertisers...`);
    const productsByAdvertiser = {};
    const chunkSize = 1; // Fetch 1 at a time (Sequential to avoid rate limits)
    const delayMs = 1500; // 1.5s delay -> ~200 calls/min safe if purely sequential, but since we parallelize 5, it's 5 calls every 1.5s+latency.
    // 5 calls / 1.5s = ~3.3 calls/sec = ~200 calls/min.
    // Limit is 100 calls/min. So we need to be slower.
    // 5 calls every 3 seconds = 100 calls/min. 
    // Let's do 5 calls every 3.5 seconds to be safe.

    const safeDelayMs = 3500;

    for (let i = 0; i < advertisers.length; i += chunkSize) {
        const chunk = advertisers.slice(i, i + chunkSize);
        console.log(`Processing Rakuten product chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(advertisers.length / chunkSize)}...`);

        await Promise.all(chunk.map(async (adv) => {
            if (adv.network === 'Rakuten') {
                const prods = await fetchProducts(adv.id);
                if (prods.length > 0) {
                    productsByAdvertiser[adv.id] = prods;
                }
            }
        }));

        if (i + chunkSize < advertisers.length) {
            await new Promise(resolve => setTimeout(resolve, safeDelayMs));
        }
    }
    console.log('Rakuten product fetch complete.');
    return productsByAdvertiser;
};

const generateDeepLink = async (advertiserId, url) => {
    try {
        const token = await getRakutenToken();
        const response = await axios.post(
            'https://api.linksynergy.com/v1/links/deep_links',
            {
                url: url,
                advertiser_id: advertiserId
            },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        // Response format: { _metadata: {}, advertiser: { deep_link: { deep_link_url: "..." } } }
        return response.data?.advertiser?.deep_link?.deep_link_url || null;
    } catch (error) {
        // Log error but don't throw, just return null so sync continues
        // console.error(`Error generating deep link for adv ${advertiserId}:`, error.message);
        return null;
    }
};

const generateDeepLinksForAll = async (advertisers) => {
    console.log(`Generating Rakuten deep links for ${advertisers.length} advertisers...`);
    const deepLinks = {};
    const chunkSize = 5;
    const delayMs = 1500; // ~4 calls/sec max allowed? No, 100/min = ~1.6/sec. 
    // We should be strictly slower than 1.6/sec.
    // If we process 1 at a time with 600ms delay, that's ~100/min.
    // Let's do 1 at a time to be safe and simple.

    // Actually, let's just loop with a delay.
    for (let i = 0; i < advertisers.length; i++) {
        const adv = advertisers[i];
        if (adv.network !== 'Rakuten' || !adv.url) continue;

        const deepLink = await generateDeepLink(adv.id, adv.url);
        if (deepLink) {
            deepLinks[adv.id] = deepLink;
        }

        // Delay to respect 100 calls/minute limit (600ms per call minimum)
        // Using 750ms to be safe
        if (i < advertisers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 750));
        }
    }

    console.log('Rakuten deep link generation complete.');
    return deepLinks;
};

module.exports = {
    fetchAdvertisers,
    fetchCoupons,
    fetchProducts,
    fetchProductsForAll,
    generateDeepLink,
    generateDeepLinksForAll
};
