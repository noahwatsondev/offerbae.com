const firebase = require('../config/firebase');
const { slugify } = require('./db');

const COLLECTION = 'loveletters';

const getAllArticles = async (includeUnpublished = false) => {
    try {
        const snapshot = await firebase.db.collection(COLLECTION).orderBy('createdAt', 'desc').get();
        let articles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (!includeUnpublished) {
            articles = articles.filter(a => a.published === true || a.published === 'true');
        }

        return articles;
    } catch (error) {
        console.error('Error getting articles:', error);
        return [];
    }
};

const getArticleById = async (id) => {
    try {
        const doc = await firebase.db.collection(COLLECTION).doc(id).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
        console.error('Error getting article by id:', error);
        return null;
    }
};

const getArticleBySlug = async (slug) => {
    try {
        const snapshot = await firebase.db.collection(COLLECTION)
            .where('slug', '==', slug)
            .limit(1)
            .get();
        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('Error getting article by slug:', error);
        return null;
    }
};

const upsertArticle = async (articleData) => {
    try {
        const id = articleData.id;
        const data = { ...articleData };
        delete data.id;

        if (!data.slug && data.title) {
            data.slug = slugify(data.title);
        }

        data.updatedAt = new Date();
        if (!data.createdAt) {
            data.createdAt = new Date();
        }

        let ref;
        if (id) {
            ref = firebase.db.collection(COLLECTION).doc(id);
            await ref.set(data, { merge: true });
        } else {
            ref = await firebase.db.collection(COLLECTION).add(data);
        }

        return { id: ref.id, success: true };
    } catch (error) {
        console.error('Error upserting article:', error);
        throw error;
    }
};

const deleteArticle = async (id) => {
    try {
        await firebase.db.collection(COLLECTION).doc(id).delete();
        return { success: true };
    } catch (error) {
        console.error('Error deleting article:', error);
        throw error;
    }
};

const getLatestArticles = async (limit = 2) => {
    try {
        const snapshot = await firebase.db.collection(COLLECTION).orderBy('createdAt', 'desc').get();
        let articles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Filter and sort by published date if available
        return articles
            .filter(a => a.published === true || a.published === 'true')
            .sort((a, b) => {
                const dateA = a.publishedAt ? new Date(a.publishedAt) : new Date(0);
                const dateB = b.publishedAt ? new Date(b.publishedAt) : new Date(0);
                return dateB - dateA;
            })
            .slice(0, limit);
    } catch (error) {
        console.error('Error getting latest articles:', error);
        return [];
    }
};

const getHeroLetter = async () => {
    try {
        const snapshot = await firebase.db.collection(COLLECTION)
            .where('isHero', '==', true)
            .limit(1)
            .get();
        if (snapshot.empty) return null;
        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('Error getting hero letter:', error);
        return null;
    }
};

const setHeroLetter = async (id) => {
    try {
        const db = firebase.db;
        const batch = db.batch();

        // Find current hero
        const currentHero = await db.collection(COLLECTION).where('isHero', '==', true).get();
        currentHero.forEach(doc => {
            batch.update(doc.ref, { isHero: false });
        });

        // Set new hero
        if (id) {
            const newHeroRef = db.collection(COLLECTION).doc(id);
            batch.update(newHeroRef, { isHero: true });
        }

        await batch.commit();
        return { success: true };
    } catch (error) {
        console.error('Error setting hero letter:', error);
        throw error;
    }
};

module.exports = {
    getAllArticles,
    getArticleById,
    getArticleBySlug,
    upsertArticle,
    deleteArticle,
    getLatestArticles,
    getHeroLetter,
    setHeroLetter
};
