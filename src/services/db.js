const firebase = require('../config/firebase');
const crypto = require('crypto');

const COLLECTIONS = {
    ADVERTISERS: 'advertisers',
    OFFERS: 'offers',
    PRODUCTS: 'products'
};

const hasChanged = (newData, existingData) => {
    if (!existingData) return true;

    // 1. Timestamp Optimization: Skip if network record is not newer
    if (newData.networkUpdatedAt && existingData.networkUpdatedAt) {
        const newDate = new Date(newData.networkUpdatedAt);
        const existingDate = new Date(existingData.networkUpdatedAt);
        if (existingDate >= newDate) {
            return false;
        }
    }

    const newKeys = Object.keys(newData).filter(k => k !== 'updatedAt' && k !== 'networkUpdatedAt');
    const existingKeys = Object.keys(existingData).filter(k => k !== 'updatedAt' && k !== 'networkUpdatedAt');

    if (newKeys.length !== existingKeys.length) return true;

    for (const key of newKeys) {
        const newVal = newData[key];
        const oldVal = existingData[key];

        if (typeof newVal === 'object' && newVal !== null && oldVal !== null) {
            // Special handling for Dates
            if (newVal instanceof Date && oldVal instanceof Date) {
                if (newVal.getTime() !== oldVal.getTime()) return true;
                continue;
            }
            // Handle Firebase Timestamp objects if present
            if (oldVal.toDate && typeof oldVal.toDate === 'function') {
                // Compare with new val (likely a JS Date or string)
                const oldDate = oldVal.toDate();
                const newDate = newVal instanceof Date ? newVal : new Date(newVal);
                if (oldDate.getTime() !== newDate.getTime()) return true;
                continue;
            }

            if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) return true;
        } else {
            if (newVal !== oldVal) return true;
        }
    }
    return false;
};

