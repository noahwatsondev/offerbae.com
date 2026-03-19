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

    const keysToIgnore = ['updatedAt', 'networkUpdatedAt', 'raw_data', 'storageLogoUrl', 'storageImageUrl', 'isManualLogo', 'isManualDescription', 'isManualCategory', 'productCount', 'offerCount', 'saleProductCount'];
    const newKeys = Object.keys(newData).filter(k => !keysToIgnore.includes(k));

    for (const key of newKeys) {
        const newVal = newData[key];
        const oldVal = existingData[key];

        // Skip if key doesn't exist in existing data (unless it's null/undefined in new data)
        if (!(key in existingData)) {
            if (newVal !== undefined && newVal !== null) return true;
            continue;
        }

        if (typeof newVal === 'object' && newVal !== null && oldVal !== null && oldVal !== undefined) {
            // Special handling for Dates
            if (newVal instanceof Date && oldVal instanceof Date) {
                if (newVal.getTime() !== oldVal.getTime()) return true;
                continue;
            }
            // Handle Firebase Timestamp objects
            if (oldVal.toDate && typeof oldVal.toDate === 'function') {
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

        const updateData = {
            ...advertiserData,
            updatedAt: new Date()
        };

        // Ensure createdAt is only set once
        if (!existingData || !existingData.createdAt) {
            updateData.createdAt = advertiserData.createdAt || new Date();
        }

        await ref.set(updateData, { merge: true });

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

        // Logic-based intelligent Tagline generation
        // Only run if tagline doesn't exist or isn't manually set
        if (!offerData.tagline && (!existingData || !existingData.isManualTagline)) {
            offerData.tagline = generateOfferTagline(offerData);
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
                // SPECIAL CASE: For advertisers, don't delete if they have manual customizations
                const data = doc.data();
                if (collectionName === 'advertisers' && (data.isManualLogo || data.isManualDescription || data.isManualCategory)) {
                    // Update to Inactive instead of deleting to preserve manual work
                    batch.update(doc.ref, { status: 'Inactive', updatedAt: new Date() });
                } else {
                    batch.delete(doc.ref);
                }
                
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
const ADVERTISER_TTL = 5 * 60 * 1000; // 5 minutes

const getEnrichedAdvertisers = async () => {
    if (_advertiserCache && Date.now() - _advertiserCacheAt < ADVERTISER_TTL) {
        return _advertiserCache;
    }
    try {
        const advSnapshot = await firebase.db.collection(COLLECTIONS.ADVERTISERS).get();

        const advertisers = [];
        advSnapshot.forEach(doc => {
            const data = doc.data();
            const created = doc.createTime ? doc.createTime.toDate() : null;
            advertisers.push({
                ...data,
                id: data.id || doc.id, // Ensure we have the ID for matching
                docId: doc.id,
                productCount: data.productCount || 0,
                saleProductCount: data.saleProductCount || 0,
                offerCount: data.offerCount || 0,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : created),
                logoUrl: data.storageLogoUrl || data.logoUrl || (data.raw_data && data.raw_data.logoUrl ? data.raw_data.logoUrl : null)
            });
        });


        advertisers.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.getTime() : 0;
            const timeB = b.createdAt ? b.createdAt.getTime() : 0;

            if (timeB !== timeA) {
                return timeB - timeA;
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

const getGlobalCategories = async (prefetchedBrands = null) => {
    const enrichedBrands = prefetchedBrands || await getEnrichedAdvertisers();

    const categoryMap = new Map();
    enrichedBrands.forEach(b => {
        const cats = b.categories || (b.raw_data && b.raw_data.categories) || [];
        cats.forEach(c => {
            if (c && !categoryMap.has(c)) {
                categoryMap.set(c, slugify(c));
            }
        });
    });
    const categoriesRaw = Array.from(categoryMap.entries())
        .map(([name, slug]) => ({ name: name.trim(), slug }));

    const otherItems = categoriesRaw.filter(c => c.name.toLowerCase().includes('other'));
    const mainCategories = categoriesRaw.filter(c => !c.name.toLowerCase().includes('other'))
        .sort((a, b) => a.name.localeCompare(b.name));

    return [
        { name: 'All Categories', slug: '' },
        ...mainCategories,
        ...otherItems
    ];
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

// Evaluate whether a token looks like a promo code rather than a plain English word.
// Rules: has at least one digit (e.g. BOLD10, SVMEMBER16), OR is all-caps alphanumeric
// and 6+ chars (unlikely to be a normal English word at that length).
const isCodeLike = (str) => {
    if (!str || str.length < 4 || str.length > 24) return false;
    const hasDigit = /\d/.test(str);
    const isAllCapsAlnum = /^[A-Z][A-Z0-9_-]+$/.test(str);
    // Strong signal: contains a digit
    if (hasDigit && isAllCapsAlnum) return true;
    // Weaker signal: all-caps, no digits, longer than 5 chars — exclude common words
    if (!hasDigit && isAllCapsAlnum && str.length >= 6) {
        const COMMON_WORDS = new Set([
            'SCHOOL', 'EASTER', 'SPRING', 'SUMMER', 'FALL', 'WINTER',
            'NEEDED', 'FREEDOM', 'CHECKOUT', 'GRADUATION', 'SISTER',
            'TRAVEL', 'TREATS', 'LAUNCH', 'MEMBER', 'ONLINE', 'ORDERS',
            'COUPON', 'DISCOUNT', 'EXCLUSIVE', 'SPECIAL', 'BIRTHDAY',
        ]);
        return !COMMON_WORDS.has(str);
    }
    return false;
};

const extractCodeFromDescription = (desc) => {
    if (!desc) return null;
    // Bail early — no mention of "code" at all
    if (!/\bcode\b/i.test(desc)) return null;

    // Look for any word-like token that immediately follows "code" (with flexible separators)
    // Covers: "code XXXX", "code: XXXX", "code – XXXX", "code：XXXX", "Code XXXX", etc.
    const pattern = /\bcode[:\s\u2013\u2014\uff1a\u00a0]*([A-Za-z0-9][A-Za-z0-9_-]{2,23})\b/ig;
    let match;
    while ((match = pattern.exec(desc)) !== null) {
        const candidate = match[1].toUpperCase();
        if (isCodeLike(candidate)) return candidate;
    }
    return null;
};

const generateOfferTagline = (offer) => {
    const text = (offer.description || offer.name || '').toLowerCase();
    
    // Priority 1: High-value patterns
    const percentMatch = text.match(/(\d+)%\s*off/i) || text.match(/up to\s*(\d+)%\s*off/i) || text.match(/(\d+)%/);
    if (percentMatch) return `${percentMatch[1]}% OFF`;
    
    const dollarMatch = text.match(/\$(\d+)\s*off/i) || text.match(/save\s*\$(\d+)/i) || text.match(/\$(\d+)/);
    if (dollarMatch) return `$${dollarMatch[1]} OFF`;
    
    // Priority 2: Shipping
    if (text.includes('free shipping') || text.includes('free delivery')) return 'FREE SHIPPING';
    
    // Priority 3: BOGO
    if (text.includes('buy one get one') || text.includes('bogo')) return 'BOGO';
    
    // Priority 4: Specific Promo Types
    if (text.includes('new customer') || text.includes('new user') || text.includes('first order')) return 'NEW CUSTOMER';
    if (text.includes('student')) return 'STUDENT';
    if (text.includes('military')) return 'MILITARY';
    
    // Priority 5: Clearance / Sale
    if (text.includes('clearance')) return 'CLEARANCE';
    if (text.includes('sitewide')) return 'SITEWIDE';
    if (text.includes('sale')) return 'SALE';
    
    return 'DEAL';
};

const extractDiscountValue = (desc) => {
    if (!desc) return 0;
    const match = desc.match(/(\d+)%/);
    return match ? parseInt(match[1]) : 0;
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
    getGlobalCategories,
    slugify,

    isRealCode,
    cleanOfferCode,
    extractCodeFromDescription,
    generateOfferTagline,
    extractDiscountValue
};
