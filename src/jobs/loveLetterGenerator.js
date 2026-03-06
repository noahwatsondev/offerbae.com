const { GoogleGenAI } = require('@google/genai');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const firebaseAdmin = require('firebase-admin');
const { getEnrichedAdvertisers, slugify } = require('../services/db');
const { uploadImageBuffer } = require('../services/imageStore');

const secretClient = new SecretManagerServiceClient();


// List of major shopping holidays to check (Month is 0-indexed in JS Dates)
const HOLIDAYS = [
    { name: "Valentine's Day", month: 1, date: 14 },
    { name: "Mother's Day", month: 4, date: 12 }, // Placeholder
    { name: "Father's Day", month: 5, date: 16 }, // Placeholder
    { name: "Independence Day / 4th of July", month: 6, date: 4 },
    { name: "Back to School", month: 7, date: 15 }, // Rough alignment
    { name: "Labor Day", month: 8, date: 2 }, // Placeholder
    { name: "Halloween", month: 9, date: 31 },
    { name: "Black Friday", month: 10, date: 28 }, // Placeholder
    { name: "Cyber Monday", month: 10, date: 30 }, // Placeholder
    { name: "Christmas / Holiday Gifting", month: 11, date: 25 },
    { name: "New Year's Eve", month: 11, date: 31 },
];

/**
 * Checks if there is a major shopping holiday exactly 14 days from now
 */
const getUpcomingHoliday = () => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 14);

    const month = targetDate.getMonth();
    const date = targetDate.getDate();

    const holiday = HOLIDAYS.find(h => h.month === month && h.date === date);
    return holiday ? holiday.name : null;
};

/**
 * Generates the prompt instruction base
 */
const getSystemPrompt = () => {
    return `You are OfferBae's affectionate and witty content AI, writing a "Love Letter" to your audience. 
OfferBae is a platform that curates premium brand deals, promo codes, and trending products.
Every Love Letter is addressed to "Bae" (your reader/lover) and is written in a sweet, fun, and very warm, intimate tone.
You are metaphorically writing a romantic love letter, but the romance is actually about the amazing shopping deals, lifestyle products, or brands.
Use a conversational, endearing tone. Include emojis tastefully.

Your output MUST be a valid JSON object with the following structure:
{
    "title": "A catchy, romantic, and relevant title for the letter",
    "slug": "a-url-friendly-slug-for-the-title",
    "content": "A raw stringified JSON representing an Editor.js OutputData object. The 'blocks' array should contain 'paragraph' or 'header' types. Example: '{\"time\":123,\"blocks\":[{\"type\":\"paragraph\",\"data\":{\"text\":\"My dearest Bae...\"}}],\"version\":\"2.28.0\"}'",
    "excerpt": "A short 1-2 sentence teaser summary of the letter.",
    "relatedBrandId": "If a specific brand is heavily featured, put its ID here. Otherwise null.",
    "imagePrompt": "A highly descriptive, self-contained prompt to generate an image to accompany this article. ALWAYS include humans in the composition. Specifically feature the brands and products mentioned in the letter. Vary the image style heavily across letters (e.g. realistic, black and white photography, Disney animation style, Studio Ghibli, 3D render, whimsical cartoon, etc). It MUST be very friendly and pleasing to the eye."
}

CRITIAL REQUIREMENT FOR THE CONTENT BLOCKS:
1. Whenever you mention the brand name, product name, or offer name in the 'paragraph' blocks, you MUST wrap them in an HTML anchor tag (<a href="...">...</a>) using the provided URL for that specific entity in the data contexts. For example: {"type": "paragraph", "data": {"text": "My dearest Bae, you have to check out <a href='https://offerbae.com/brands/nike'>Nike</a> right now!"}}
2. IMPORTANT: Do NOT hyperlink the same brand name, product name, or offer name more than once. Only hyperlink the FIRST mention of each entity to avoid looking spammy.
3. LENGTH: Please add about 100 more words to the main portion of the letter. Make the letter pleasantly detailed, telling a nice little story about the brands or products.
`;
};

/**
 * Main function to generate and save 3 Love Letters
 */
