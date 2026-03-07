const loveLettersService = require('../services/loveLettersService');
const { getEnrichedAdvertisers, getGlobalSettings, getGlobalCategories } = require('../services/db');


// Public Views
const getLoveLettersIndex = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const articles = await loveLettersService.getAllArticles(false); // Only published

        // Fetch categories for the header
        const enrichedBrands = await getEnrichedAdvertisers();
        const categories = await getGlobalCategories(enrichedBrands);

        res.render('loveletters/index', {
            settings,
            articles,
            categories,
            metaTitle: 'Love Letters from Bae to You - OfferBae.com',
            canonicalUrl: 'https://offerbae.com/loveletters',
            breadcrumbPath: [{ name: 'Love Letters', url: '/loveletters' }],
            hideContext: true
        });
    } catch (error) {
        console.error('Error in getLoveLettersIndex:', error);
        res.status(500).send('Error loading Love Letters');
    }
};

const getLoveLetterDetail = async (req, res) => {
    try {
        const { slug, id } = req.params;
        const settings = await getGlobalSettings();

        let article;
        if (id) {
            article = await loveLettersService.getArticleById(id);
        } else {
            article = await loveLettersService.getArticleBySlug(slug);
        }

        // Fetch categories for the header
        const enrichedBrands = await getEnrichedAdvertisers();
        const categories = await getGlobalCategories(enrichedBrands);

        if (!article) {
            return res.status(404).render('404', { settings, categories });
        }

        res.render('loveletters/detail', {
            settings,
            article,
            categories,
            metaTitle: `${article.title} - Love Letters - OfferBae.com`,
            canonicalUrl: `https://offerbae.com/loveletters/${article.slug}-${article.id}`,
            breadcrumbPath: [
                { name: 'Love Letters', url: '/loveletters' },
                { name: article.title, url: `/loveletters/${article.slug}-${article.id}` }
            ],
            hideContext: true
        });
    } catch (error) {
        console.error('Error in getLoveLetterDetail:', error);
        res.status(500).send('Error loading Love Letter');
    }
};

// Mission Control Views
const getAdminDashboard = async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const articles = await loveLettersService.getAllArticles(true); // Include unpublished

        res.render('mission-control/loveletters/index', {
            active: 'loveletters',
            settings,
            articles
        });
    } catch (error) {
        console.error('Error in getAdminDashboard:', error);
        res.status(500).send('Error loading Love Letters Admin');
    }
};

const getEditor = async (req, res) => {
    try {
        const { id } = req.params;
        const settings = await getGlobalSettings();
        const brands = await getEnrichedAdvertisers();
        brands.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        let article = null;
        if (id && id !== 'new') {
            article = await loveLettersService.getArticleById(id);
        }

        res.render('mission-control/loveletters/editor', {
            active: 'loveletters',
            settings,
            article,
            brands
        });
    } catch (error) {
        console.error('Error in getEditor:', error);
        res.status(500).send('Error loading Love Letters Editor');
    }
};

// API Endpoints
const apiUpsertArticle = async (req, res) => {
    try {
        const result = await loveLettersService.upsertArticle(req.body);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const multer = require('multer');
const imageStore = require('../services/imageStore');

// Configure Multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB limit
    }
});

const uploadMiddleware = (req, res, next) => {
    upload.single('image')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            console.error('Multer error:', err);
            return res.status(400).json({ success: 0, message: err.message });
        } else if (err) {
            console.error('Unknown upload error:', err);
            return res.status(500).json({ success: 0, message: 'Upload error' });
        }
        next();
    });
};

const apiUploadImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: 0, message: 'No file uploaded' });
        }

        const publicUrl = await imageStore.uploadImageBuffer(
            req.file.buffer,
            req.file.mimetype,
            'loveletters/uploads'
        );

        // Editor.js Image tool expects this response format
        res.json({
            success: 1,
            file: {
                url: publicUrl
            }
        });
    } catch (error) {
        console.error('Error uploading image:', error);
        res.status(500).json({ success: 0, message: error.message });
    }
};

const apiDeleteArticle = async (req, res) => {
    try {
        const result = await loveLettersService.deleteArticle(req.params.id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

const apiSetHeroLetter = async (req, res) => {
    try {
        const { id } = req.body;
        const result = await loveLettersService.setHeroLetter(id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    getLoveLettersIndex,
    getLoveLetterDetail,
    getAdminDashboard,
    getEditor,
    apiUpsertArticle,
    apiUploadImage,
    uploadMiddleware,
    apiDeleteArticle,
    apiSetHeroLetter
};
