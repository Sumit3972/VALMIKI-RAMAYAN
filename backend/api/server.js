const fastify = require('fastify')({ logger: true });
require('dotenv').config();

// CORS — allow all origins
fastify.register(require('@fastify/cors'), { 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

const db = require('../src/db');
const { generateTTSChunk, chunkTextSafely } = require('../src/sarvam');
const { generateTranslationPrep } = require('../src/gemini');
const { uploadAudioToR2 } = require('../src/r2');
const { runConcurrent } = require('../src/taskQueue');
const { getKeyStats: getSarvamKeyStats } = require('../src/keyManager');
const { getKeyStats: getGeminiKeyStats } = require('../src/geminiKeyManager');

// Vercel free tier: max 60s execution time
const VERCEL_MAX_DURATION = 60;

// Concurrency caps — tuned for Sarvam's 60 req/min rate limit
// and Vercel Hobby's resource constraints
const TRANSLATION_CONCURRENCY = 3; // 3 parallel LLM calls
const AUDIO_CONCURRENCY = 2;       // 2 parallel TTS+upload pipelines

// Helper to get or generate translation
async function getOrGenerateTranslation(shloka, lang) {
  if (lang === 'hi') {
    if (shloka.translation_hi) return shloka.translation_hi;
    const newText = await generateTranslationPrep(shloka.sanskrit, shloka.translation, 'hi');
    await db.query('UPDATE ramayana_shlokas SET translation_hi = $1 WHERE id = $2', [newText, shloka.id]);
    return newText;
  } else {
    if (shloka.translation_tts_en) return shloka.translation_tts_en;
    const newText = await generateTranslationPrep(shloka.sanskrit, shloka.translation, 'en');
    await db.query('UPDATE ramayana_shlokas SET translation_tts_en = $1 WHERE id = $2', [newText, shloka.id]);
    return newText;
  }
}

// Helper to safely parse JSON arrays from the DB text columns
function parseUrls(urlStr) {
  if (!urlStr) return [];
  try {
    return JSON.parse(urlStr);
  } catch (e) {
    // Fallback if it was stored as a single string previously
    return [urlStr];
  }
}

// ---------------------------------------------------------
// GET /metadata - Fetch available Kandas and Sargas
// ---------------------------------------------------------
fastify.get('/metadata', async (request, reply) => {
  try {
    const result = await db.query(
      `SELECT kanda, json_agg(DISTINCT sarga ORDER BY sarga ASC) as sargas 
       FROM ramayana_shlokas 
       GROUP BY kanda 
       ORDER BY kanda ASC`
    );
    return reply.send({ metadata: result.rows });
  } catch (error) {
    console.error('Metadata error:', error);
    return reply.status(500).send({ error: 'Internal Server Error' });
  }
});

// ---------------------------------------------------------
// GET /shlokas - Text Only (Fast DB Fetch)
// ---------------------------------------------------------
fastify.get('/shlokas', async (request, reply) => {
  const { kanda, sarga } = request.query;

  if (!kanda || !sarga) {
    return reply.status(400).send({ error: 'kanda and sarga are required' });
  }

  try {
    const result = await db.query(
      `SELECT * FROM ramayana_shlokas WHERE kanda = $1 AND sarga = $2 ORDER BY shloka_index ASC`,
      [kanda, sarga]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'No shlokas found.' });
    }

    const shlokas = result.rows.map(row => ({
      id: row.id,
      kanda: row.kanda,
      sarga: row.sarga,
      shloka_number: row.shloka_number,
      sanskrit: row.sanskrit,
      english: row.translation,
      hindi: row.translation_hi || null // Send null if missing, Frontend will request it on-demand
    }));

    return { kanda, sarga, count: shlokas.length, shlokas };

  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Internal server error', details: err.message });
  }
});

// ---------------------------------------------------------
// POST /translate - On-Demand LLM Translation
// ---------------------------------------------------------
fastify.post('/translate', async (request, reply) => {
  const { shloka_id, lang } = request.body; // lang: 'hi' or 'en' (for TTS prep)

  if (!shloka_id || !['hi', 'en'].includes(lang)) {
    return reply.status(400).send({ error: 'Invalid shloka_id or lang' });
  }

  try {
    const result = await db.query(`SELECT * FROM ramayana_shlokas WHERE id = $1`, [shloka_id]);
    if (result.rows.length === 0) return reply.status(404).send({ error: 'Shloka not found' });
    
    const shloka = result.rows[0];
    const newText = await getOrGenerateTranslation(shloka, lang);
    
    return { shloka_id, lang, text: newText };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to translate', details: err.message });
  }
});

