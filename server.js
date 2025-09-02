// server.js
// This file sets up a Node.js server to fetch partnered advertisers from Rakuten, Commission Junction, and AWIN
// and store them in a Firebase Firestore database.

require('dotenv').config();
const express = require('express');
const firebaseAdmin = require('firebase-admin');
const axios = require('axios');
const { Parser } = require('xml2js');
const btoa = require('btoa');
const path = require('path');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// --- Google Cloud Secret Manager Client ---
const client = new SecretManagerServiceClient();

// --- Helper function to get a secret from Secret Manager ---
const getSecret = async (name) => {
  // GCP_PROJECT_ID should be set as an environment variable (e.g., in .env file)
  const [version] = await client.accessSecretVersion({
    name: `projects/${process.env.GCP_PROJECT_ID}/secrets/${name}/versions/latest`,
  });
  return version.payload.data.toString('utf8');
};

// --- API Credentials ---
let RAKUTEN_CLIENT_ID, RAKUTEN_CLIENT_SECRET, RAKUTEN_SITE_ID;
let CJ_PERSONAL_ACCESS_TOKEN, CJ_COMPANY_ID;
let AWIN_ACCESS_TOKEN, AWIN_PUBLISHER_ID;

// --- Firebase Initialization ---
let db;
const initializeApp = async () => {
  try {
    const firebaseKey = await getSecret('FIREBASE_SERVICE_ACCOUNT_KEY');
    const serviceAccount = JSON.parse(firebaseKey);
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized successfully.");
    db = firebaseAdmin.firestore();

    // Now, load the other API credentials
    RAKUTEN_CLIENT_ID = await getSecret('RAKUTEN_CLIENT_ID');
    RAKUTEN_CLIENT_SECRET = await getSecret('RAKUTEN_CLIENT_SECRET');
    RAKUTEN_SITE_ID = await getSecret('RAKUTEN_SITE_ID');
    CJ_PERSONAL_ACCESS_TOKEN = await getSecret('CJ_PERSONAL_ACCESS_TOKEN');
    CJ_COMPANY_ID = await getSecret('CJ_COMPANY_ID');
    AWIN_ACCESS_TOKEN = await getSecret('AWIN_ACCESS_TOKEN');
    AWIN_PUBLISHER_ID = await getSecret('AWIN_PUBLISHER_ID');

    console.log('All API credentials loaded from Secret Manager.');

  } catch (error) {
    console.error("Error initializing app or loading secrets:", error.message);
    process.exit(1); // Exit if critical initialization fails
  }
};

// --- XML Parser setup for Commission Junction response ---
const xmlParser = new Parser({
  explicitArray: false,
  ignoreAttrs: true,
});

// --- Function to fetch Rakuten access token ---
const getRakutenToken = async () => {
  if (!RAKUTEN_CLIENT_ID || !RAKUTEN_CLIENT_SECRET || !RAKUTEN_SITE_ID) {
    throw new Error('Rakuten API credentials are not loaded.');
  }

  try {
    const tokenKey = btoa(`${RAKUTEN_CLIENT_ID}:${RAKUTEN_CLIENT_SECRET}`);
    const response = await axios.post(
      'https://api.linksynergy.com/token',
      `scope=${RAKUTEN_SITE_ID}`,
      {
        headers: {
          'Authorization': `Bearer ${tokenKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (!response.data || !response.data.access_token) {
      throw new Error(`Rakuten token response missing access_token: ${JSON.stringify(response.data)}`);
    }

    return response.data.access_token;
  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    throw new Error(`Failed to get Rakuten access token. Details: ${errorMessage}`);
  }
};

// --- Function to fetch all Rakuten partnerships ---
const fetchRakutenPartnerships = async () => {
  const allPartnerships = [];
  let page = 1;
  const limit = 200; // Max allowed by API
  let token;
  try {
    token = await getRakutenToken();
  } catch (error) {
    console.error(error.message);
    return { success: false, data: [], message: error.message };
  }

  try {
    while (true) {
      console.log(`Fetching Rakuten partnerships, page ${page}...`);
      const response = await axios.get(
        `https://api.linksynergy.com/v1/partnerships?partner_status=active&limit=${limit}&page=${page}`, {
          headers: {
            'Authorization': `Bearer ${token.trim()}`,
            'Accept': 'application/json'
          }
        }
      );

      const partnerships = response.data.partnerships;
      if (!partnerships || partnerships.length === 0) {
        break;
      }

      allPartnerships.push(...partnerships);
      page++;

      const totalPages = Math.ceil(response.data._metadata.total / limit);
      if (page > totalPages) {
        break;
      }
    }

    const formattedData = allPartnerships.map(p => ({
      id: p.advertiser.id,
      name: p.advertiser.name,
      network: 'Rakuten',
      status: p.status,
      categories: p.advertiser.categories
    }));

    return {
      success: true,
      data: formattedData,
      message: `Successfully fetched ${formattedData.length} advertisers.`
    };

  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('Error fetching Rakuten data:', errorMessage);
    return { success: false, data: [], message: `Error fetching data from Rakuten API: ${errorMessage}` };
  }
};

