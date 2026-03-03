const makeInfoRoute = (slug, title, content) => {
    return `
app.get('/${slug}', populateSidebar, async (req, res) => {
    try {
        const settings = await require('./services/db').getGlobalSettings();
        const categories = await require('./services/db').getGlobalCategories();
        res.render('info', {
            settings,
            categories,
            infoTitle: '${title}',
            infoContent: \`${content}\`,
            canonicalUrl: 'https://offerbae.com/${slug}',
            breadcrumbPath: [{ name: '${title}', url: '/${slug}' }]
        });
    } catch (e) { res.status(500).send('Error loading page'); }
});`;
};
// Then I can generate the routes...
