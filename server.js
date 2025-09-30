// server.js
// This file focuses on fetching partnered advertisers/products and storing them in Firebase Firestore.
// It uses Secret Manager for credentials and falls back to environment variables.

require('dotenv').config();
const express = require('express');
const firebaseAdmin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const dataSync = require('./src/services/dataSync');
// Initialize Firebase via config (lazy load happens on first access if not initialized here, 
// but we want to initialize explicitly to load secrets first)
const firebaseConfig = require('./src/config/firebase');

const path = require('path');

// --- Google Cloud Secret Manager Client ---
const clientOptions = process.env.GCP_PROJECT_ID ? { projectId: process.env.GCP_PROJECT_ID } : {};
const client = new SecretManagerServiceClient(clientOptions);

// --- Helper function to get a secret from Secret Manager ---
const getSecret = async (name) => {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) {
    // Fallback to existing env if GCP_PROJECT_ID is not set (local dev without GCP context)
    if (process.env[name]) return process.env[name];
    // If critical and missing, we might throw, but let's return undefined and let caller handle
    return undefined;
  }

  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${name}/versions/latest`,
    });
    return version.payload.data.toString('utf8').trim();
  } catch (e) {
    console.warn(`[WARN] Secret '${name}' not found in Secret Manager or access denied. Using env var if available.`);
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
    const localKeyPath = path.join(__dirname, 'service-account.json');

    if (fs.existsSync(localKeyPath)) {
      console.log('[DEBUG] Found local service-account.json, using it.');
      serviceAccount = require(localKeyPath);
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
      projectId: process.env.GCP_PROJECT_ID
    };

    if (serviceAccount) {
      console.log(`[DEBUG] Initializing Firebase with Service Account: ${serviceAccount.client_email}`);
      initOptions.credential = firebaseAdmin.credential.cert(serviceAccount);
      // Check if already initialized to avoid error
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

    // --- STEP 2: Load API credentials and set to process.env for services ---
    // Just ensuring they are present for the services that rely on process.env
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
      } else if (!process.env[envName]) {
        console.warn(`[WARN] Missing configuration: ${envName} is not set in Secrets or .env`);
      }
    }

    console.log('API credentials loaded and environment configured.');

  } catch (error) {
    console.error("Error initializing app:", error.message);
  }
};

// --- Express Server Setup ---
const app = express();
const PORT = process.env.PORT || 8080;

// Simple HTML page
const htmlPage = (advertisersTable, count) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OfferBae Admin</title>
    <style>
        body { font-family: 'Inter', sans-serif; padding: 20px; background: #f8fafc; color: #1e293b; text-align: center; }
        .container { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-bottom: 2rem; }
        button { padding: 10px 20px; margin: 5px; cursor: pointer; background: #4f46e5; color: white; border: none; border-radius: 6px; }
        button#fullSyncButton { background-color: #ea580c; }
        button:hover { transform: translateY(-1px); }
        #message { margin-top: 1rem; padding: 1rem; background: #ea580c05; border-radius: 8px; font-family: monospace; white-space: pre-wrap; word-break: break-all; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background: white; }
        th, td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
        th { background: #f1f5f9; position: sticky; top: 0; }
        .status-active { color: #10b981; font-weight: bold; }
        img.logo { height: 30px; width: auto; object-fit: contain; }
    </style>
</head>
<body>
    <div class="container">
        <h1>OfferBae Data Sync</h1>
        <div>
            <button id="btnRakuten">Update Rakuten</button>
            <button id="btnCJ">Update CJ</button>
            <button id="btnAWIN">Update AWIN</button>
            <button id="fullSyncButton">Full Sync</button>
        </div>
        <div id="message"></div>
    </div>
    <div class="container">
        <h2>Advertisers (${count})</h2>
        <table>
            <thead><tr><th>Logo</th><th>Network</th><th>Name</th><th>Status</th></tr></thead>
            <tbody>
                ${advertisersTable}
            </tbody>
        </table>
    </div>
    <script>
        const msg = document.getElementById('message');
        const callApi = async (url) => {
            msg.textContent = 'Processing... check server logs for details.';
            try {
                const res = await fetch(url);
                const data = await res.json();
                msg.textContent = JSON.stringify(data, null, 2);
                if(data.success) setTimeout(() => window.location.reload(), 2000);
            } catch (e) {
                msg.textContent = 'Error: ' + e.message;
            }
        };
        document.getElementById('btnRakuten').onclick = () => callApi('/update/rakuten');
        document.getElementById('btnCJ').onclick = () => callApi('/update/cj');
        document.getElementById('btnAWIN').onclick = () => callApi('/update/awin');
        document.getElementById('fullSyncButton').onclick = () => callApi('/update/full-sync');
    </script>
</body>
</html>
`;

// --- Routes ---

app.get('/update/rakuten', async (req, res) => {
  try {
    const result = await dataSync.syncRakutenAdvertisers();
    res.json({ success: true, count: result.length, message: "Rakuten Advertisers Synced" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/update/cj', async (req, res) => {
  try {
    const result = await dataSync.syncCJAdvertisers();
    res.json({ success: true, count: result.length, message: "CJ Advertisers Synced" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/update/awin', async (req, res) => {
  try {
    const result = await dataSync.syncAWINAdvertisers();
    res.json({ success: true, count: result.length, message: "AWIN Advertisers Synced" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/update/full-sync', async (req, res) => {
  try {
    await dataSync.syncAll();
    res.json({ success: true, message: "Full Sync Completed (Advertisers + Products)" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/', async (req, res) => {
  try {
    // Access lazy db property
    const db = firebaseConfig.db;
    const snapshot = await db.collection('advertisers').orderBy('name').get();
    let rows = '';
    snapshot.forEach(doc => {
      const d = doc.data();
      rows += `<tr>
                <td>${d.logoUrl ? `<img src="${d.logoUrl}" class="logo">` : ''}</td>
                <td>${d.network}</td>
                <td><a href="${d.url || '#'}" target="_blank">${d.name}</a></td>
                <td class="${d.status === 'active' || d.status === 'joined' ? 'status-active' : ''}">${d.status}</td>
            </tr>`;
    });
    res.send(htmlPage(rows, snapshot.size));
  } catch (e) {
    res.send(`Error loading dashboard: ${e.message}<br><br>Check server logs for initialization errors.`);
  }
});

// Start Server
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});