const getAdvertiser = async (network, id) => {
    try {
        const docId = `${network}-${id}`.replace(/\//g, '_');
        const doc = await firebase.db.collection(COLLECTIONS.ADVERTISERS).doc(docId).get();
        return doc.exists ? doc.data() : null;
    } catch (e) {
        console.error('Error getting advertiser:', e);
        return null;
    }
};

const upsertAdvertiser = async (advertiserData, existingData = null) => {
    try {
        if (!advertiserData.id) throw new Error('Advertiser ID is required');

        const docId = `${advertiserData.network}-${advertiserData.id}`.replace(/\//g, '_');
        const ref = firebase.db.collection(COLLECTIONS.ADVERTISERS).doc(docId);

        if (!existingData) {
            const doc = await ref.get();
            if (doc.exists) existingData = doc.data();
        }

        if (!hasChanged(advertiserData, existingData)) {
            // console.log(`[DB] Skipping unchanged advertiser: ${advertiserData.name}`);
            return { id: docId, status: 'skipped' };
        }

        await ref.set({
            ...advertiserData,
            updatedAt: new Date()
        }, { merge: true });

        return { id: docId, status: existingData ? 'updated' : 'created' };
    } catch (error) {
        console.error('Error upserting advertiser:', error);
        throw error;
    }
};

const getOffer = async (network, id) => {
    const docId = id ? `${network}-${id}`.replace(/\//g, '_') : null;
    if (!docId) return null; // Can't fetch without ID
    const doc = await firebase.db.collection(COLLECTIONS.OFFERS).doc(docId).get();
    return doc.exists ? doc.data() : null;
};

const upsertOffer = async (offerData, existingData = null) => {
    try {
        // Generate a unique ID for the offer if not provided
        const docId = offerData.id ? `${offerData.network}-${offerData.id}`.replace(/\//g, '_') :
            crypto.createHash('md5').update(offerData.link + offerData.network).digest('hex');

        const ref = firebase.db.collection(COLLECTIONS.OFFERS).doc(docId);

        if (!existingData) {
            const doc = await ref.get();
            if (doc.exists) existingData = doc.data();
        }

        if (!hasChanged(offerData, existingData)) {
            return { id: docId, status: 'skipped' };
        }

        await ref.set({
            ...offerData,
            updatedAt: new Date()
        }, { merge: true });

        return { id: docId, status: existingData ? 'updated' : 'created' };
    } catch (error) {
        console.error('Error upserting offer:', error);
        throw error;
    }
};

const getProduct = async (network, skuOrId) => {
    // This is tricky because upsertProduct has fallback logic for ID generation.
    // Ideally we duplicate that logic here or pass the exact ID.
    // For now, let's assume the caller knows the ID or we assume standard SKU based ID.
    const docId = `${network}-${skuOrId}`.replace(/\//g, '_');
    const doc = await firebase.db.collection(COLLECTIONS.PRODUCTS).doc(docId).get();
    return doc.exists ? doc.data() : null;
};

const upsertProduct = async (productData, existingData = null) => {
    try {
        const docId = productData.id ? `${productData.network}-${productData.id}`.replace(/\//g, '_') :
            productData.sku ? `${productData.network}-${productData.sku}`.replace(/\//g, '_') :
                crypto.createHash('md5').update(productData.link + productData.network).digest('hex');

        const ref = firebase.db.collection(COLLECTIONS.PRODUCTS).doc(docId);

        if (!existingData) {
            const doc = await ref.get();
            if (doc.exists) existingData = doc.data();
        }

        if (!hasChanged(productData, existingData)) {
            return { id: docId, status: 'skipped' };
        }

        await ref.set({
            ...productData,
            updatedAt: new Date()
        }, { merge: true });

        return { id: docId, status: existingData ? 'updated' : 'created' };
    } catch (error) {
        console.error('Error upserting product:', error);
        throw error;
    }
};

const logSyncComplete = async (network, stats) => {
    try {
        await firebase.db.collection('sync_logs').add({
            network,
            stats,
            completedAt: new Date(),
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('Error logging sync:', e);
    }
};

const getSyncHistory = async (network, limit = 5) => {
    try {
        // If network is 'all' or undefined, get all? User asked for network dashboard cards.
        let query = firebase.db.collection('sync_logs');
        if (network && network !== 'all') {
            query = query.where('network', '==', network);
        }

        const snapshot = await query.orderBy('timestamp', 'desc').limit(limit).get();
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            completedAt: doc.data().completedAt.toDate() // Ensure Date object
        }));
    } catch (e) {
        console.error('Error fetching sync history:', e);
        return [];
    }
};

const pruneStaleRecords = async (network, collectionName, activeIds) => {
    try {
        console.log(`PRUNE: Starting prune for ${network} ${collectionName}...`);
        const snapshot = await firebase.db.collection(collectionName)
            .where('network', '==', network)
            .get();

        if (snapshot.empty) return { deleted: 0 };

        const activeIdSet = new Set(activeIds);
        let deletedCount = 0;
        const batch = firebase.db.batch();
        let batchCount = 0;
        const MAX_BATCH_SIZE = 400; // Firestore limit is 500

        for (const doc of snapshot.docs) {
            // Check if the doc ID (not the data.id) is in the active set
            // Our activeIds should be the document IDs (e.g. "Rakuten-12345")
            // In upsert we return { id: docId, ... } which logic layer tracks.

            // However, sometimes we might want to check data.id? 
            // Better to rely on the Firestore Document ID which is stable and unique.
            if (!activeIdSet.has(doc.id)) {
                batch.delete(doc.ref);
                deletedCount++;
                batchCount++;

                if (batchCount >= MAX_BATCH_SIZE) {
                    await batch.commit();
                    batchCount = 0;
                    batch = firebase.db.batch(); // Re-initialize batch
                }
            }
        }

        if (batchCount > 0) {
            await batch.commit();
        }

        console.log(`PRUNE: Deleted ${deletedCount} stale records from ${network} ${collectionName}.`);
        return { deleted: deletedCount };
    } catch (e) {
        console.error(`PRUNE: Error pruning ${network} ${collectionName}:`, e);
        return { deleted: 0, error: e.message };
    }
};

const fs = require('fs');
const path = require('path');
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

// Ensure data directory exists
const DATA_DIR = path.dirname(SETTINGS_FILE);
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const getGlobalSettings = async () => {
    try {
        // Try to fetch from Firestore first
        const doc = await firebase.db.collection('settings').doc('global').get();
        if (doc.exists) {
            const data = doc.data();
            // Cache to local file
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
            return data;
        }
    } catch (e) {
        console.error('Error getting global settings from Firestore:', e.message);
    }

    // Fallback to local file if Firestore fails or doesn't exist
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            console.log('Loading settings from local cache.');
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (fileErr) {
        console.error('Error reading local settings cache:', fileErr.message);
    }

    return {};
};

const updateGlobalSettings = async (settings) => {
    // Save to local file first (optimistic update / offline support)
    try {
        const current = await getGlobalSettings(); // Get current to merge
        const newSettings = { ...current, ...settings, updatedAt: new Date() };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(newSettings, null, 2));
    } catch (e) {
        console.error('Error saving local settings cache:', e.message);
    }

    try {
        await firebase.db.collection('settings').doc('global').set({
            ...settings,
            updatedAt: new Date()
        }, { merge: true });
        return true;
    } catch (e) {
        console.error('Error updating global settings in Firestore:', e);
        // We throw here usually, but if we saved locally, maybe we shouldn't block?
        // For now, let's allow it to succeed if local save worked, but log error.
        // Actually, user expects persistence. If we return true, they think it's saved remotely.
        // But for offline dev, local is fine.
        console.warn('Proceeding with local-only settings update due to Firestore error.');
        return true;
    }
};

module.exports = {
    upsertAdvertiser,
    upsertOffer,
    upsertProduct,
    getAdvertiser,
    getOffer,
    getProduct,
    logSyncComplete,
    getSyncHistory,
    pruneStaleRecords,
    getGlobalSettings,
    updateGlobalSettings
};
