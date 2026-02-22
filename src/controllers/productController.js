const firebaseConfig = require('../config/firebase');
const { getGlobalSettings, slugify } = require('../services/db');

const getCatalogPage = async (req, res) => {
    try {
        const db = firebaseConfig.db;
        const { idSlug } = req.params;
        const idPart = idSlug.split('-')[0];

        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const offset = (page - 1) * limit;

        // 1. Try to find a Brand matching this ID
        let brandSnap = await db.collection('advertisers')
            .where('id', '==', idPart)
            .limit(1)
            .get();

        if (brandSnap.empty && !isNaN(idPart)) {
            brandSnap = await db.collection('advertisers')
                .where('id', '==', Number(idPart))
                .limit(1)
                .get();
        }

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

        res.status(404).render('404', { message: 'Brand not found', pageH1: 'Not Found' });

    } catch (error) {
        console.error('Catalog Error:', error);
        res.status(500).send('Server Error');
    }
};

const getCategoryPage = async (req, res) => {
    try {
        const db = firebaseConfig.db;
        const { slug } = req.params;

        // Find brands in this category
        const allAdvsSnap = await db.collection('advertisers').get();
        const brandsInCat = allAdvsSnap.docs
            .map(d => d.data())
            .filter(a => (a.categories || []).some(c => slugify(c) === slug));

        if (brandsInCat.length > 0) {
            const catName = brandsInCat[0].categories.find(c => slugify(c) === slug);
            return renderCatalog(req, res, {
                type: 'category',
                data: { name: catName, brands: brandsInCat },
                title: `Best ${catName} Deals & Products | Offerbae`,
                description: `Discover the best deals, coupons, and products in the ${catName} category from top brands.`
            });
        }

        res.status(404).render('404', { message: 'Category not found', pageH1: 'Not Found' });
    } catch (error) {
        console.error('Category Page Error:', error);
        res.status(500).send('Server Error');
    }
}

const renderCatalog = async (req, res, context) => {
    const db = firebaseConfig.db;
    const settings = await getGlobalSettings();
    const page = parseInt(req.query.page) || 1;
    const limit = 50;

    const q = req.query.q ? req.query.q.toLowerCase().trim() : '';

    let products = [];
    let offers = [];
    let hasNextPage = false;
    let totalCount = 0;

    try {
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
            const qTokens = q.split(/\s+/).filter(t => t.length >= 2);
            if (qTokens.length === 0) {
                products = [];
            } else {
                const mainToken = qTokens[0];
                let searchBase = db.collection('products');
                if (context.type === 'brand') {
                    searchBase = searchBase.where('advertiserId', '==', String(context.data.id));
                } else if (context.type === 'category') {
                    const brandIds = context.data.brands.map(b => b.id).slice(0, 30);
                    searchBase = searchBase.where('advertiserId', 'in', brandIds);
                }

                const snapshot = await searchBase
                    .where('searchKeywords', 'array-contains', mainToken)
                    .limit(2000)
                    .get();

                let filtered = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

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
            let query = db.collection('products');
            if (context.type === 'brand') {
                query = query.where('advertiserId', '==', String(context.data.id));
            } else if (context.type === 'category') {
                const brandIds = context.data.brands.map(b => b.id).slice(0, 30);
                query = query.where('advertiserId', 'in', brandIds);
            }

            const snapshot = await query.limit(1000).get();
            let allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const sort = req.query.sort || 'newest';
            const getPrice = (p) => parseFloat(p.price) || 0;
            const getDate = (p) => p.updatedAt ? (p.updatedAt._seconds || new Date(p.updatedAt).getTime()) : 0;

            if (sort === 'newest') allProducts.sort((a, b) => getDate(b) - getDate(a));
            else if (sort === 'price-low') allProducts.sort((a, b) => getPrice(a) - getPrice(b));
            else if (sort === 'price-high') allProducts.sort((a, b) => getPrice(b) - getPrice(a));

            totalCount = allProducts.length;
            const start = (page - 1) * limit;
            products = allProducts.slice(start, start + limit);
            hasNextPage = totalCount > page * limit;
        }

        if (req.query.format === 'json') {
            return res.json({ products, page, hasNextPage, totalCount });
        }

        const ejsHelpers = require('../utils/ejsHelpers');
        let placeholderCount = 0;
        if (context.type === 'brand') {
            if (context.data.productCount) {
                placeholderCount = context.data.productCount;
            } else {
                const countSnap = await db.collection('products').where('advertiserId', '==', String(context.data.id)).count().get();
                placeholderCount = countSnap.data().count;
                context.data.productCount = placeholderCount;
            }
        } else {
            placeholderCount = totalCount;
        }

        res.render('catalog', {
            ...context,
            products,
            offers,
            page,
            pageH1: context.type === 'brand' ? 'Brand' : 'Category',
            sort: req.query.sort || 'newest',
            filters: req.query,
            settings,
            hasNextPage,
            totalCount,
            placeholderCount,
            h: ejsHelpers
        });
    } catch (error) {
        console.error('Render Catalog Error:', error);
        res.status(500).send('Server Error');
    }
};