// --- Function to fetch all Commission Junction (CJ) advertisers ---
const fetchCJPartnerships = async () => {
  const allAdvertisers = [];
  const recordsPerPage = 100; // Max allowed by API
  let pageNumber = 1;

  if (!CJ_PERSONAL_ACCESS_TOKEN || !CJ_COMPANY_ID) {
    const message = 'Commission Junction API credentials are not set in environment variables.';
    console.error(message);
    return { success: false, data: [], message: message };
  }

  try {
    while (true) {
      console.log(`Fetching CJ advertisers, page ${pageNumber}...`);
      const response = await axios.get(
        `https://advertiser-lookup.api.cj.com/v2/advertiser-lookup?requestor-cid=${CJ_COMPANY_ID}&advertiser-ids=joined&records-per-page=${recordsPerPage}&page-number=${pageNumber}`, {
          headers: {
            'Authorization': `Bearer ${CJ_PERSONAL_ACCESS_TOKEN.trim()}`
          }
        }
      );
      
      const xmlData = response.data;
      const result = await xmlParser.parseStringPromise(xmlData);

      const advertisers = result['cj-api']['advertisers']['advertiser'];

      if (!advertisers || (Array.isArray(advertisers) && advertisers.length === 0)) {
        break; // No more pages
      }
      
      const advertiserList = Array.isArray(advertisers) ? advertisers : [advertisers];
      allAdvertisers.push(...advertiserList);

      const totalMatched = parseInt(result['cj-api']['advertisers']['total-matched'], 10);
      const recordsReturned = parseInt(result['cj-api']['advertisers']['records-returned'], 10);

      if (recordsReturned < recordsPerPage) {
        break;
      }
      pageNumber++;
    }

    const formattedData = allAdvertisers.map(a => ({
      id: a['advertiser-id'],
      name: a['advertiser-name'],
      network: 'Commission Junction',
      status: a['relationship-status'],
      categories: a['primary-category'] ? (Array.isArray(a['primary-category']) ? a['primary-category'] : [a['primary-category']]) : []
    }));

    return {
      success: true,
      data: formattedData,
      message: `Successfully fetched ${formattedData.length} advertisers.`
    };
  } catch (error) {
    console.error('Error fetching CJ data:', error.message);
    return { success: false, data: [], message: `Error fetching data from CJ API: ${error.message}` };
  }
};

// --- Function to fetch all AWIN Programmes ---
const fetchAWINProgrammes = async () => {
  if (!AWIN_ACCESS_TOKEN || !AWIN_PUBLISHER_ID) {
    const message = 'AWIN API credentials (AWIN_ACCESS_TOKEN, AWIN_PUBLISHER_ID) are not set in environment variables.';
    console.error(message);
    return { success: false, data: [], message: message };
  }

  try {
    console.log('Fetching AWIN programmes...');
    const response = await axios.get(
      `https://api.awin.com/publishers/${AWIN_PUBLISHER_ID}/programmes?relationship=joined`, {
        headers: {
          'Authorization': `Bearer ${AWIN_ACCESS_TOKEN.trim()}`,
          'Accept': 'application/json'
        }
      }
    );

    const programmes = response.data;
    
    const formattedData = programmes.map(p => ({
      id: p.id,
      name: p.name,
      network: 'AWIN',
      status: p.status,
      categories: p.primarySector ? [p.primarySector] : []
    }));

    return {
      success: true,
      data: formattedData,
      message: `Successfully fetched ${formattedData.length} programmes.`
    };

  } catch (error) {
    const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('Error fetching AWIN data:', errorMessage);
    return { success: false, data: [], message: `Error fetching data from AWIN API: ${errorMessage}` };
  }
};

// --- Helper function to save a batch of data to Firestore ---
const saveToFirestore = async (data) => {
  if (data.length === 0) {
    return { savedCount: 0, status: 'no-data', message: 'No advertisers to save.' };
  }
  try {
    const batch = db.batch();
    const advertisersRef = db.collection('advertisers');
    
    for (const advertiser of data) {
      const docRef = advertisersRef.doc(`${advertiser.network}-${advertiser.id}`);
      batch.set(docRef, advertiser);
    }

    await batch.commit();
    console.log(`Successfully saved ${data.length} advertisers to Firestore.`);
    return { savedCount: data.length, status: 'success', message: 'Data saved successfully.' };
  } catch (error) {
    const errorMessage = `An error occurred while saving to Firestore: ${error.message}`;
    console.error(errorMessage);
    return { savedCount: 0, status: 'error', message: errorMessage };
  }
};