// ---------------------------------------------------------
// POST /batch/translate - Concurrent Multi-Shloka Translation
// Processes up to 20 shlokas concurrently within Vercel's 60s limit
// ---------------------------------------------------------
fastify.post('/batch/translate', async (request, reply) => {
  const { items } = request.body; // items: [{ shloka_id, lang }]

  if (!Array.isArray(items) || items.length === 0) {
    return reply.status(400).send({ error: 'items array is required' });
  }

  if (items.length > 20) {
    return reply.status(400).send({ error: 'Maximum 20 items per batch' });
  }

  // Validate all items upfront
  for (const item of items) {
    if (!item.shloka_id || !['hi', 'en'].includes(item.lang)) {
      return reply.status(400).send({ error: `Invalid item: ${JSON.stringify(item)}` });
    }
  }

  // Prefetch all shlokas in a single DB query
  const shlokaIds = items.map(i => i.shloka_id);
  const result = await db.query(
    `SELECT * FROM ramayana_shlokas WHERE id = ANY($1)`,
    [shlokaIds]
  );

  const shlokaMap = new Map(result.rows.map(row => [row.id, row]));

  // Build task array
  const tasks = items.map(({ shloka_id, lang }) => async () => {
    const shloka = shlokaMap.get(shloka_id);
    if (!shloka) throw new Error(`Shloka ${shloka_id} not found`);

    const text = await getOrGenerateTranslation(shloka, lang);
    return { shloka_id, lang, text };
  });

  // Execute with bounded concurrency
  const results = await runConcurrent(tasks, TRANSLATION_CONCURRENCY);

  return {
    total: items.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
    results
  };
});

// ---------------------------------------------------------
// POST /batch/audio - Concurrent Multi-Shloka Audio Generation
// Processes up to 10 shlokas concurrently within Vercel's 60s limit
// ---------------------------------------------------------
fastify.post('/batch/audio', async (request, reply) => {
  const { items } = request.body; // items: [{ shloka_id, type }]

  if (!Array.isArray(items) || items.length === 0) {
    return reply.status(400).send({ error: 'items array is required' });
  }

  if (items.length > 10) {
    return reply.status(400).send({ error: 'Maximum 10 items per batch (audio is expensive)' });
  }

  // Validate all items upfront
  for (const item of items) {
    if (!item.shloka_id || !['sanskrit', 'hi', 'en'].includes(item.type)) {
      return reply.status(400).send({ error: `Invalid item: ${JSON.stringify(item)}` });
    }
  }

  // Prefetch all shlokas in a single DB query
  const shlokaIds = items.map(i => i.shloka_id);
  const result = await db.query(
    `SELECT * FROM ramayana_shlokas WHERE id = ANY($1)`,
    [shlokaIds]
  );

  const shlokaMap = new Map(result.rows.map(row => [row.id, row]));

  const columnMap = {
    'sanskrit': 'audio_sanskrit_url',
    'en': 'audio_english_url',
    'hi': 'audio_hindi_url'
  };

  // Build task array — each task handles one shloka's full audio pipeline
  const tasks = items.map(({ shloka_id, type }) => async () => {
    const shloka = shlokaMap.get(shloka_id);
    if (!shloka) throw new Error(`Shloka ${shloka_id} not found`);

    const columnName = columnMap[type];

    // Return cached if available
    if (shloka[columnName]) {
      return { shloka_id, type, urls: parseUrls(shloka[columnName]), cached: true };
    }

    // Prepare text
    let textToProcess = '';
    let langCode = '';

    if (type === 'sanskrit') {
      textToProcess = shloka.sanskrit;
      langCode = 'hi-IN';
    } else {
      textToProcess = await getOrGenerateTranslation(shloka, type);
      langCode = type === 'hi' ? 'hi-IN' : 'en-IN';
    }

    // Chunk, generate TTS, upload — sequential within each task
    // (Sarvam rate limiter in sarvam.js handles the throttling)
    const chunks = chunkTextSafely(textToProcess, 2000);
    const audioUrls = [];

    for (let i = 0; i < chunks.length; i++) {
      const audioBuffer = await generateTTSChunk(chunks[i], langCode);
      const fileName = `k${shloka.kanda}_s${shloka.sarga}_sh${shloka.shloka_number}_${type}_pt${i+1}_${Date.now()}.mp3`;
      const publicUrl = await uploadAudioToR2(audioBuffer, fileName);
      audioUrls.push(publicUrl);
    }

    // Cache in DB
    const stringifiedUrls = JSON.stringify(audioUrls);
    await db.query(`UPDATE ramayana_shlokas SET ${columnName} = $1 WHERE id = $2`, [stringifiedUrls, shloka_id]);

    return { shloka_id, type, urls: audioUrls, cached: false };
  });

  // Execute with bounded concurrency
  const results = await runConcurrent(tasks, AUDIO_CONCURRENCY);

  return {
    total: items.length,
    succeeded: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
    results
  };
});

