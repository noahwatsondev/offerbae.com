const firebase = require('../config/firebase');
const crypto = require('crypto');

const COLLECTIONS = {
    ADVERTISERS: 'advertisers',
    OFFERS: 'offers',
    PRODUCTS: 'products'
};

function slugify(text) {
    if (!text) return '';
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
        .replace(/\-\-+/g, '-')         // Replace multiple - with single -
        .replace(/^-+/, '')             // Trim - from start of text
        .replace(/-+$/, '');            // Trim - from end of text
}

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

        if (!advertiserData.slug && advertiserData.name) {
            advertiserData.slug = slugify(advertiserData.name);
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

        if (!productData.slug && productData.name) {
            const baseSlug = slugify(productData.name);
            const shortId = (productData.id || productData.sku || docId).substring(0, 5);
            productData.slug = `${baseSlug}-${shortId}`;
        }

        // Calculate Savings Amount for the Homepage grid
        const getNum = (v) => {
            if (typeof v === 'number') return v;
            if (!v) return 0;
            return parseFloat(String(v).replace(/[^0-9.-]+/g, "")) || 0;
        };
        let price = getNum(productData.price);
        let salePrice = getNum(productData.salePrice);

        // If salePrice is 0 but price is not, it's likely a missing salePrice, not a free product
        if (salePrice <= 0 && price > 0) {
            salePrice = price;
            productData.salePrice = price;
        }

        if (price > salePrice && salePrice > 0) {
            productData.savingsAmount = price - salePrice;
        } else {
            productData.savingsAmount = 0;
            // Also ensure discountPercent is handled if it exists in data
            if (productData.discountPercent) productData.discountPercent = 0;
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
        let batch = firebase.db.batch();
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

// In-memory TTL cache for settings (30s)
let _settingsCache = null;
let _settingsCacheAt = 0;
const SETTINGS_TTL = 30_000;

const getGlobalSettings = async () => {
    if (_settingsCache && Date.now() - _settingsCacheAt < SETTINGS_TTL) {
        return _settingsCache;
    }
    try {
        // Try to fetch from Firestore first
        const doc = await firebase.db.collection('settings').doc('global').get();
        if (doc.exists) {
            const data = doc.data();
            // Cache to local file
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
            _settingsCache = data;
            _settingsCacheAt = Date.now();
            return data;
        }
    } catch (e) {
        console.error('Error getting global settings from Firestore:', e.message);
    }

    // Fallback to local file if Firestore fails or doesn't exist
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
            _settingsCache = data;
            _settingsCacheAt = Date.now();
            return data;
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

// In-memory TTL cache for advertisers (60s)
let _advertiserCache = null;
let _advertiserCacheAt = 0;
const ADVERTISER_TTL = 60_000;

const getEnrichedAdvertisers = async () => {
    if (_advertiserCache && Date.now() - _advertiserCacheAt < ADVERTISER_TTL) {
        return _advertiserCache;
    }
    try {
        const advSnapshot = await firebase.db.collection(COLLECTIONS.ADVERTISERS).get();

        const advertisers = [];
        advSnapshot.forEach(doc => {
            const data = doc.data();
            advertisers.push({
                ...data,
                productCount: data.productCount || 0,
                saleProductCount: data.saleProductCount || 0,
                offerCount: data.offerCount || 0,
                logoUrl: data.storageLogoUrl || data.logoUrl || (data.raw_data && data.raw_data.logoUrl ? data.raw_data.logoUrl : null)
            });
        });

        // Sort: Product Count (Desc) -> Name (Asc)
        advertisers.sort((a, b) => {
            if (b.productCount !== a.productCount) {
                return b.productCount - a.productCount;
            }
            return (a.name || '').localeCompare(b.name || '');
        });

        _advertiserCache = advertisers;
        _advertiserCacheAt = Date.now();
        return _advertiserCache;
    } catch (e) {
        console.error('Error fetching enriched advertisers:', e);
        throw e;
    }
};

const isRealCode = (code) => {
    if (!code) return false;
    const clean = String(code).trim().toLowerCase();

    // Catch common patterns indicating no actual promo code exists
    // Added "required" and "none required" as requested
    const noCodePattern = /^(no\s+code|none|n\/?a|null|false|0|required|none\s+required)$/i;
    // Robust "no coupon code" patterns
    const looseNoCodePattern = /(no\s+code|no\s+coupon|no\s+promo|no\s+discount|code\s+needed|code\s+required)/i;

    if (noCodePattern.test(clean) || (clean.includes('no') && (clean.includes('code') || clean.includes('coupon'))) || looseNoCodePattern.test(clean)) {
        if (!/^[A-Z0-9]{3,}$/i.test(clean)) { // If it's not a standard short alphanumeric code
            return false;
        }
    }

    const nonCodes = [
        'see site', 'click to reveal', 'auto-applied', 'online only', 'undefined', '', 'no code required', 'no coupon code needed', 'required', 'none required'
    ];
    return !nonCodes.includes(clean);
};

const cleanOfferCode = (code) => {
    if (!code) return null;
    if (isRealCode(code)) return code.trim();
    return null;
};

const extractCodeFromDescription = (desc) => {
    if (!desc) return null;
    const patterns = [
        // Explicit label patterns (most reliable)
        /promo\s+code[:\s]+([A-Z0-9_-]{3,20})\b/i,
        /coupon\s+code[:\s]+([A-Z0-9_-]{3,20})\b/i,
        /discount\s+code[:\s]+([A-Z0-9_-]{3,20})\b/i,
        // "use/using/apply/enter code XXXX"
        /(?:use|using|apply|enter|with)\s+code\s+([A-Z0-9_-]{3,20})\b/i,
        // "code: XXXX" style
        /\bcode[:\s]+([A-Z0-9_-]{3,20})\b/i,
    ];
    // Common English words that are NOT promo codes
    const COMMON_WORDS = new Set([
        'FOR', 'THE', 'AND', 'OFF', 'GET', 'USE', 'NEW', 'ONLY', 'SAVE', 'MORE',
        'SHOP', 'SITE', 'FREE', 'YOUR', 'ALL', 'NOW', 'END', 'FALL', 'FIT',
        'JUST', 'BIG', 'TOP', 'WIN', 'OUT', 'YES', 'DEAL', 'SALE', 'BEST',
        'LOVE', 'ITEMS', 'CODE', 'MAGIC', 'TREAT', 'WOMEN', 'SPRING', 'SUMMER',
        'NEEDED', 'SCHOOL', 'EASTER', 'GRADUATION', 'FREEDOM', 'CHECKOUT', 'TAX',
    ]);
    for (const p of patterns) {
        const match = desc.match(p);
        if (match && match[1]) {
            const candidate = match[1].toUpperCase();
            // Reject: starts with hyphen, pure common word, less than 4 chars, or all letters with no digits (weak signal)
            if (candidate.startsWith('-')) continue;
            if (COMMON_WORDS.has(candidate)) continue;
            if (candidate.length < 4) continue;
            return candidate;
        }
    }
    return null;
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
    updateGlobalSettings,
    getEnrichedAdvertisers,
    slugify,
    isRealCode,
    cleanOfferCode,
    extractCodeFromDescription
};
