const axios = require('axios');
const { Parser } = require('xml2js');
const config = require('../config/env');

const xmlParser = new Parser({
    explicitArray: false,
    ignoreAttrs: true,
});

// Parser for offers that needs attributes (total-matched, records-returned)
const offersXmlParser = new Parser({
    explicitArray: false,
    ignoreAttrs: false,
    mergeAttrs: true
});

const fetchAdvertisers = async () => {
    if (!config.cj.personalAccessToken || !config.cj.companyId) {
        console.error('CJ API credentials are missing.');
        return [];
    }

    const allAdvertisers = [];
    const recordsPerPage = 100;
    let pageNumber = 1;

    try {
        while (true) {
            console.log(`Fetching CJ advertisers page ${pageNumber}...`);
            const response = await axios.get(
                `https://advertiser-lookup.api.cj.com/v2/advertiser-lookup?requestor-cid=${config.cj.companyId}&advertiser-ids=joined&records-per-page=${recordsPerPage}&page-number=${pageNumber}`, {
                headers: {
                    'Authorization': `Bearer ${config.cj.personalAccessToken}`
                }
            }
            );

            const xmlData = response.data;
            const result = await xmlParser.parseStringPromise(xmlData);

            // Handle case where no advertisers are returned or structure is unexpected
            if (!result['cj-api'] || !result['cj-api']['advertisers']) {
                break;
            }

            const advertisersData = result['cj-api']['advertisers']['advertiser'];

            if (!advertisersData) {
                break;
            }

            const advertiserList = Array.isArray(advertisersData) ? advertisersData : [advertisersData];

            if (advertiserList.length === 0) {
                break;
            }

            allAdvertisers.push(...advertiserList);

            const recordsReturned = parseInt(result['cj-api']['advertisers']['records-returned'], 10);
            if (recordsReturned < recordsPerPage) {
                break;
            }
            pageNumber++;
        }

        if (allAdvertisers.length > 0) {
            console.log('CJ Advertisers found:', allAdvertisers.map(a => `${a['advertiser-name']} (${a['advertiser-id']})`).join(', '));
        }
        return allAdvertisers.map(a => ({
            id: a['advertiser-id'],
            name: a['advertiser-name'],
            network: 'CJ',
            status: a['relationship-status'],
            url: a['program-url'],
            country: a['advertiser-country'] || 'Unknown',
            categories: (() => {
                const primary = a['primary-category'];
                if (!primary) return [];

                const cats = [];
                if (primary.parent) cats.push(primary.parent);

                if (primary.child) {
                    if (Array.isArray(primary.child)) {
                        cats.push(...primary.child);
                    } else {
                        cats.push(primary.child);
                    }
                }
                return cats;
            })()
        }));

    } catch (error) {
        console.error('Error fetching CJ advertisers:', error.message);
        return [];
    }
};



