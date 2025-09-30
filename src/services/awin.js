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

const readline = require('readline');
const stream = require('stream');
const zlib = require('zlib');

const fetchProducts = async (advertiserId, regionStr) => {
    // console.log(`DEBUG: fetchProducts called for ${advertiserId} with region ${regionStr}`);
    if (!config.awin.accessToken || !config.awin.publisherId) {
        return [];
    }

    // Determine locale - defaulting to en_US if uncertain, or try to map from region string if needed.
    // For now, hardcode en_US as primary, could be improved later.
    // Map region to locale
    let locale = 'en_US';
    if (regionStr === 'GB') locale = 'en_GB';
    else if (regionStr === 'US') locale = 'en_US';
    // Add more if needed
    const vertical = 'retail';

    // url: https://api.awin.com/publishers/{publisherId}/awinfeeds/download/{advertiserId}-{vertical}-{locale}
    // Curl example shows .jsonl extension, trying that.
    const url = `https://api.awin.com/publishers/${config.awin.publisherId}/awinfeeds/download/${advertiserId}-${vertical}-${locale}.jsonl`;

    try {
        console.log(`AWIN: Fetching feed for ${advertiserId} from ${url}`);
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            headers: {
                'Authorization': `Bearer ${config.awin.accessToken}`
            },
            timeout: 60000 // 60s timeout for stream
        });

        console.log(`AWIN: Response status for ${advertiserId}: ${response.status}`);
        // console.log(`AWIN: Headers:`, response.headers);

        let input = response.data;
        if (response.headers['content-encoding'] === 'gzip') {
            console.log(`AWIN: Decompressing gzip stream for ${advertiserId}`);
            input = input.pipe(zlib.createGunzip());
        }

        const products = [];
        const lines = readline.createInterface({
            input: input,
            crlfDelay: Infinity
        });

        let count = 0;
        const maxProducts = 200;

        for await (const line of lines) {
            if (!line.trim()) continue;
            // console.log(`DEBUG: Line from ${advertiserId}: ${line.substring(0, 100)}...`);
            try {
                const json = JSON.parse(line);
                // Check for error
                if (json.error) continue;

                if (json.id && json.title) {
                    products.push({
                        network: 'AWIN',
                        advertiserId: advertiserId,
                        name: json.title,
                        price: json.price,
                        salePrice: json.sale_price,
                        currency: json.currency || (json.price && json.price.split(' ')[1]) || 'USD',
                        sku: json.id,
                        link: json.link,
                        imageUrl: json.image_link,
                        description: json.description
                    });
                    count++;
                }

                // Removed limit cap to fetch all products as requested
                // if (count >= maxProducts) { ... }
            } catch (e) {
                // Ignore parse errors for partial lines
                console.log(`AWIN: Parse error line: ${line.substring(0, 50)}...`);
            }
        }

        console.log(`AWIN: Fetched ${products.length} products for ${advertiserId}`);

        // Clean up price string "15.00 GBP" to just "15.00" and extract currency
        return products.map(p => {
            if (p.price && typeof p.price === 'string' && p.price.includes(' ')) {
                const part = p.price.split(' ');
                p.price = part[0];
                p.currency = part[1];
            }
            if (p.salePrice && typeof p.salePrice === 'string' && p.salePrice.includes(' ')) {
                const part = p.salePrice.split(' ');
                p.salePrice = part[0];
            }
            return p;
        });

    } catch (error) {
        if (error.response && error.response.status === 404) {
        } else {
            console.error(`Error fetching AWIN products for ${advertiserId}:`, error.message);
        }
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
            const prods = await fetchProducts(adv.id, adv.country);
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
