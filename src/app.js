const express = require('express');
const path = require('path');
const config = require('./config/env');
const dashboardController = require('./controllers/dashboardController');
const productController = require('./controllers/productController');
const cron = require('node-cron');
const dataSync = require('./services/dataSync');
const firebaseAdmin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const fs = require('fs');
require('dotenv').config();

// --- CRITICAL DEPLOYMENT FIX ---
// If running on Render (or anywhere without a file), write the JSON env var to a temp file
// so that BOTH Google Secret Manager AND Firebase Admin can use standard ADC.
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    try {
        const tempPath = '/tmp/service-account.json';
        fs.writeFileSync(tempPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = tempPath;
        console.log(`[DEPLOY] Wrote identity to ${tempPath} and set GOOGLE_APPLICATION_CREDENTIALS`);
    } catch (e) {
        console.error('[DEPLOY] Failed to write temp service account file:', e);
    }
}

const app = express();

app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// --- Google Cloud Secret Manager Client (Lazy Loaded) ---
let secretManagerClient;

const getSecretClient = () => {
    if (!secretManagerClient) {
        // Ensure env var is set before instantiation if we just wrote the file
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
            console.warn('[WARN] GOOGLE_APPLICATION_CREDENTIALS set but file missing!');
        }

        const clientOptions = process.env.GCP_PROJECT_ID ? { projectId: process.env.GCP_PROJECT_ID } : {};

        // Explicitly pass keyFiilename for Render support
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            clientOptions.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        }

        secretManagerClient = new SecretManagerServiceClient(clientOptions);
    }
    return secretManagerClient;
};

// --- Helper function to get a secret from Secret Manager ---
const getSecret = async (name) => {
    // 1. Prefer Env Var (Fastest, avoids API calls, fixes Render crash)
    if (process.env[name]) {
        return process.env[name];
    }

    // 2. Fallback to Secret Manager
    const projectId = process.env.GCP_PROJECT_ID;
    if (!projectId) {
        return undefined;
    }
    try {
        const client = getSecretClient();
        const [version] = await client.accessSecretVersion({
            name: `projects/${projectId}/secrets/${name}/versions/latest`,
        });
        return version.payload.data.toString('utf8').trim();
    } catch (e) {
        console.warn(`[WARN] Secret '${name}' not found or access denied. Using env var if available.`);
        if (process.env[name]) return process.env[name];
        return undefined;
    }
};

// --- App Initialization ---
const initializeApp = async () => {
    try {
        console.log("Attempting to load configuration...");

        // --- STEP 1: Load Firebase Creds ---
        let serviceAccount;

        // Try local file first (for local dev environments)
        const fs = require('fs');
        const localKeyPath = path.join(__dirname, '../service-account.json'); // Adjusted path to root

        if (fs.existsSync(localKeyPath)) {
            console.log('[DEBUG] Found local service-account.json, using it.');
            serviceAccount = require(localKeyPath);
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
            // Support raw JSON in Env Var for Render/Heroku
            console.log('[DEBUG] Found GOOGLE_APPLICATION_CREDENTIALS_JSON env var.');
            try {
                serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
            } catch (e) {
                console.error('[ERROR] Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON', e);
            }
        } else {
            // Try Secret Manager
            try {
                const firebaseKey = await getSecret('FIREBASE_SERVICE_ACCOUNT_KEY');
                if (firebaseKey && firebaseKey.length > 100) {
                    serviceAccount = JSON.parse(firebaseKey);
                }
            } catch (e) {
                console.log("No FIREBASE_SERVICE_ACCOUNT_KEY secret found or accessible, using ADC or existing env.");
            }
        }

        const initOptions = {
            projectId: 'offerbae-com', // Hardcoded for debugging
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'offerbae-com.firebasestorage.app'
        };

        console.log('[DEBUG] initOptions:', JSON.stringify({ ...initOptions, credential: '...redacted...' }));

        if (serviceAccount) {
            console.log(`[DEBUG] Initializing Firebase with Service Account: ${serviceAccount.client_email}`);
            initOptions.credential = firebaseAdmin.credential.cert(serviceAccount);
            if (!firebaseAdmin.apps.length) {
                firebaseAdmin.initializeApp(initOptions);
            }
        } else {
            if (!firebaseAdmin.apps.length) {
                console.log("[DEBUG] Initializing Firebase with Application Default Credentials/Env");
                firebaseAdmin.initializeApp(initOptions);
            }
        }

        console.log("Firebase Admin SDK initialized successfully.");

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
            'BRANDFETCH_API_KEY': 'BRANDFETCH_API_KEY'
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
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: http:; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https: http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*;");
    next();
});

// Silence favicon.ico 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

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
app.get('/', dashboardController.getHomepage); // Use getHomepage
app.get('/mission-control/architecture', dashboardController.getArchitecture);
app.get('/mission-control/style', dashboardController.getStyle);
app.post('/mission-control/style', (req, res, next) => {
    console.log('DEBUG: Hit /mission-control/style route');
    next();
}, dashboardController.uploadStyleMiddleware, dashboardController.updateStyle);
app.post('/refresh', dashboardController.refreshData);
app.get('/api/advertiser/:id/products', dashboardController.getAdvertiserProducts);
app.get('/api/advertiser/:id/products', dashboardController.getAdvertiserProducts);
app.get('/api/advertiser/:id/offers', dashboardController.getAdvertiserOffers);
// Logo Upload & Reset Routes
app.post('/api/advertiser/:id/logo/upload', dashboardController.uploadLogoMiddleware, dashboardController.uploadLogo);
app.post('/api/advertiser/:id/logo/reset', dashboardController.resetLogo);
app.post('/api/advertiser/:id/homelink', express.json(), dashboardController.updateHomeLink);
console.log('Registering /api/proxy-image route');
app.get('/api/proxy-image', dashboardController.proxyImage);
app.get('/api/debug/fyrelux', dashboardController.debugFyreLux);
app.get('/mission-control', dashboardController.getDashboardData);

// Initialize and Start Server
initializeApp().then(() => {
    // Schedule task to run every 2 hours
    cron.schedule('0 */2 * * *', () => {
        console.log('CRON: Starting scheduled data sync...');
        dataSync.syncAll();
    });

    app.listen(config.port, () => {
        console.log(`Server running at http://localhost:${config.port}`);
    });
});
