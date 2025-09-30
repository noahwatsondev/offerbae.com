const firebaseConfig = require('../config/firebase');

const getProducts = async (req, res) => {
    try {
        const db = firebaseConfig.db;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 24;
        const offset = (page - 1) * limit;

        // Fetch products with basic pagination
        // Note: 'offset' in Firestore scales linearly with the number of skipped documents.
        // For production with millions of docs, use cursors. For 23k, offset is acceptable for early pages.
        let query = db.collection('products')
            .orderBy('updatedAt', 'desc')
            .limit(limit)
            .offset(offset);

        // Filter by advertiser if provided
        if (req.query.advertiser) {
            query = db.collection('products')
                .where('advertiserId', '==', req.query.advertiser)
                .orderBy('updatedAt', 'desc') // Requires composite index if inequality filter used, but here equality is fine
                .limit(limit)
                .offset(offset);
        }

        const snapshot = await query.get();
        const products = [];
        snapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data() });
        });

        // Get total count (approximation or separate counter would be better)
        // For now, we don't return total count to avoid reading all docs.
        // We'll just assume there's a next page if we got full 'limit' items.

        res.render('products', {
            products,
            page,
            hasNextPage: products.length === limit,
            advertiserId: req.query.advertiser || null
        });

    } catch (error) {
        console.error('Error getting products:', error);
        res.status(500).send('Error getting products: ' + error.message);
    }
};

module.exports = {
    getProducts
};