// --- Master function to update all data in Firestore (for automated sync) ---
const updateAllAdvertisers = async () => {
  console.log('Starting automated data update...');
  
  const rakutenResult = await fetchRakutenPartnerships();
  const cjResult = await fetchCJPartnerships();
  const awinResult = await fetchAWINProgrammes();

  const allPartners = [...rakutenResult.data, ...cjResult.data, ...awinResult.data];
  
  const saveResult = await saveToFirestore(allPartners);

  return {
    status: saveResult.status,
    message: saveResult.message,
    rakuten: {
      count: rakutenResult.data.length,
      success: rakutenResult.success,
      message: rakutenResult.message
    },
    cj: {
      count: cjResult.data.length,
      success: cjResult.success,
      message: cjResult.message
    },
    awin: {
      count: awinResult.data.length,
      success: awinResult.success,
      message: awinResult.message
    },
    totalSaved: saveResult.savedCount
  };
};

// --- Express Server Setup ---
const app = express();
const PORT = process.env.PORT || 3000;

// Simple HTML page to serve
const htmlPage = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Affiliate Advertiser Updater</title>
    <style>
        body {
            font-family: sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background-color: #f0f4f8;
            color: #333;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        h1 {
            color: #1a202c;
        }
        .brands-section {
            margin-top: 2rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            align-items: center;
        }
        .brands-section button {
            width: 250px;
        }
        button {
            padding: 12px 24px;
            font-size: 1rem;
            cursor: pointer;
            border: none;
            border-radius: 8px;
            background-color: #4299e1;
            color: white;
            transition: background-color 0.3s, transform 0.2s;
        }
        button:hover {
            background-color: #3182ce;
            transform: translateY(-2px);
        }
        #message {
            margin-top: 1rem;
            font-family: monospace;
            background-color: #e2e8f0;
            padding: 1rem;
            border-radius: 8px;
            white-space: pre-wrap;
            text-align: left;
            max-width: 600px;
        }
        .success { color: green; }
        .error { color: red; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Affiliate Advertiser Data Sync</h1>
        <p>Manually update partnered advertisers by clicking the buttons below.</p>
        <div class="brands-section">
            <h2>Brands</h2>
            <button id="updateRakutenButton">Update Rakuten</button>
            <button id="updateCJButton">Update Commission Junction</button>
            <button id="updateAWINButton">Update AWIN</button>
        </div>
        <pre id="message"></pre>
    </div>

    <script>
        const messageBox = document.getElementById('message');

        const updateData = async (network, endpoint) => {
            messageBox.textContent = \`Updating \${network} data... Please wait.\`;
            messageBox.classList.remove('success', 'error');

            try {
                const response = await fetch(endpoint);
                const result = await response.json();
                
                if (result.status === 'success') {
                    messageBox.textContent = \`\${network} update completed! Successfully saved \${result.savedCount} advertisers to Firestore.\\n\${result.message}\`;
                    messageBox.classList.add('success');
                } else {
                    messageBox.textContent = \`\${network} update failed.\\nDetails: \${result.message}\`;
                    messageBox.classList.add('error');
                }
            } catch (error) {
                messageBox.textContent = "A network error occurred. Check the server console for more details.";
                messageBox.classList.add('error');
            }
        };

        document.getElementById('updateRakutenButton').addEventListener('click', () => updateData('Rakuten', '/update/rakuten'));
        document.getElementById('updateCJButton').addEventListener('click', () => updateData('Commission Junction', '/update/cj'));
        document.getElementById('updateAWINButton').addEventListener('click', () => updateData('AWIN', '/update/awin'));
    </script>
</body>
</html>
`;

// --- API Endpoints to trigger manual updates ---
app.get('/update/rakuten', async (req, res) => {
  const result = await fetchRakutenPartnerships();
  const saveResult = await saveToFirestore(result.data);
  res.json({
    ...result,
    ...saveResult,
    savedCount: saveResult.savedCount
  });
});

app.get('/update/cj', async (req, res) => {
  const result = await fetchCJPartnerships();
  const saveResult = await saveToFirestore(result.data);
  res.json({
    ...result,
    ...saveResult,
    savedCount: saveResult.savedCount
  });
});

app.get('/update/awin', async (req, res) => {
  const result = await fetchAWINProgrammes();
  const saveResult = await saveToFirestore(result.data);
  res.json({
    ...result,
    ...saveResult,
    savedCount: saveResult.savedCount
  });
});

// Serve the HTML page
app.get('/', (req, res) => {
  res.send(htmlPage);
});

// Start the server only after credentials have been loaded
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
  // Automatically run the all-network update every hour
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(updateAllAdvertisers, ONE_HOUR);
});

// This is where you would place the other functions like fetchRakutenPartnerships, fetchCJPartnerships, etc.
// They remain unchanged from the previous code block.