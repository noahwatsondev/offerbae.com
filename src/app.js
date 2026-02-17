const express = require('express');
const path = require('path');
const config = require('./config/env');
const dashboardController = require('./controllers/dashboardController');
const productController = require('./controllers/productController');
const cron = require('node-cron');
const dataSync = require('./services/dataSync');
const firebaseAdmin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config({ override: true });

console.log('[DEBUG-ENV] Available Env Vars:', Object.keys(process.env).join(', '));

const app = express();

app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// --- Helper function to get a secret (Env Var Only) ---
// We have removed Google Secret Manager to strictly rely on Environment Variables
// which provides better stability on platforms like Render.
const getSecret = (name) => {
    if (process.env[name]) {
        return process.env[name];
    }
    return undefined;
};

// --- App Initialization ---
const initializeApp = async () => {
    try {
        console.log("Attempting to load configuration...");

        // --- STEP 1: Load Firebase Creds ---
        // We rely on standard GOOGLE_APPLICATION_CREDENTIALS env var pointing to a file.
        // On Render, this points to /etc/secrets/service-account.json
        // On Local, it might point to ./service-account.json or be undefined.

        // Debug logging
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            console.log(`[DEBUG] GOOGLE_APPLICATION_CREDENTIALS is set to: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
        } else {
            console.log('[DEBUG] GOOGLE_APPLICATION_CREDENTIALS is NOT set. Firebase might fail if not on GCP.');
        }

        // Helper to strip quotes if present
        const cleanStr = (s) => s ? s.replace(/^["']|["']$/g, '').trim() : s;

        const rootSA = path.join(__dirname, '../service-account.json');
        let projectId = cleanStr(process.env.GCP_PROJECT_ID);

        // Force correct project ID if incorrectly set in environment
        if (projectId === 'wide-graph-464200-d7') {
            console.log(`[WARN] Stale Project ID detected. Overriding with 'offerbae-com'.`);
            projectId = 'offerbae-com';
        }

        const storageBucket = cleanStr(process.env.FIREBASE_STORAGE_BUCKET) || 'offerbae-com.firebasestorage.app';

        const initOptions = {
            storageBucket: storageBucket,
            projectId: projectId || 'offerbae-com'
        };

        // If local service-account.json exists, use it as it's the verified credential for offerbae-com
        if (fs.existsSync(rootSA)) {
            console.log(`[DEBUG] Found local service-account.json at ${rootSA}. Using for initialization.`);
            initOptions.credential = firebaseAdmin.credential.cert(rootSA);
        }

        if (!firebaseAdmin.apps.length) {
            console.log(`[DEBUG] Initializing Firebase Admin SDK with options:`, JSON.stringify(initOptions));
            const app = firebaseAdmin.initializeApp(initOptions);
            console.log(`[DEBUG] Firebase initialized. Project ID from Options: ${app.options.projectId || 'Auto-Detected'}`);
            console.log("Firebase Admin SDK initialized successfully.");
        }

        // --- STEP 2: Load API credentials ---
        const secretsMap = {
            'RAKUTEN_CLIENT_ID': 'RAKUTEN_CLIENT_ID',
            'RAKUTEN_CLIENT_SECRET': 'RAKUTEN_CLIENT_SECRET',
            'RAKUTEN_SITE_ID': 'RAKUTEN_SITE_ID',
            'CJ_PERSONAL_ACCESS_TOKEN': 'CJ_PERSONAL_ACCESS_TOKEN',
            'CJ_COMPANY_ID': 'CJ_COMPANY_ID',
            'CJ_WEBSITE_ID': 'CJ_WEBSITE_ID',
            'AWIN_ACCESS_TOKEN': 'AWIN_ACCESS_TOKEN',
            'AWIN_PUBLISHER_ID': 'AWIN_PUBLISHER_ID',
            'BRANDFETCH_API_KEY': 'BRANDFETCH_API_KEY',
            'PEPPERJAM_API_KEY': 'PEPPERJAM_API_KEY'
        };

        for (const [secretName, envName] of Object.entries(secretsMap)) {
            const val = await getSecret(secretName);
            if (val) {
                process.env[envName] = val;
            }
        }

        console.log('API credentials loaded and environment configured.');

    } catch (error) {
        console.error("Error initializing app:", error.message);
    }
};


// View Engine Setup
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'ejs');
app.set('view cache', false); // Disable view caching

// Global Cache-Control Middleware
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    // Enhanced CSP for local development stability and devtools compatibility
    res.set('Content-Security-Policy', "default-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*;");
    next();
});

// Favicon Routing
app.get('/favicon.ico', (req, res) => res.redirect('/favicon.png'));

// Chrome DevTools Connectivity
app.all('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
    res.status(200).json({ ok: true });
});

// Static Files
app.use(express.static(path.join(__dirname, '../public'), {
    etag: false,
    lastModified: false
}));

// Explicit manual sync route for debugging/triggering
app.get('/update/full-sync', async (req, res) => {
    try {
        await dataSync.syncAll();
        res.send('Sync initiated. Check server logs.');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for CJ only
app.get('/update/cj-sync', async (req, res) => {
    try {
        // Run in background, don't await
        dataSync.syncCJAll().catch(e => console.error(e));
        res.send('CJ Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for Rakuten only
app.get('/update/rakuten-sync', async (req, res) => {
    try {
        dataSync.syncRakutenAll().catch(e => console.error(e));
        res.send('Rakuten Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for AWIN only
app.get('/update/awin-sync', async (req, res) => {
    try {
        dataSync.syncAWINAll().catch(e => console.error(e));
        res.send('AWIN Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Explicit manual sync route for Pepperjam only
app.get('/update/pepperjam-sync', async (req, res) => {
    try {
        dataSync.syncPepperjamAll().catch(e => console.error(e));
        res.send('Pepperjam Sync Started');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Sync Status & History API
app.get('/api/sync-status', (req, res) => {
    res.json(dataSync.getGlobalSyncState());
});

app.get('/api/sync-history/:network', async (req, res) => {
    try {
        const history = await dataSync.getSyncHistory(req.params.network);
        res.json(history);
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// Routes
// Routes
// Routes
app.get('/', dashboardController.getNewHomepage);
app.get('/mission-control/architecture', dashboardController.getArchitecture);
app.get('/mission-control/style', dashboardController.getStyle);
app.post('/mission-control/style', (req, res, next) => {
    console.log('DEBUG: Hit /mission-control/style route');
    next();
}, dashboardController.uploadStyleMiddleware, dashboardController.updateStyle);
app.post('/refresh', dashboardController.refreshData);
app.get('/api/advertiser/:id/products', dashboardController.getAdvertiserProducts);
app.get('/api/advertiser/:id/offers', dashboardController.getAdvertiserOffers);
// Logo Upload & Reset Routes
app.post('/api/advertiser/:id/logo/upload', dashboardController.uploadLogoMiddleware, dashboardController.uploadLogo);
app.post('/api/advertiser/:id/logo/reset', dashboardController.resetLogo);
app.post('/api/advertiser/:id/homelink', express.json(), dashboardController.updateHomeLink);
app.post('/api/advertiser/:id/description', express.json(), dashboardController.updateDescription);
app.get('/api/products/search', dashboardController.globalProductSearch);
app.get('/api/proxy-image', dashboardController.proxyImage);
app.get('/mission-control', dashboardController.getDashboardData);

// SEO & Catalog Routes (Must be last to avoid catching specific routes)
app.get('/brands', dashboardController.getHomepage);
app.get('/brand/:idSlug', productController.getCatalogPage);
app.get('/categories', productController.getCategoriesPage);
app.get('/category/:slug', productController.getCategoryPage);
app.get('/offers', productController.getOffersListPage);
app.get('/offer/:brandSlug/:idSlug', productController.getOfferDetailPage);
app.get('/products', productController.getProductsListPage);
app.get('/product/:brandSlug/:idSlug', productController.getProductDetail);
app.get('/calendar', productController.getCalendarListPage);
app.get('/calendar/:slug', productController.getCalendarEventPage);
app.get('/journal', productController.getJournalListPage);
app.get('/journal/:slug', productController.getJournalArticlePage);

// Export the new controller function if it's not already exported
// Note: We need to make sure globalProductSearch is in the exports of dashboardController.js


// 404 Handler
app.use((req, res) => {
    res.status(404).render('404', { message: "We couldn't find what you were looking for.", pageH1: 'Not Found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('GLOBAL ERROR:', err);
    res.status(500).render('404', { message: "Internal Server Error: " + err.message, pageH1: 'Error' });
});

// Initialize and Start Server
initializeApp().then(() => {
    // Schedule task to run every 4 hours
    cron.schedule('0 */4 * * *', () => {
        console.log('CRON: Starting scheduled data sync...');
        dataSync.syncAll();
    });

    app.listen(config.port, () => {
        console.log(`Server running at http://localhost:${config.port}`);
    });
});