const getProductDetail = async (req, res) => {
    try {
        const { brandSlug, idSlug } = req.params;
        const productId = idSlug.split('-')[0];
        const db = firebaseConfig.db;

        // Search by slug (easier since we store it) or ID part
        // The user's new structure: /product/[brand-slug]/[offerbae-product-id]-[product-title-slug]

        let pSnap = await db.collection('products')
            .where('slug', '==', idSlug) // Try if idSlug is already the full slug
            .limit(1)
            .get();

        if (pSnap.empty) {
            // Fallback: search by document ID or a specific SKU-based ID if needed
            // For now, let's try to match by the "id" field if it exists, or search for the slug that starts with productId
            const searchSnap = await db.collection('products')
                .where('slug', '>=', productId)
                .where('slug', '<=', productId + '\uf8ff')
                .limit(1)
                .get();

            if (searchSnap.empty) {
                return res.status(404).render('404', { message: 'Product not found', pageH1: 'Not Found' });
            }
            pSnap = searchSnap;
        }

        const product = pSnap.docs[0].data();
        const brandSnap = await db.collection('advertisers').where('id', '==', product.advertiserId).limit(1).get();
        const brand = !brandSnap.empty ? brandSnap.docs[0].data() : null;

        const settings = await getGlobalSettings();
        const ejsHelpers = require('../utils/ejsHelpers');

        res.render('product', {
            product,
            brand,
            pageH1: 'Product',
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

// --- NEW SEO CONTROLLERS ---

const getCategoriesPage = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('coming-soon', {
            settings,
            pageH1: 'Categories',
            title: 'Categories - Coming Soon',
            message: "We're organizing our categories to help you find the best deals faster. This section will be live shortly!",
            btnText: 'Back to Brands',
            btnLink: '/brands'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

const getOffersListPage = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('coming-soon', {
            settings,
            pageH1: 'Offers',
            title: 'Daily Offers & Coupons - Coming Soon',
            message: "Our real-time offer discovery engine is being optimized. Soon you'll be able to browse all active coupons in one place!",
            btnText: 'Explore Brands',
            btnLink: '/brands'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

const getProductsListPage = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('coming-soon', {
            settings,
            pageH1: 'Products',
            title: 'Product Discovery - Coming Soon',
            message: "We're indexing thousands of products to bring you the best prices. Check back soon for our full product catalog!",
            btnText: 'View Brands',
            btnLink: '/brands'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

const getOfferDetailPage = async (req, res) => {
    try {
        const { brandSlug, idSlug } = req.params;
        const offerId = idSlug.split('-')[0];
        const db = firebaseConfig.db;

        const searchSnap = await db.collection('offers').where('id', '==', offerId).limit(1).get();
        if (searchSnap.empty) {
            return res.status(404).render('404', { message: 'Offer not found', pageH1: 'Not Found' });
        }

        const offer = searchSnap.docs[0].data();
        const brandSnap = await db.collection('advertisers').where('id', '==', String(offer.advertiserId)).limit(1).get();
        const brand = !brandSnap.empty ? brandSnap.docs[0].data() : null;

        const settings = await getGlobalSettings();

        res.render('coming-soon', {
            settings,
            pageH1: 'Offer',
            title: `${offer.description || 'Offer'} | ${brand ? brand.name : 'Offerbae'}`,
            message: `You've found a great deal for ${brand ? brand.name : 'this brand'}! This detailed offer page is coming soon.`,
            btnText: `View all ${brand ? brand.name : 'Brand'} Deals`,
            btnLink: brand ? `/brand/${brand.id}-${slugify(brand.name)}` : '/brands'
        });
    } catch (error) {
        console.error('Offer Detail Error:', error);
        res.status(500).send('Server Error');
    }
};

const getCalendarListPage = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('coming-soon', {
            settings,
            pageH1: 'Calendar',
            title: 'OfferBae Calendar - Coming Soon',
            message: "Our annual calendar of specialty sales, holiday events, and exclusive shopping dates is currently being curated. Stay tuned for the ultimate shopping timeline!",
            btnText: 'Back to Brands',
            btnLink: '/brands'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

const getCalendarEventPage = async (req, res) => {
    try {
        const { slug } = req.params;
        const settings = await getGlobalSettings();

        // Convert slug to Title Case for the message
        const eventName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

        res.render('coming-soon', {
            settings,
            pageH1: 'Calendar',
            title: `${eventName} Deals & Events | OfferBae`,
            message: `The ${eventName} event page is under construction. We are gathering the best offers and exclusive products for this date. Check back soon!`,
            btnText: 'View Current Brands',
            btnLink: '/brands'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

const getJournalListPage = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.render('coming-soon', {
            settings,
            pageH1: 'Journal',
            title: 'OfferBae Journal - Premium Shopping Insights',
            message: "Our editorial team is preparing deep dives into shopping trends, brand histories, and expert saving strategies. The Journal is coming soon.",
            btnText: 'Explore Brands',
            btnLink: '/brands'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

const getJournalArticlePage = async (req, res) => {
    try {
        const { slug } = req.params;
        const settings = await getGlobalSettings();

        const articleName = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

        res.render('coming-soon', {
            settings,
            pageH1: 'Journal',
            title: `${articleName} | OfferBae Journal`,
            message: `This Journal article is being finalized by our editors. We'll have world-class insights on "${articleName}" live very soon!`,
            btnText: 'Back to Journal',
            btnLink: '/journal'
        });
    } catch (e) {
        res.status(500).send('Server Error');
    }
};

module.exports = {
    getCatalogPage,
    getCategoryPage,
    getProductDetail,
    getCategoriesPage,
    getOffersListPage,
    getProductsListPage,
    getOfferDetailPage,
    getCalendarListPage,
    getCalendarEventPage,
    getJournalListPage,
    getJournalArticlePage
};
