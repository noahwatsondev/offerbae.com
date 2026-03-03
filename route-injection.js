const fs = require('fs');
const content = fs.readFileSync('src/app.js', 'utf8');

const injection = `
// Static Info Pages
const staticPages = {
    'how-we-review-deals': {
        title: 'How We Review Deals',
        content: \`
            <h2>Our Curation Process</h2>
            <p>At OfferBae, transparency is incredibly important to us. We parse millions of deals from premium affiliate networks—such as Rakuten, CJ, AWIN, and Pepperjam—using automated ingestion APIs.</p>
            <p>However, an offer simply existing doesn't mean it makes the cut. Our system specifically prioritizes promo codes and substantial discounts over generic "free shipping" offers or everyday low prices.</p>
            <h2>Quality Over Quantity</h2>
            <p>Our database synchronizes daily with our merchant partners. We automatically remove expired deals and flag deals that seem mathematically implausible.</p>
            <p>When our editors specifically curate our "Love Letters," they hand-vet the products, verify the codes at checkout, and ensure the brand reputation aligns with our standards before recommending it to you.</p>
        \`
    },
    'legal': {
        title: 'Legal Statement & Disclosures',
        content: \`
            <h2>Affiliate Disclosure</h2>
            <p>OfferBae participates in various affiliate marketing programs. This means we may get paid commissions on editorially chosen products purchased through our links to retailer sites.</p>
            <p>This does not impact our reviews, but it does help fund our operations and allow us to continue providing excellent curation and technology for our users.</p>
            <h2>Disclaimer of Warranties</h2>
            <p>All deals, codes, and product information are provided "as is" and without warranties of any kind. While we strive to ensure everything is up to date, retailers can change their offers at any time without notice. We are not responsible for pricing errors, expired codes, or out-of-stock items.</p>
        \`
    },
    'privacy': {
        title: 'Privacy Policy',
        content: \`
            <h2>Information We Collect</h2>
            <p>OfferBae respects your privacy. We collect minimal information necessary to improve your browsing experience. This may include standard server logging (IP address, browser type) and analytics data via standard cookies.</p>
            <h2>How We Use Your Data</h2>
            <p>We use this information to understand which deals are most popular, to detect fraud, and to improve the speed and usability of our website. We do not sell your personal data to third parties.</p>
            <h2>Third-Party Links</h2>
            <p>Our website contains links to other merchants. We are not responsible for the privacy practices of those other sites. When you leave OfferBae, you should read the privacy policy of the website you are visiting.</p>
        \`
    },
    'terms': {
        title: 'Terms of Use',
        content: \`
            <h2>Acceptance of Terms</h2>
            <p>By accessing and using OfferBae, you accept and agree to be bound by the terms and provision of this agreement.</p>
            <h2>User Conduct</h2>
            <p>You agree to use OfferBae only for lawful purposes. You may not use our website in any way that causes, or may cause, damage to the website or impairment of the availability or accessibility of the website.</p>
            <h2>Modifications</h2>
            <p>OfferBae reserves the right to revise these terms of use for its web site at any time without notice. By using this web site you are agreeing to be bound by the then current version of these Terms and Conditions of Use.</p>
        \`
    }
};

Object.keys(staticPages).forEach(slug => {
    app.get('/' + slug, populateSidebar, async (req, res) => {
        try {
            const settings = await getGlobalSettings();
            const { getGlobalCategories } = require('./services/db');
            const categories = await getGlobalCategories();
            
            res.render('info', {
                settings,
                categories,
                canonicalUrl: 'https://offerbae.com/' + slug,
                infoTitle: staticPages[slug].title,
                infoContent: staticPages[slug].content,
                breadcrumbPath: [{ name: staticPages[slug].title, url: '/' + slug }]
            });
        } catch (e) {
            console.error('Error loading static page:', e);
            res.status(500).send('Error loading page');
        }
    });
});
\`

// inject this right before "// Top Brands Index"
const marker = "// Top Brands Index";
const newContent = content.replace(marker, injection + "\n" + marker);
fs.writeFileSync('src/app.js', newContent);