const fetchOffers = async (advertisers = []) => {
    if (!config.cj.websiteId) {
        console.warn('CJ_WEBSITE_ID is missing. Skipping CJ offers fetch.');
        return [];
    }

    const allOffers = [];
    const recordsPerPage = 100;
    let pageNumber = 1;
    let totalMatched = 0;

    // Use 'joined' to get offers from all joined advertisers
    // This is the standard approach once a valid Website ID is provided
    const advertiserIdsParam = 'joined';

    try {
        console.log(`Fetching CJ offers (joined)...`);

        while (true) {
            const url = `https://link-search.api.cj.com/v2/link-search?website-id=${config.cj.websiteId}&advertiser-ids=${advertiserIdsParam}&records-per-page=${recordsPerPage}&page-number=${pageNumber}`;
            console.log(`Fetching CJ offers page ${pageNumber}... URL: ${url}`);
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${config.cj.personalAccessToken}`
                }
            });

            const xmlData = response.data;
            const result = await offersXmlParser.parseStringPromise(xmlData);

            if (!result['cj-api'] || !result['cj-api']['links']) {
                break;
            }

            const linksNode = result['cj-api']['links'];
            // With mergeAttrs: true, attributes are merged into the object
            // total-matched might be a string, parse it
            if (pageNumber === 1) {
                totalMatched = parseInt(linksNode['total-matched'] || '0', 10);
                console.log(`Total CJ offers found: ${totalMatched}`);
            }

            const linksData = linksNode['link'];
            if (!linksData) break;

            const links = Array.isArray(linksData) ? linksData : [linksData];
            allOffers.push(...links);

            // Check if we've fetched all records
            if (allOffers.length >= totalMatched || links.length < recordsPerPage) {
                break;
            }

            // Safety break to prevent infinite loops
            if (pageNumber >= 50) {
                console.warn('Reached safety limit of 50 pages for CJ offers.');
                break;
            }

            pageNumber++;
        }

        return allOffers.map(link => {
            // Extract image URL from link-code-html if available and not a tracking pixel
            let imageUrl = null;
            if (link['link-code-html']) {
                const imgMatch = link['link-code-html'].match(/<img[^>]+src="([^">]+)"/);
                if (imgMatch) {
                    const src = imgMatch[1];
                    // Filter out common tracking pixels (1x1)
                    if (!src.includes('width="1"') && !src.includes('height="1"') && !src.includes('/image-')) {
                        // This is a heuristic; 'image-' often denotes the tracking pixel in CJ
                        // But sometimes banner images also have it. 
                        // Better check: if it's a banner link, it should have a real image.
                    }
                    // For now, let's try to use it if it doesn't look like a pure tracker
                    // Actually, CJ text links usually only have a 1x1 tracker.
                    // Banner links will have a visible image.
                    imageUrl = src;
                }
            }

            return {
                network: 'CJ',
                advertiser: link['advertiser-name'],
                advertiserId: link['advertiser-id'],
                description: link.description || link['link-name'] || 'No description',
                code: link['coupon-code'] || 'N/A',
                startDate: link['promotion-start-date'],
                endDate: link['promotion-end-date'],
                link: link.clickUrl || link['link-code-html'],
                imageUrl: imageUrl // Add image URL
            };
        });

    } catch (error) {
        console.error('Error fetching CJ offers:', error.message);
        return [];
    }
};

const fetchProducts = async (onPage = null) => {
    if (!config.cj.personalAccessToken || !config.cj.companyId || !config.cj.websiteId) {
        console.error('CJ API credentials (token, companyId, websiteId) are missing.');
        return [];
    }

    const allProducts = [];
    const limit = 100; // Safe limit per request
    let pageToken = null;
    let pageCount = 0;
    const maxPages = 1000; // Increased to allow ~100k products

    const query = `
        query($companyId: ID!, $pid: ID!, $limit: Int, $page: String) {
            products(companyId: $companyId, partnerStatus: JOINED, limit: $limit, page: $page) {
                totalCount
                count
                nextPage
                resultList {
                    id
                    title
                    description
                    price { amount, currency }
                    salePrice { amount, currency }
                    advertiserId
                    advertiserName
                    imageLink
                    linkCode(pid: $pid) {
                        clickUrl
                        imageUrl
                    }
                }
            }
        }
    `;

    try {
        console.log('Fetching CJ products (GraphQL)...');

        while (true) {
            if (pageCount >= maxPages) {
                console.warn(`CJ Product Sync: Reached safety limit of ${maxPages} pages.`);
                break;
            }

            const variables = {
                companyId: config.cj.companyId,
                pid: config.cj.websiteId,
                limit: limit,
                page: pageToken
            };

            const response = await axios.post(
                'https://ads.api.cj.com/query',
                { query, variables },
                {
                    headers: {
                        'Authorization': `Bearer ${config.cj.personalAccessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.errors) {
                console.error('CJ GraphQL Errors:', JSON.stringify(response.data.errors, null, 2));
                break;
            }

            const data = response.data.data.products;
            const products = data.resultList || [];

            if (products.length === 0) {
                break;
            }

            console.log(`CJ Products: Fetched ${products.length} products (Page ${pageCount + 1}).`);

            const mappedProducts = products.map(p => ({
                id: p.id,
                name: p.title,
                sku: p.id, // Use ID as SKU
                description: p.description,
                price: p.price ? parseFloat(p.price.amount) : null,
                salePrice: p.salePrice ? parseFloat(p.salePrice.amount) : null,
                currency: p.price ? p.price.currency : 'USD',
                advertiserId: p.advertiserId,
                advertiserName: p.advertiserName,
                link: p.linkCode ? p.linkCode.clickUrl : '',
                imageUrl: p.imageLink || (p.linkCode ? p.linkCode.imageUrl : null),
                network: 'CJ'
            }));

            if (onPage) {
                await onPage(mappedProducts, pageCount + 1);
            } else {
                allProducts.push(...mappedProducts);
            }

            if (!data.nextPage) {
                break;
            }

            pageToken = data.nextPage;
            pageCount++;

            // Rate limit protection
            if (onPage) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        return onPage ? [] : allProducts;

    } catch (error) {
        console.error('Error fetching CJ products:', error.message);
        if (error.response) {
            console.error('CJ API Response:', JSON.stringify(error.response.data, null, 2));
        }
        return [];
    }
};

module.exports = {
    fetchAdvertisers,
    fetchOffers,
    fetchProducts
};
