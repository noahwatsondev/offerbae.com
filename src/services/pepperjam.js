const axios = require('axios');
const config = require('../config/env');

const BASE_URL = 'https://api.pepperjamnetwork.com/20120402/publisher';

const fetchAdvertisers = async () => {
    if (!config.pepperjam.apiKey) {
        console.error('Pepperjam API key is missing.');
        return [];
    }

    const allAdvertisers = [];
    let page = 1;

    try {
        while (true) {
            console.log(`Fetching Pepperjam advertisers page ${page}...`);
            const response = await axios.get(`${BASE_URL}/advertiser`, {
                params: {
                    apiKey: config.pepperjam.apiKey,
                    format: 'json',
                    page: page,
                    status: 'joined'
                }
            });

            const data = response.data;
            if (!data || !data.data || data.data.length === 0) {
                break;
            }

            allAdvertisers.push(...data.data);

            // Check if there is a next page
            if (!data.meta || !data.meta.pagination || !data.meta.pagination.next) {
                break;
            }
            page++;
        }

        return allAdvertisers.map(a => ({
            id: String(a.id),
            name: a.name,
            network: 'Pepperjam',
            status: a.status,
            url: a.website,
            country: 'Unknown', // Pepperjam doesn't always provide this in the basic list
            categories: a.categories ? a.categories.map(c => c.name) : []
        }));

    } catch (error) {
        console.error('Error fetching Pepperjam advertisers:', error.message);
        return [];
    }
};

const fetchOffers = async () => {
    if (!config.pepperjam.apiKey) return [];

    const allOffers = [];
    let page = 1;

    try {
        while (true) {
            console.log(`Fetching Pepperjam coupon offers page ${page}...`);
            const response = await axios.get(`${BASE_URL}/creative/coupon`, {
                params: {
                    apiKey: config.pepperjam.apiKey,
                    format: 'json',
                    page: page
                }
            });

            const data = response.data;
            if (!data || !data.data || data.data.length === 0) {
                break;
            }

            allOffers.push(...data.data);

            if (!data.meta || !data.meta.pagination || !data.meta.pagination.next) {
                break;
            }
            page++;
        }

        return allOffers.map(o => ({
            network: 'Pepperjam',
            advertiser: o.program_name,
            advertiserId: String(o.program_id),
            description: o.description || o.name || 'No description',
            code: (o.coupon && o.coupon !== 'No Code Necessary') ? o.coupon : 'N/A',
            startDate: o.start_date,
            endDate: o.end_date,
            link: o.code, // Tracking URL is in 'code' field for coupons
            imageUrl: null
        }));

    } catch (error) {
        console.error('Error fetching Pepperjam offers:', error.message);
        return [];
    }
};

const fetchProducts = async (onPage = null) => {
    if (!config.pepperjam.apiKey) return [];

    const allProducts = [];
    let page = 1;
    const maxPages = 100; // Safety limit for product sync

    try {
        while (true) {
            if (page > maxPages) break;

            console.log(`Fetching Pepperjam products page ${page}...`);
            const response = await axios.get(`${BASE_URL}/creative/product`, {
                params: {
                    apiKey: config.pepperjam.apiKey,
                    format: 'json',
                    page: page
                }
            });

            const data = response.data;
            if (!data || !data.data || data.data.length === 0) {
                break;
            }

            const mappedProducts = data.data.map(p => ({
                id: String(p.id),
                name: p.name,
                sku: String(p.sku || p.id),
                description: p.description_long || p.description_short || p.name,
                price: parseFloat(p.price) || null,
                salePrice: parseFloat(p.price_sale) || null,
                currency: 'USD', // PJ products are mostly USD unless otherwise noted
                advertiserId: String(p.program_id),
                advertiserName: p.program_name,
                link: p.buy_url,
                imageUrl: p.image_url,
                network: 'Pepperjam'
            }));

            if (onPage) {
                await onPage(mappedProducts, page);
            } else {
                allProducts.push(...mappedProducts);
            }

            if (!data.meta || !data.meta.pagination || !data.meta.pagination.next) {
                break;
            }
            page++;

            // Rate limit protection
            if (onPage) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        return onPage ? [] : allProducts;

    } catch (error) {
        console.error('Error fetching Pepperjam products:', error.message);
        return [];
    }
};

module.exports = {
    fetchAdvertisers,
    fetchOffers,
    fetchProducts
};
