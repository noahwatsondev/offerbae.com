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
        const limit = 24;
        const offset = (page - 1) * limit;

        // 1. Try to find a Brand matching this slug
        const brandSnap = await db.collection('advertisers')
            .where('slug', '==', slug)
            .limit(1)
            .get();

        if (!brandSnap.empty) {
            const brand = brandSnap.docs[0].data();
            return renderCatalog(req, res, {
                type: 'brand',
                data: brand,
                title: `${brand.name} Products, Coupons & Deals`,
                description: `Shop the latest products and find exclusive promo codes and deals for ${brand.name} on Offerbae.`
            });
        }

        // 2. Try to find if this is a Category
        // We look for any brand that has this category (slugified)
        // Since we don't store a separate categories collection, we'll check against a set of known categories 
        // derived from the advertisers. To be efficient, we'd ideally have a categories collection.
        // For now, let's look for any advertiser where the categories list contains something that slugifies to this.

        // Better: Fetch all distinct categories once or use a fixed list if we have one.
        // Let's assume for now any slug that doesn't match a brand might be a category.
        // We'll query products where advertiserName or categories might match? 
        // Actually, advertisers have categories.

        // Find brands in this category
        const allAdvsSnap = await db.collection('advertisers').get();
        const brandsInCat = allAdvsSnap.docs
            .map(d => d.data())
            .filter(a => (a.categories || []).some(c => slugify(c) === slug));

        if (brandsInCat.length > 0) {
            const catName = brandsInCat[0].categories.find(c => slugify(c) === slug);
            return renderCatalog(req, res, {
                type: 'category',
                data: { name: catName, brands: brandsInCat.map(b => b.id) },
                title: `Best ${catName} Deals & Products | Offerbae`,
                description: `Discover the best deals, coupons, and products in the ${catName} category from top brands.`
            });
        }

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
    const page = parseInt(req.query.page) || 1;
    const limit = 24;

    let query = db.collection('products');

    if (context.type === 'brand') {
        query = query.where('advertiserId', '==', String(context.data.id));
    } else if (context.type === 'category') {
        // Firestore 'in' limit is 30. If more brands, we might need multiple queries or alternate strategy.
        const brandIds = context.data.brands.slice(0, 30);
        query = query.where('advertiserId', 'in', brandIds);
    }

    // Apply sorting
    const sort = req.query.sort || 'newest';
    if (sort === 'newest') query = query.orderBy('updatedAt', 'desc');
    else if (sort === 'price-low') query = query.orderBy('price', 'asc');
    else if (sort === 'price-high') query = query.orderBy('price', 'desc');

    // Apply Price Filter
    if (req.query.minPrice) query = query.where('price', '>=', parseFloat(req.query.minPrice));
    if (req.query.maxPrice) query = query.where('price', '<=', parseFloat(req.query.maxPrice));

    const totalCount = context.type === 'brand' ? (context.data.productCount || 0) : 0; // Category total is harder to get instantly

    const snapshot = await query.limit(limit).offset((page - 1) * limit).get();
    const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('catalog', {
        ...context,
        products,
        page,
        sort,
        filters: req.query,
        hasNextPage: products.length === limit
    });
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

        res.render('product', {
            product,
            brand,
            title: `${product.name} | ${brand ? brand.name : 'Offerbae'}`,
            description: product.description || `Get the best deal on ${product.name}. Shop now on Offerbae.`
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