const generateDailyLoveLetters = async () => {
    try {
        console.log('[LOVE LETTERS JOB] Starting daily generation process...');

        let apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            try {
                const projectId = process.env.GCP_PROJECT_ID || 'offerbae-com';
                const name = `projects/${projectId}/secrets/GEMINI_API_KEY/versions/latest`;
                const [version] = await secretClient.accessSecretVersion({ name });
                apiKey = version.payload.data.toString('utf8');
            } catch (err) {
                console.warn('[LOVE LETTERS JOB] Failed to get GEMINI_API_KEY from Secret Manager:', err.message);
            }
        }

        if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured in .env or Secret Manager.");
        }

        const ai = new GoogleGenAI({ apiKey });
        const db = firebaseAdmin.firestore();

        // 1. Fetch available data context (Brands, Offers)
        const enrichedBrands = await getEnrichedAdvertisers();

        const topBrands = enrichedBrands
            .filter(b => b.productCount > 0 || b.offerCount > 0)
            .sort(() => 0.5 - Math.random())
            .slice(0, 5);

        const offersSnapshot = await db.collection('offers')
            .orderBy('updatedAt', 'desc')
            .limit(20)
            .get();
        const recentOffers = offersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 2. Check Calendar Context
        const upcomingHoliday = getUpcomingHoliday();
        let contextualInstruction = '';

        if (upcomingHoliday) {
            console.log(`[LOVE LETTERS JOB] Holiday detected in 14 days: ${upcomingHoliday}`);
            contextualInstruction = `There is exactly 14 days until ${upcomingHoliday}. Dedicate this Love Letter entirely to this holiday subject, helping Bae prepare for it.`;
        } else {
            console.log(`[LOVE LETTERS JOB] No immediate holiday. Using random inspiration.`);
            contextualInstruction = `There are no immediate holidays approaching. Find inspiration in current events, seasonal changes, or pain points that the featured products/brands solve for Bae. Keep it spontaneous.`;
        }

        const contextDataString = `
AVAILABLE BRANDS (Pick from these if you need inspiration):
${topBrands.map(b => `- ${b.name} (Categories: ${b.categories?.join(', ') || 'Various'}) (URL: https://offerbae.com/brands/${b.slug || slugify(b.name)}) (ID: ${b.id})`).join('\n')}

RECENT DEALS & OFFERS (Featured options):
${recentOffers.slice(0, 10).map(o => `- Brand: ${o.advertiser || 'Unknown'}, Offer: ${o.description || o.name}, Code: ${o.code || 'None'} (URL: https://offerbae.com/brands/${o.advertiserSlug || slugify(o.advertiser || 'Unknown')})`).join('\n')}
`;

        // 3. Define the 3 distinct letter prompts
        const prompts = [
            {
                type: "Brand Focused",
                prompt: `Write Love Letter 1: Brand focused.
Context: ${contextualInstruction}
Instructions: The subject matter must revolve specifically around one single brand. Deeply express your love for this brand and mention several of its products or offers if they exist. Use the data provided.
Data to draw from:
${contextDataString}`
            },
            {
                type: "Product/Category Focused",
                prompt: `Write Love Letter 2: Product/Category focused.
Context: ${contextualInstruction}
Instructions: The subject matter must revolve around a general category of products (e.g., skincare routines, tech gadgets, cozy home vibes). Mention the general category and sprinkle in references to brands that fit this category from the provided list.
Data to draw from:
${contextDataString}`
            },
            {
                type: "Offer Focused",
                prompt: `Write Love Letter 3: Offer focused.
Context: ${contextualInstruction}
Instructions: The subject matter must revolve around several healthy string of offers and promo codes. You are incredibly excited to share these specific deals with Bae so they can save money. Mention the specific brands and the products they can apply them to.
Data to draw from:
${contextDataString}`
            }
        ];

        // 4. Generate the letters using Gemini
        for (const [index, job] of prompts.entries()) {
            console.log(`[LOVE LETTERS JOB] Generating ${job.type}...`);

            const request = {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [{ text: `${getSystemPrompt()}\n\n---\n\n${job.prompt}` }]
                }],
                config: {
                    responseMimeType: "application/json",
                    temperature: 0.8
                }
            };

            const response = await ai.models.generateContent(request);
            const rawText = response.text;

            let letterData;
            try {
                letterData = JSON.parse(rawText);
            } catch (e) {
                console.error(`[LOVE LETTERS JOB] Failed to parse JSON:`, rawText);
                continue;
            }

            // 5. Parse Content and Save Draft
            // Double check if Gemini returned the nested JSON correctly or returned an object. Need 'content' to be a string.
            const finalContent = typeof letterData.content === 'object'
                ? JSON.stringify(letterData.content)
                : letterData.content || '';

            let featuredImageUrl = '';
            if (letterData.imagePrompt) {
                try {
                    console.log(`[LOVE LETTERS JOB] Generating image for prompt: "${letterData.imagePrompt}"`);
                    const imageResp = await ai.models.generateImages({
                        model: "imagen-4.0-generate-001",
                        prompt: letterData.imagePrompt,
                        config: {
                            numberOfImages: 1,
                            aspectRatio: "16:9",
                            personGeneration: "allow_adult"
                        }
                    });

                    const base64Image = imageResp.generatedImages[0].image.imageBytes;
                    const imageBuffer = Buffer.from(base64Image, 'base64');
                    // Upload to our store
                    featuredImageUrl = await uploadImageBuffer(imageBuffer, 'image/jpeg', 'loveletters');
                    console.log(`[LOVE LETTERS JOB] Image successfully generated and saved to: ${featuredImageUrl}`);
                } catch (imgErr) {
                    console.error('[LOVE LETTERS JOB] Failed to generate featured image:', imgErr.message);
                }
            }

            const docData = {
                title: letterData.title || `Love Letter Draft ${index + 1}`,
                slug: letterData.slug || slugify(letterData.title || `doc-${Date.now()}`),
                content: finalContent,
                excerpt: letterData.excerpt || '',
                featuredImage: featuredImageUrl || '',
                published: false,
                authorId: 'system_ai',
                createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
                type: job.type,
                relatedBrandId: letterData.relatedBrandId || null
            };

            await db.collection('loveletters').add(docData);
            console.log(`[LOVE LETTERS JOB] Successfully saved draft: "${docData.title}"`);

            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('[LOVE LETTERS JOB] Daily generation process completed successfully.');
        return { success: true };

    } catch (error) {
        console.error('[LOVE LETTERS JOB] Error generating love letters:', error);
        throw error;
    }
};

module.exports = {
    generateDailyLoveLetters
};
