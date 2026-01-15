const firebaseConfig = require('../config/firebase');

const slugify = (text) => {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
};

const getCatalogPage = async (req, res) => {
    try {
        const db = firebaseConfig.db;
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const offset = (page - 1) * limit;

        // 1. Try to find a Brand matching this slug
        const brandSnap = await db.collection('advertisers')
            .where('slug', '==', slug)
            .limit(1)
            .get();

        if (!brandSnap.empty) {
            const brand = brandSnap.docs[0].data();
            if (brand.manualDescription) {
                brand.description = brand.manualDescription;
            }
            return renderCatalog(req, res, {
                type: 'brand',
                data: brand,
                title: `${brand.name} Products, Coupons & Deals`,
                description: `Shop the latest products and find exclusive promo codes and deals for ${brand.name} on Offerbae.`
            });
        }

        // 2. Try to find if this is a Category -- DISABLED TEMPORARILY
        // We look for any brand that has this category (slugified)
        // Since we don't store a separate categories collection, we'll check against a set of known categories 
        // derived from the advertisers. To be efficient, we'd ideally have a categories collection.
        // For now, let's look for any advertiser where the categories list contains something that slugifies to this.

        /* 
        // Find brands in this category
        const allAdvsSnap = await db.collection('advertisers').get();
        const brandsInCat = allAdvsSnap.docs
            .map(d => d.data())
            .filter(a => (a.categories || []).some(c => slugify(c) === slug));

        if (brandsInCat.length > 0) {
            const catName = brandsInCat[0].categories.find(c => slugify(c) === slug);
            return renderCatalog(req, res, {
                type: 'category',
                data: { name: catName, brands: brandsInCat }, // Store full objects
                title: `Best ${catName} Deals & Products | Offerbae`,
                description: `Discover the best deals, coupons, and products in the ${catName} category from top brands.`
            });
        }
        */

        // 3. Fallback: Check if it's a Product Detail Page (/:brandSlug/:productSlug)
        // This is handled by a different route in app.js

        res.status(404).render('404', { message: 'Category or Brand not found' });

    } catch (error) {
        console.error('Catalog Error:', error);
        res.status(500).send('Server Error');
    }
};

