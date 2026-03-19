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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEO CONTENT STRATEGY RULES (2026 — STRICT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. NO AI FLUFF OPENINGS
   The very first sentence of the letter body MUST directly answer the primary buying intent — what the reader gets from this article. Never start with "In today's digital age", "The importance of...", "Are you looking for...", or any hollow opener. Start mid-thought, with warmth and confidence. Example: "Bae, this week's obsession found me — I didn't find it."

2. TARGET LENGTH ~1,200 WORDS
   The main content body should be approximately 1,200 words — pleasantly detailed, telling a full story about the brands or products with enough depth to keep Bae engaged.

3. SENTENCE VARIANCE IS MANDATORY
   Mix very short, punchy sentences with longer, more complex ones. Never write three consecutive sentences of the same length or structure. Vary subject position — not every sentence should start with "I" or "Bae". Break patterns intentionally.

4. E-E-A-T CREDIBILITY INSERTS
   Insert exactly 3 editorial credibility moments. In the Editor.js paragraph block where the moment should appear, include the literal placeholder text [EDITORIAL CREDIBILITY INSERT] on its own line inside the paragraph text. These are spots where the OfferBae editorial team will inject a real-world curator note, deal verification moment, or product test result. Flag each placeholder with a brief parenthetical hint, e.g.: [EDITORIAL CREDIBILITY INSERT — e.g. "Our editors verified this code at checkout on March 18th and it stacked with the site-wide sale."]

5. HEADER FORMATTING AS QUESTIONS
   All H2 and H3 block headers must be phrased as natural questions that a real shopper would type into Google. Examples: "Why Is Everyone Obsessed With This Brand Right Now?", "What Makes This Deal Actually Worth It?", "Is This the Best Time to Buy?" — Never use declarative headers like "About the Brand" or "Our Picks".

6. BULLET POINTS FOR LISTS OF 3 OR MORE
   Any list of 3 or more items (products, features, reasons, tips) MUST be formatted as a bullet list block in Editor.js (type: "list", style: "unordered"), not embedded inline in a paragraph.

7. BOLD THE KEY SENTENCE
   In every third paragraph block, bold the single most important sentence using <b> HTML tags within the paragraph text. This is the sentence Bae should remember if they skim.

8. INTERNAL LINKS — DESCRIPTIVE ANCHOR TEXT ONLY
   When linking to brand pages or offer pages, use descriptive anchor text that describes what the reader will find (NO "click here", "this link", or "learn more"). The anchor text should be a natural part of the sentence. Links are provided in the data context — use them precisely.

9. END WITH AN ACTION SUMMARY BLOCK
   The final section of EVERY letter MUST be titled with a question header like "So What Should Bae Do Right Now?" and contain either:
   - A "Quick Deal Checklist" (bullet list of 3–5 action steps), OR
   - A "3-Step Plan" (numbered list)
   This section provides immediate utility and is optimized for Google's AI Overviews / featured snippet targeting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LINK RULES (unchanged)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Whenever you mention a brand, product, or offer name in paragraph blocks, wrap the FIRST mention only in an HTML anchor tag using the provided URL.
- Do NOT hyperlink the same entity more than once. Only the first mention. Subsequent mentions are plain text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (unchanged — MUST be valid JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Your output MUST be a valid JSON object:
{
    "title": "A catchy, romantic, and relevant title for the letter — phrased as a question or bold statement",
    "slug": "a-url-friendly-slug-for-the-title",
    "content": "A raw stringified JSON representing an Editor.js OutputData object. The 'blocks' array should contain 'paragraph', 'header', and 'list' types as needed. Example: '{\"time\":123,\"blocks\":[{\"type\":\"paragraph\",\"data\":{\"text\":\"My dearest Bae...\"}},{\"type\":\"header\",\"data\":{\"text\":\"Why Is This Brand Taking Over?\",\"level\":2}}],\"version\":\"2.28.0\"}' Remember: header blocks must be phrased as questions per SEO rules above.",
    "excerpt": "A short 1-2 sentence teaser that answers the primary search intent immediately — no fluff.",
    "relatedBrandId": "If a specific brand is heavily featured, put its ID here. Otherwise null.",
    "imagePrompt": "A highly descriptive, self-contained prompt to generate an image to accompany this article. ALWAYS include humans in the composition. Specifically feature the brands and products mentioned in the letter. Vary the image style heavily across letters, but ALWAYS lean towards a 'Sunday comic' style featuring sassy humor and wit. CRITICAL: If including speech bubbles or text, explicitly specify the exact text to be used and ensure it is a short, grammatically perfect English sentence that makes complete sense. It MUST be very friendly and pleasing to the eye."
}
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
