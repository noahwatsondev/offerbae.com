const axios = require('axios');

const fetchLogo = async (domain) => {
    if (!domain) return null;

    try {
        // Use the CDN endpoint with browser User-Agent to avoid 403 blocks
        const logoUrl = `https://cdn.brandfetch.io/${domain}`;

        const response = await axios.head(logoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 5000
        });

        if (response.status === 200) {
            // Found it. 
            // Note: imageStore.js will also need to use this User-Agent when downloading!
            return logoUrl;
        }

        return null;
    } catch (error) {
        if (error.response?.status === 404) {
            return null;
        }
        // console.error(`Error fetching logo for ${domain}:`, error.message);
        return null;
    }
};

// Helper to extract domain from URL
const extractDomain = (url) => {
    if (!url) return null;
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace('www.', '');
    } catch (e) {
        return null;
    }
};

module.exports = {
    fetchLogo,
    extractDomain
};
