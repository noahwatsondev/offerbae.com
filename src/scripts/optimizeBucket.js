require('dotenv').config({ override: true });
const firebaseAdmin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const rootSA = path.join(__dirname, '../../service-account.json');
const initOptions = {
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'offerbae-com.firebasestorage.app',
    projectId: process.env.GCP_PROJECT_ID || 'offerbae-com'
};
if (fs.existsSync(rootSA)) {
    initOptions.credential = firebaseAdmin.credential.cert(rootSA);
}
firebaseAdmin.initializeApp(initOptions);

const firebase = require('../config/firebase');

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
        quality = 85;
    }

    return { width, quality };
};

async function optimizeBucket() {
    console.log('Fetching files from bucket...');
    const [files] = await firebase.bucket.getFiles();
    console.log(`Found ${files.length} files in bucket. Filtering for images...`);

    // Filter out SVGs and non-images
    const imageFiles = files.filter(file => {
        const ext = file.name.split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
    });

    console.log(`${imageFiles.length} image files to process.`);

    let processedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Process in batches
    const batchSize = 50; // Increased to 50 for faster throughput
    for (let i = 0; i < imageFiles.length; i += batchSize) {
        const batch = imageFiles.slice(i, i + batchSize);
        await Promise.all(batch.map(async (file) => {
            try {
                // Get folder to determine optimization options
                const folder = file.name.split('/')[0] || '';
                const opts = getOptimizationOptions(folder);

                // Download the file
                const [buffer] = await file.download();

                // Optimize with sharp
                // we'll strip metadata, resize, and compress as WebP
                // keeping the same filename extension for ease, but content type as webp if we want?
                // Actually, if we change the format to WebP, we might as well just save it as WebP,
                // but if the URL has .jpg, we MUST keep the same object name!
                // So the object name represents the URL. We can serve WebP content with a .jpg filename.
                const optimizedBuffer = await sharp(buffer)
                    .resize({
                        width: opts.width,
                        withoutEnlargement: true,
                        fit: 'inside'
                    })
                    .webp({ quality: opts.quality, effort: 6 })
                    .toBuffer();

                // If optimized is smaller or same size, upload it
                // Note: we can upload WebP bytes to the existing blob.
                if (optimizedBuffer.length < buffer.length) {
                    await file.save(optimizedBuffer, {
                        metadata: {
                            contentType: 'image/webp', // Update content type
                            cacheControl: 'public, max-age=31536000'
                        },
                        public: true, // Make sure it stays public
                        resumable: false
                    });
                    processedCount++;
                    // console.log(`Optimized: ${file.name} - Saved ${(buffer.length - optimizedBuffer.length) / 1024} KB`);
                } else {
                    // Make sure it's public and cache is set anyway
                    await file.setMetadata({
                        cacheControl: 'public, max-age=31536000'
                    });
                    await file.makePublic();
                    skippedCount++;
                }

            } catch (err) {
                errorCount++;
                console.error(`Error processing ${file.name}:`, err.message);
            }
        }));

        // Log occasionally
        if ((i + batchSize) % 1000 === 0 || i + batchSize >= imageFiles.length) {
            console.log(`Processed ${i + batch.length}/${imageFiles.length} files... (Optimized: ${processedCount}, Skipped: ${skippedCount}, Errors: ${errorCount})`);
        }
    }

    console.log(`\nOptimization complete!`);
    console.log(`Processed: ${processedCount}`);
    console.log(`Skipped (already optimized/smaller): ${skippedCount}`);
    console.log(`Errors: ${errorCount}`);
}

optimizeBucket().then(() => {
    process.exit(0);
}).catch(console.error);
