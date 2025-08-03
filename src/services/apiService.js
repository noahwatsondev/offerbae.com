// src/services/apiService.js

/**
 * A service to handle all API calls for the offerbae app.
 * This keeps API logic separate from components, improving maintainability.
 */

// --- IMPORTANT ---
// You must replace these placeholder tokens with your actual Rakuten and CJ API tokens.
// These are not real tokens and will not work.
const RAKUTEN_TOKEN = '7Dwni2i3KDMiJLS9oSDd9xCWALvbeTnF';
const RAKUTEN_SITE_ID = '3899777';
const CJ_TOKEN = 'peDnsyah6kcogOmBv3RAoCf3gA';
const CJ_REQUESTOR_CID = '7613984'; // Required for CJ API calls

/**
 * Fetches a list of advertisers from the Rakuten Advertisers API.
 * @returns {Promise<object>} The JSON response from the API.
 * @throws {Error} Throws an error on API failure.
 */
export const getRakutenAdvertisers = async () => {
  // Original URL
  const url = 'https://api.linksynergy.com/v2/advertisers';
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${RAKUTEN_TOKEN}`,
        'Accept': 'application/json',
        'SID': `${RAKUTEN_SITE_ID}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Throw an error to be caught by the component's useEffect
      throw new Error(`Rakuten API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to fetch Rakuten advertisers:', error);
    // Re-throw the error for the calling component to handle
    throw new Error(`Rakuten API fetch failed: ${error.message}`);
  }
};

/**
 * Fetches a list of advertisers from the CJ Advertiser Lookup API.
 * The CJ API returns an XML response, which needs to be parsed.
 * @returns {Promise<string>} The raw XML response as a string.
 * @throws {Error} Throws an error on API failure.
 */
export const getCjAdvertisers = async () => {
  // We now use a relative URL with the proxy setup in package.json
  const url = `/v2/advertiser-lookup?requestor-cid=${CJ_REQUESTOR_CID}&advertiser-ids=joined`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CJ_TOKEN}`,
        'Accept': 'application/xml'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Throw an error to be caught by the component's useEffect
      throw new Error(`CJ API error: ${response.status} - ${errorText}`);
    }

    const xmlText = await response.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    // Return the raw XML string for display
    return new XMLSerializer().serializeToString(xmlDoc);
  } catch (error) {
    console.error('Failed to fetch CJ advertisers:', error);
    // Re-throw the error for the calling component to handle
    throw new Error(`CJ API fetch failed: ${error.message}`);
  }
};