const renderCatalog = async (req, res, context) => {
    const db = firebaseConfig.db;
    const { getGlobalSettings } = require('../services/db');
    const settings = await getGlobalSettings();
    const page = parseInt(req.query.page) || 1;
    const limit = 50;

    // 4. Handle Search Query
    const q = req.query.q ? req.query.q.toLowerCase().trim() : '';

    let products = [];
    let offers = [];
    let hasNextPage = false;
    let totalCount = 0;

    try {
        // Fetch Offers if it's a Brand page
        if (context.type === 'brand') {
            const now = new Date();
            const offersSnap = await db.collection('offers')
                .where('advertiserId', '==', String(context.data.id))
                .get();
            offers = offersSnap.docs
                .map(doc => doc.data())
                .filter(o => !o.endDate || new Date(o.endDate) > now);
        }
        if (q) {
            // Search Mode: Consistent with homepage logic
            const qTokens = q.split(/\s+/).filter(t => t.length >= 2);
            if (qTokens.length === 0) {
                // If query exists but no valid tokens (e.g. "a"), return nothing or basic list
                products = [];
            } else {
                const mainToken = qTokens[0];
                const searchLimit = 2000;

                let searchBase = db.collection('products');
                if (context.type === 'brand') {
                    searchBase = searchBase.where('advertiserId', '==', String(context.data.id));
                } else if (context.type === 'category') {
                    const brandIds = context.data.brands.map(b => b.id).slice(0, 30);
                    searchBase = searchBase.where('advertiserId', 'in', brandIds);
                }

                // Keyword search
                const snapshot = await searchBase
                    .where('searchKeywords', 'array-contains', mainToken)
                    .limit(searchLimit)
                    .get();

                let filtered = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // Refine if multiple tokens
                if (qTokens.length > 1) {
                    filtered = filtered.filter(p => {
                        const searchStr = (p.name || '').toLowerCase();
                        return qTokens.every(token => searchStr.includes(token));
                    });
                }
                products = filtered;
            }

            totalCount = products.length;
            const start = (page - 1) * limit;
            products = products.slice(start, start + limit);
            hasNextPage = totalCount > page * limit;
        } else {
            // Normal Mode: In-Memory Sorting & Pagination
            // We fetch all products for the brand/category (up to a reasonable limit)
            // and perform sorting/pagination in memory to avoid Firestore Index errors
            // and ensure correct numeric sorting even if data is mixed strings/numbers.
            let query = db.collection('products');

            if (context.type === 'brand') {
                query = query.where('advertiserId', '==', String(context.data.id));
            } else if (context.type === 'category') {
                const brandIds = context.data.brands.map(b => b.id).slice(0, 30);
                query = query.where('advertiserId', 'in', brandIds);
            }

            // Fetch up to 1000 products to sort in-memory
            const snapshot = await query.limit(1000).get();
            let allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Apply Sorting
            const sort = req.query.sort || 'newest';
            const getPrice = (p) => {
                const v = parseFloat(p.price);
                return isNaN(v) ? 0 : v;
            };
            const getDate = (p) => {
                return p.updatedAt ? (p.updatedAt._seconds || new Date(p.updatedAt).getTime()) : 0;
            };

            if (sort === 'newest') {
                allProducts.sort((a, b) => getDate(b) - getDate(a));
            } else if (sort === 'price-low') {
                allProducts.sort((a, b) => getPrice(a) - getPrice(b));
            } else if (sort === 'price-high') {
                allProducts.sort((a, b) => getPrice(b) - getPrice(a));
            }

            // Apply Pagination
            totalCount = allProducts.length;
            const start = (page - 1) * limit;
            products = allProducts.slice(start, start + limit);
            hasNextPage = totalCount > page * limit;
        }

        if (req.query.format === 'json') {
            return res.json({ products, page, hasNextPage, totalCount });
        }

        const ejsHelpers = require('../utils/ejsHelpers');

        // Always prioritize the Brand's total product count for the placeholder
        let placeholderCount = 0;
        if (context.type === 'brand') {
            // 1. Try pre-calculated count on brand object
            if (context.data.productCount) {
                placeholderCount = context.data.productCount;
            } else {
                // 2. Fetch true total from DB if missing (crucial for search queries where 'totalCount' is filtered)
                try {
                    const countSnap = await db.collection('products')
                        .where('advertiserId', '==', String(context.data.id))
                        .count()
                        .get();
                    placeholderCount = countSnap.data().count;
                    // Optional: Update context to avoid re-fetching if used elsewhere
                    context.data.productCount = placeholderCount;
                } catch (e) {
                    console.error('Error fetching total product count for placeholder:', e);
                    placeholderCount = totalCount; // Last resort fallback
                }
            }
        } else {
            placeholderCount = totalCount;
        }

        res.render('catalog', {
            ...context,
            products,
            offers,
            page,
            sort: req.query.sort || 'newest',
            filters: req.query,
            settings,
            hasNextPage,
            totalCount,
            placeholderCount,
            h: ejsHelpers
        });
    } catch (error) {
        if (error.message.includes('requires an index')) {
            console.error('MISSING INDEX:', error.message);
            return res.status(500).render('404', {
                message: 'Database is still optimizing. Please follow the link in your server logs to create the required Firestore index.'
            });
        }
        throw error;
    }
};

const getProductDetail = async (req, res) => {
    try {
        const { brandSlug, productSlug } = req.params;
        const db = firebaseConfig.db;

        const pSnap = await db.collection('products')
            .where('slug', '==', productSlug)
            .limit(1)
            .get();

        if (pSnap.empty) {
            return res.status(404).render('404', { message: 'Product not found' });
        }

        const product = pSnap.docs[0].data();
        const brandSnap = await db.collection('advertisers').where('id', '==', product.advertiserId).limit(1).get();
        const brand = !brandSnap.empty ? brandSnap.docs[0].data() : null;

        const { getGlobalSettings } = require('../services/db');
        const settings = await getGlobalSettings();

        const ejsHelpers = require('../utils/ejsHelpers');

        res.render('product', {
            product,
            brand,
            title: `${product.name} | ${brand ? brand.name : 'Offerbae'}`,
            description: product.description || `Get the best deal on ${product.name}. Shop now on Offerbae.`,
            settings,
            h: ejsHelpers
        });

    } catch (error) {
        console.error('Product Detail Error:', error);
        res.status(500).send('Server Error');
    }
};

module.exports = {
    getCatalogPage,
    getProductDetail
};
