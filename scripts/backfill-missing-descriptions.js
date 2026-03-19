const { GoogleGenAI } = require('@google/genai');
require('dotenv').config({ override: true });
const sa = require('../service-account.json');
const firebaseAdmin = require('firebase-admin');

if (!firebaseAdmin.apps.length) {
    firebaseAdmin.initializeApp({ credential: firebaseAdmin.credential.cert(sa), projectId: sa.project_id });
}
const db = firebaseAdmin.firestore();

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const secretClient = new SecretManagerServiceClient({ projectId: 'offerbae-com' });

async function run() {
    console.log('\n🤖  Backfilling missing descriptions via Gemini AI...\n');
    let apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        try {
            const projectId = process.env.GCP_PROJECT_ID || 'offerbae-com';
            const name = `projects/${projectId}/secrets/GEMINI_API_KEY/versions/latest`;
            const [version] = await secretClient.accessSecretVersion({ name });
            apiKey = version.payload.data.toString('utf8');
        } catch (err) {
            console.error('Failed to get GEMINI_API_KEY from Secret Manager:', err.message);
        }
    }
    if (!apiKey) {
        console.error('GEMINI_API_KEY not found');
        process.exit(1);
    }
    const ai = new GoogleGenAI({ apiKey });

    const snap = await db.collection('advertisers').get();
    
    const missingData = snap.docs.filter(d => {
        const data = d.data();
        return !data.description && !data.manualDescription;
    });

    console.log(`   Found ${missingData.length} advertisers missing descriptions\n`);

    let updatedCount = 0;

    for (const doc of missingData) {
        const adv = doc.data();
        const advName = adv.name || 'this brand';
        const advUrl = adv.url || adv.link || '';

        process.stdout.write(`   ↳ Generating description for [${advName}]... `);

        let prompt = `Write a 1-2 paragraph SEO-optimized description for the brand "${advName}".`;
        if (advUrl && advUrl !== '#') {
            prompt += ` Use their website at ${advUrl} as context to describe what they sell and their value proposition. Focus on what makes them a good place to shop and save money. Do not mention "coupons", "promo codes", or "deals" in every sentence, focus on the brand itself. Keep it concise, engaging, and directly helpful to a shopper. No introductory text like "Here is a description", just output the description itself.`;
        } else {
            prompt += ` Focus on what makes them a good place to shop and save money. Do not mention "coupons", "promo codes", or "deals" in every sentence, focus on the brand itself. Keep it concise, engaging, and directly helpful to a shopper. No introductory text like "Here is a description", just output the description itself.`;
        }

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    tools: [{ googleSearch: {} }],
                }
            });

            const generatedText = response.text || '';
            const finalDesc = generatedText.trim();

            if (finalDesc) {
                await doc.ref.update({
                    description: finalDesc,
                    updatedAt: new Date()
                });
                updatedCount++;
                console.log(`✅ Success`);
            } else {
                console.log(`❌ AI returned empty`);
            }

            // small delay to respect rate limit
            await new Promise(r => setTimeout(r, 1000));

        } catch (e) {
            console.log(`❌ AI Error: ${e.message}`);
        }
    }

    console.log(`\n🎉  Backfill complete! Updated ${updatedCount} descriptions.\n`);
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
