const firebase = require('../config/firebase');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// Ensure public/uploads exists
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const getOptimizationOptions = (folder = '') => {
    let width = 1200;
    let quality = 85;

    const f = folder.toLowerCase();

    if (f.startsWith('advertisers') || f.startsWith('brand_logos')) {
        width = 400; // Logos do not need to be huge
    } else if (f.startsWith('products')) {
        width = 800; // Product images
    } else if (f.startsWith('brand_backgrounds') || f.startsWith('loveletters') || f.startsWith('love_letters')) {
        width = 1200; // Hero/banner images
        quality = 85; // Keep good quality for large images
    }

    return { width, quality };
};

/**
 * Download image from URL, optimize (resize/compress), and upload to Firebase Storage
 * @param {string} imageUrl - The original image URL
 * @param {string} folder - Folder in bucket to store image (e.g., 'advertisers', 'products')
 * @returns {Promise<string|null>} - The public URL of the stored image or null if failed
 */
const cacheImage = async (imageUrl, folder = 'misc') => {
    if (!imageUrl || typeof imageUrl !== 'string') return null;

    // Clean URL: common fixes for malformed URLs
    let cleanUrl = imageUrl.trim();

    // Fix specific malformed pattern: ?%20-1600.jpg or similar junk
    if (cleanUrl.includes('?%20')) {
        // If it looks like a junk query string intended to be a suffix, strip it
        cleanUrl = cleanUrl.split('?%20')[0];
    }

    const originalUrl = imageUrl;
    imageUrl = cleanUrl;

    try {
        // Fetch image stream
        const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'stream',
            validateStatus: status => status === 200,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
            }
        });

        const contentType = response.headers['content-type'] || '';

        // Validation: skip if not an image
        if (!contentType.startsWith('image/')) {
            console.warn(`[SYNC] Skipping non-image content for ${imageUrl} (Type: ${contentType})`);
            return null;
        }

        const isSvg = contentType.includes('svg');

        // Determine file extension and destination
        // We convert everything non-SVG to WebP for optimization
        const ext = isSvg ? '.svg' : '.webp';

        // Generate filename from hash of URL
        const hash = crypto.createHash('md5').update(imageUrl).digest('hex');
        const destination = `${folder}/${hash}${ext}`;
        const file = firebase.bucket.file(destination);

        // Check if file already exists
        const [exists] = await file.exists();
        if (exists) {
            return `https://storage.googleapis.com/${firebase.bucket.name}/${destination}`;
        }

        // Prepare upload stream
        const uploadStream = file.createWriteStream({
            metadata: {
                contentType: isSvg ? 'image/svg+xml' : 'image/webp',
                cacheControl: 'public, max-age=31536000' // aggressive caching for immutable hashed files
            },
            resumable: false,
            public: true
        });

        if (isSvg) {
            // Passthrough for SVG (we can't optimize SVG buffers easily with sharp like this without altering structure, so passthrough is safe)
            await streamPipeline(response.data, uploadStream);
        } else {
            // Optimization pipeline
            const opts = getOptimizationOptions(folder);
            const transform = sharp()
                .resize({
                    width: opts.width,
                    withoutEnlargement: true,
                    fit: 'inside'
                })
                .webp({ quality: opts.quality, effort: 6 });

            try {
                await streamPipeline(response.data, transform, uploadStream);
            } catch (pErr) {
                console.error(`Error during stream pipeline for ${imageUrl} (Type: ${contentType}):`, pErr.message);
                return null;
            }
        }

        return `https://storage.googleapis.com/${firebase.bucket.name}/${destination}`;

    } catch (error) {
        // Suppress generic 404/403 errors to avoid log spam, simply return null
        if (error.response && (error.response.status === 404 || error.response.status === 403)) {
            // console.warn(`Failed to cache image (HTTP ${error.response.status}): ${imageUrl}`);
            return null;
        }
        console.error(`Error fetching image ${imageUrl}:`, error.message);
        return null;
    }
};


/**
 * Upload an image buffer directly to Firebase Storage, with local fallback
 * @param {Buffer} buffer - The image buffer
 * @param {string} mimeType - The mime type of the file
 * @param {string} folder - Folder in bucket
 * @returns {Promise<string>} - The public URL
 */
const uploadImageBuffer = async (buffer, mimeType, folder = 'manual_uploads') => {
    let finalBuffer = buffer;
    let finalMimeType = mimeType;
    let ext = '.jpg';

    if (mimeType === 'image/png') ext = '.png';
    if (mimeType === 'image/gif') ext = '.gif';
    if (mimeType === 'image/webp') ext = '.webp';
    if (mimeType === 'image/svg+xml') ext = '.svg';

    try {
        if (!mimeType.includes('svg')) {
            const opts = getOptimizationOptions(folder);
            finalBuffer = await sharp(buffer)
                .resize({
                    width: opts.width,
                    withoutEnlargement: true,
                    fit: 'inside'
                })
                .webp({ quality: opts.quality, effort: 6 })
                .toBuffer();
            finalMimeType = 'image/webp';
            ext = '.webp';
        }

        const hash = crypto.createHash('md5').update(finalBuffer).digest('hex');
        const filename = `${hash}${ext}`;
        const destination = `${folder}/${filename}`;
        const file = firebase.bucket.file(destination);

        await file.save(finalBuffer, {
            metadata: {
                contentType: finalMimeType,
                cacheControl: 'public, max-age=31536000'
            },
            public: true,
            resumable: false
        });

        return `https://storage.googleapis.com/${firebase.bucket.name}/${destination}`;
    } catch (error) {
        console.error('Error uploading image buffer to Firebase, falling back to local storage:', error.message);

        const hash = crypto.createHash('md5').update(finalBuffer).digest('hex');
        const filename = `${hash}${ext}`;
        // Local Fallback
        const localPath = path.join(UPLOADS_DIR, filename);
        fs.writeFileSync(localPath, finalBuffer);

        return `/uploads/${filename}`;
    }
};

module.exports = {
    cacheImage,
    uploadImageBuffer
};
