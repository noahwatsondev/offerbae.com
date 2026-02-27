/**
 * backfill_offer_codes.js
 * 
 * One-shot script that scans all offers in Firestore.
 * For any offer where the stored `code` field is null/empty/invalid
 * but the description contains a recognizable promo code pattern,
 * it extracts the code and writes it back to the `code` and `isPromoCode` fields.
 * 
 * Run once: node backfill_offer_codes.js
 */

require('dotenv').config({ override: true });

const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// --- Firebase init ---
let credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const localCred = path.join(__dirname, 'service-account.json');
if (fs.existsSync(localCred)) credentialPath = localCred;

if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(credentialPath),
        projectId: process.env.GCP_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
}

const db = firebaseAdmin.firestore();

// --- Inline copy of helpers (avoids circular import issues) ---
const isRealCode = (code) => {
    if (!code) return false;
    const clean = String(code).trim().toLowerCase();
    const noCodePattern = /^(no\s+code|none|n\/?a|null|false|0|required|none\s+required)$/i;
    const looseNoCodePattern = /(no\s+code|no\s+coupon|no\s+promo|no\s+discount|code\s+needed|code\s+required)/i;
    if (noCodePattern.test(clean) || (clean.includes('no') && (clean.includes('code') || clean.includes('coupon'))) || looseNoCodePattern.test(clean)) {
        if (!/^[A-Z0-9]{3,}$/i.test(clean)) return false;
    }
    const nonCodes = ['see site', 'click to reveal', 'auto-applied', 'online only', 'undefined', '', 'no code required', 'no coupon code needed', 'required', 'none required'];
    return !nonCodes.includes(clean);
};

const isCodeLike = (str) => {
    if (!str || str.length < 4 || str.length > 24) return false;
    const hasDigit = /\d/.test(str);
    const isAllCapsAlnum = /^[A-Z][A-Z0-9_-]+$/.test(str);
    if (hasDigit && isAllCapsAlnum) return true;
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
    if (!/\bcode\b/i.test(desc)) return null;

    const pattern = /\bcode[:\s\u2013\u2014\uff1a\u00a0]*([A-Za-z0-9][A-Za-z0-9_-]{2,23})\b/ig;
    let match;
    while ((match = pattern.exec(desc)) !== null) {
        const candidate = match[1].toUpperCase();
        if (isCodeLike(candidate)) return candidate;
    }
    return null;
};

// --- Backfill logic ---
async function backfill() {
    const snapshot = await db.collection('offers').get();
    console.log(`[Backfill] Scanning ${snapshot.size} offers...`);

    let updated = 0;
    let skipped = 0;
    const batch_size = 400;
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();

        // Skip if already has a valid code
        if (isRealCode(data.code)) {
            skipped++;
            continue;
        }

        // Try to extract from description
        const extracted = extractCodeFromDescription(data.description);
        if (!extracted) {
            skipped++;
            continue;
        }

        console.log(`[Backfill] "${data.description?.substring(0, 60)}..." → code: ${extracted}`);
        batch.update(doc.ref, {
            code: extracted,
            isPromoCode: true,
            updatedAt: new Date()
        });
        updated++;
        batchCount++;

        // Commit in batches of 400
        if (batchCount >= batch_size) {
            await batch.commit();
            console.log(`[Backfill] Committed batch of ${batchCount}`);
            batch = db.batch();
            batchCount = 0;
        }
    }

    // Final batch
    if (batchCount > 0) {
        await batch.commit();
    }

    console.log(`\n[Backfill] Done. Updated: ${updated}, Skipped: ${skipped}`);
    process.exit(0);
}

backfill().catch(err => {
    console.error('[Backfill] Error:', err);
    process.exit(1);
});
