const axios = require('axios');
const config = require('../config/env');

const fetchLogo = async (domain) => {
    if (!domain) return null;

    // Use API if key is available
    if (config.brandfetch && config.brandfetch.apiKey) {
        try {
            const response = await axios.get(`https://api.brandfetch.io/v2/brands/${domain}`, {
                headers: {
                    'Authorization': `Bearer ${config.brandfetch.apiKey}`
                },
                timeout: 5000
            });

            // Look for logo in the response
            if (response.data && response.data.logos && response.data.logos.length > 0) {
                // Prioritize 'icon' or 'logo' types
                const logo = response.data.logos.find(l => l.type === 'logo') || response.data.logos[0];
                const format = logo.formats && logo.formats[0];
                return format ? format.src : null;
            }
        } catch (error) {
            // Fallback to CDN if API fails or brand not found
            // console.warn(`Brandfetch API failed for ${domain}, falling back to CDN...`);
        }
    }

    try {
        // Fallback: Use the CDN endpoint
        const logoUrl = `https://cdn.brandfetch.io/${domain}`;

        const response = await axios.head(logoUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 5000
        });

        if (response.status === 200 && response.headers['content-type']?.startsWith('image/')) {
            return logoUrl;
        }

        return null;
    } catch (error) {
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
