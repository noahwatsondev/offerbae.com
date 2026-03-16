const axios = require('axios');
const config = require('../config/env');

const fetchAdvertisers = async () => {
    if (!config.awin.accessToken || !config.awin.publisherId) {
        console.error('AWIN API credentials are missing.');
        return [];
    }

    try {
        console.log('Fetching AWIN programmes...');
        const response = await axios.get(
            `https://api.awin.com/publishers/${config.awin.publisherId}/programmes?relationship=joined`, {
            headers: {
                'Authorization': `Bearer ${config.awin.accessToken}`,
                'Accept': 'application/json'
            }
        }
        );

        const programmes = response.data;
        console.log(`AWIN Debug: Fetched ${programmes.length} programmes.`);
        if (programmes.length > 0) {
            // console.log('AWIN Raw Data Keys:', Object.keys(programmes[0]));
        } else {
            console.log('AWIN Debug: No programmes returned. Check scope or permissions.');
        }

        return programmes.map(p => ({
            id: p.id,
            name: p.name,
            network: 'AWIN',
            status: p.status,
            url: p.displayUrl,
            country: p.primaryRegion ? p.primaryRegion.countryCode : 'US',
            description: p.description || null,
            categories: p.primarySector ? [p.primarySector] : []
        }));

    } catch (error) {
        console.error('Error fetching AWIN advertisers:', error.message);
        return [];
    }
};

const fetchOffers = async () => {
    if (!config.awin.accessToken || !config.awin.publisherId) {
        console.error('AWIN API credentials are missing.');
        return [];
    }

    try {
        console.log('Fetching AWIN offers...');
        // Documentation: POST /publisher/{publisherId}/promotions
        const requestBody = {
            filters: {
                membership: "joined",
                type: "all"
            }
        };

        const response = await axios.post(
            `https://api.awin.com/publisher/${config.awin.publisherId}/promotions`,
            requestBody,
            {
                headers: {
                    'Authorization': `Bearer ${config.awin.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            }
        );

        // Debug logging
        // console.log('AWIN API Response:', JSON.stringify(response.data, null, 2));

        const offers = response.data;
        // Wait, standard AWIN pagination usually returns an object with `data` or similar.
        // But the docs "Response 200 OK application/json object Field name promotionId..." implies a single object description? No, "responses" section list fields of each item.
        // Actually AWIN new APIs often return array if no pagination wrapper, or { data: [], pagination: {} }.
        // Let's implement safe handling.

        let offersList = [];
        if (Array.isArray(offers)) {
            offersList = offers;
        } else if (offers && Array.isArray(offers.data)) {
            offersList = offers.data;
        } else {
            // If uncertain, log keys
            if (offers) console.log('AWIN Offers Response Keys:', Object.keys(offers || {}));
            return [];
        }
        console.log(`AWIN: Found ${offersList.length} offers.`);

        return offersList.map(offer => ({
            network: 'AWIN',
            advertiser: offer.advertiser ? offer.advertiser.name : 'Unknown',
            advertiserId: offer.advertiser ? offer.advertiser.id : null,
            description: offer.title + (offer.description ? ' - ' + offer.description : ''),
            code: (offer.type === 'voucher' && offer.voucher) ? offer.voucher.code : 'N/A',
            startDate: offer.startDate,
            endDate: offer.endDate,
            link: offer.urlTracking || offer.url,
            imageUrl: null // AWIN Promotions API does not typically provide an image URL for the offer itself
        }));

    } catch (error) {
        console.error('Error fetching AWIN offers:', error.message);
        return [];
    }
};

const zlib = require('zlib');
const csv = require('csv-parser');

const fetchProducts = async (advertiserId) => {
    const apikey = config.awin.datafeedApiKey;
    if (!apikey) {
        console.error('AWIN_DATAFEED_API_KEY is missing from environment variables.');
        return [];
    }

    try {
        // Step 1: Fetch the feed catalog to find the exact download URL for this advertiser
        const listUrl = `https://productdata.awin.com/datafeed/list/apikey/${apikey}`;
        const listRes = await axios.get(listUrl, { responseType: 'stream', timeout: 30000 });

        let feedUrl = null;
        await new Promise((resolve, reject) => {
            listRes.data.pipe(csv())
                .on('data', (row) => {
                    if (row['Advertiser ID'] === String(advertiserId)) {
                        feedUrl = row['URL'];
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        if (!feedUrl) {
            console.log(`AWIN: No product feed found for advertiser ${advertiserId}`);
            return [];
        }

        console.log(`AWIN: Fetching feed for ${advertiserId} from catalog URL...`);
        const feedRes = await axios({
            method: 'get',
            url: feedUrl,
            responseType: 'stream',
            timeout: 60000
        });

        let input = feedRes.data;
        if (feedRes.headers['content-encoding'] === 'gzip' || feedUrl.includes('gzip')) {
            console.log(`AWIN: Decompressing gzip stream for ${advertiserId}`);
            input = input.pipe(zlib.createGunzip());
        }

        const products = [];
        await new Promise((resolve, reject) => {
            input.pipe(csv())
                .on('data', (row) => {
                    if (row.aw_product_id && row.product_name) {
                        products.push({
                            network: 'AWIN',
                            advertiserId: String(advertiserId),
                            name: row.product_name,
                            price: row.search_price,
                            salePrice: row.store_price !== row.search_price ? row.store_price : null,
                            currency: row.currency || 'USD',
                            sku: row.aw_product_id || row.merchant_product_id,
                            link: row.aw_deep_link,
                            imageUrl: row.merchant_image_url || row.aw_image_url,
                            description: row.description || row.product_short_description || ''
                        });
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`AWIN: Fetched ${products.length} products for ${advertiserId}`);
        return products;

    } catch (error) {
        console.error(`Error fetching AWIN products for ${advertiserId}:`, error.message);
        return [];
    }
};

const fetchProductsForAll = async (advertisers) => {
    console.log(`Starting AWIN product fetch for ${advertisers.length} advertisers...`);
    const productsByAdvertiser = {};
    // Rate limit: 5 requests per minute = 1 req / 12 seconds.
    const delayMs = 12500; // 12.5s to be safe

    for (let i = 0; i < advertisers.length; i++) {
        const adv = advertisers[i];
        if (adv.network === 'AWIN') {
            console.log(`Fetching AWIN products for ${adv.name} (${i + 1}/${advertisers.length})...`);
            const prods = await fetchProducts(adv.id);
            if (prods.length > 0) {
                productsByAdvertiser[adv.id] = prods;
            }

            // Wait if not the last one
            if (i < advertisers.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    console.log('AWIN product fetch complete.');
    return productsByAdvertiser;
};

module.exports = {
    fetchAdvertisers,
    fetchOffers,
    fetchProducts,
    fetchProductsForAll
};