// ---------------------------------------------------------
// POST /audio - On-Demand Real-Time Audio Generation
// ---------------------------------------------------------
fastify.post('/audio', async (request, reply) => {
  const { shloka_id, type } = request.body; // type: 'sanskrit', 'hi', 'en'

  if (!shloka_id || !['sanskrit', 'hi', 'en'].includes(type)) {
    return reply.status(400).send({ error: 'Invalid shloka_id or type (must be sanskrit, hi, en)' });
  }

  try {
    // 1. Fetch Shloka
    const result = await db.query(`SELECT * FROM ramayana_shlokas WHERE id = $1`, [shloka_id]);
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Shloka not found' });
    }
    const shloka = result.rows[0];

    // 2. Check Cache
    const columnMap = {
      'sanskrit': 'audio_sanskrit_url',
      'en': 'audio_english_url',
      'hi': 'audio_hindi_url'
    };
    const columnName = columnMap[type];
    
    if (shloka[columnName]) {
      // Already generated and chunked! Return the array.
      return { type, urls: parseUrls(shloka[columnName]) };
    }

    // 3. Prepare Text
    let textToProcess = '';
    let langCode = '';

    if (type === 'sanskrit') {
      textToProcess = shloka.sanskrit;
      langCode = 'hi-IN'; // Sanskrit uses Devanagari; hi-IN is the closest supported TTS language
    } else {
      // Ensure the TTS-prepped translation exists
      textToProcess = await getOrGenerateTranslation(shloka, type);
      langCode = type === 'hi' ? 'hi-IN' : 'en-IN';
    }

    // 4. Chunk Text
    const chunks = chunkTextSafely(textToProcess, 2000);
    const audioUrls = [];

    // 5. Generate and Upload Chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const audioBuffer = await generateTTSChunk(chunkText, langCode);
      
      const fileName = `k${shloka.kanda}_s${shloka.sarga}_sh${shloka.shloka_number}_${type}_pt${i+1}_${Date.now()}.mp3`;
      const publicUrl = await uploadAudioToR2(audioBuffer, fileName);
      audioUrls.push(publicUrl);
    }

    // 6. Cache the Array in DB
    const stringifiedUrls = JSON.stringify(audioUrls);
    await db.query(`UPDATE ramayana_shlokas SET ${columnName} = $1 WHERE id = $2`, [stringifiedUrls, shloka_id]);

    return { type, urls: audioUrls };

  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to generate audio', details: err.message });
  }
});

// ---------------------------------------------------------
// GET /api-keys/status - Monitor API Key Pool Health
// ---------------------------------------------------------
fastify.get('/api-keys/status', async (request, reply) => {
  try {
    const sarvamStats = await getSarvamKeyStats();
    const sarvamActive = sarvamStats.filter(k => k.status === 'active').length;
    const sarvamExpired = sarvamStats.filter(k => k.status === 'expired').length;

    const geminiStats = await getGeminiKeyStats();
    const geminiActive = geminiStats.filter(k => k.status === 'active').length;
    const geminiExpired = geminiStats.filter(k => k.status === 'expired').length;

    return {
      sarvam: {
        total: sarvamStats.length,
        active: sarvamActive,
        expired: sarvamExpired,
        healthy: sarvamActive > 0,
        keys: sarvamStats
      },
      gemini: {
        total: geminiStats.length,
        active: geminiActive,
        expired: geminiExpired,
        healthy: geminiActive > 0,
        keys: geminiStats
      }
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch key stats' });
  }
});

const start = async () => {
  try {
    fastify.server.timeout = VERCEL_MAX_DURATION * 1000;
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Vercel-Optimized API Pipeline running on port ${fastify.server.address().port}`);
    fastify.log.info(`Concurrency: Translation=${TRANSLATION_CONCURRENCY}, Audio=${AUDIO_CONCURRENCY}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// If running locally, start the server
if (require.main === module) {
  start();
}

// Export for Vercel Serverless Functions
module.exports = async (req, res) => {
  await fastify.ready();
  fastify.server.emit('request', req, res);
};
