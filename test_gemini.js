require('dotenv').config();
console.log('API KEY from env:', process.env.GEMINI_API_KEY ? 'EXISTS' : 'MISSING');
