require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    rakuten: {
        clientId: process.env.RAKUTEN_CLIENT_ID,
        clientSecret: process.env.RAKUTEN_CLIENT_SECRET,
        siteId: process.env.RAKUTEN_SITE_ID
    },
    cj: {
        personalAccessToken: process.env.CJ_PERSONAL_ACCESS_TOKEN,
        companyId: process.env.CJ_COMPANY_ID,
        websiteId: process.env.CJ_WEBSITE_ID
    },
    awin: {
        accessToken: process.env.AWIN_ACCESS_TOKEN,
        publisherId: process.env.AWIN_PUBLISHER_ID
    },
    pepperjam: {
        apiKey: process.env.PEPPERJAM_API_KEY
    }
};
