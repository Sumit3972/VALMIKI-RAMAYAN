const fastify = require('fastify')({ logger: true });
require('dotenv').config();
const Bottleneck = require('bottleneck');

// CORS — allow all origins
fastify.register(require('@fastify/cors'), { 
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

const db = require('../src/db');
const { generateTTSChunk, chunkTextSafely } = require('../src/sarvam');
const { generateTranslationPrep, classifySpeaker } = require('../src/gemini');
const { uploadAudioToR2 } = require('../src/r2');
const { runConcurrent } = require('../src/taskQueue');
const { getKeyStats: getSarvamKeyStats } = require('../src/keyManager');
const { getKeyStats: getGeminiKeyStats } = require('../src/geminiKeyManager');

// Speaker to Voice Mapping for Sarvam AI TTS Bulbul V3
const SPEAKER_VOICE_MAP = {
  'valmiki': 'mani',          // Premium Tier-1 clear male narrator
  'sri_ram': 'aditya',        // Serene, clear male
  'sita': 'shreya',           // Sweet, elegant female
  'lakshmana': 'rahul',       // Loyal, energetic male
  'hanuman': 'varun',         // Strong male voice
  'ravana': 'amit',           // Powerful, booming male
  'dasharatha': 'ratan',      // Mature, older male
  'kaikeyi': 'simran',        // Dramatic female voice
  'kousalya': 'ritu',         // Gentle motherly female voice
  'sumitra': 'suhani',        // Calm motherly female voice
  'bharata': 'advait',        // Calm male voice
  'shatrughna': 'anand',      // Male voice
  'sugriva': 'kabir',         // Conversational male
  'vibhishana': 'sumit',      // Calm male
  'manthara': 'kavitha',      // Distinct/older female voice
  'surpanakha': 'simran',     // Dramatic female voice
  'indrajit': 'rohan',        // Young, fiery male voice
  'kumbhakarna': 'amit',      // Loud, heavy male voice
  'janaka': 'ratan',          // Wise, older male voice
  'vishwamitra': 'mani',      // Authoritative male sage
  'vashistha': 'mani',        // Wise male sage
  'jatayu': 'dev',            // Elderly male bird character
  'angada': 'aayan',          // Active young male monkey prince
  'maricha': 'tarun',         // Deceptive male voice
  'shabari': 'pooja',         // Devout elderly female voice
  'guha': 'sunny',            // Friendly boatman / tribal king
  'other': 'shubh'            // Default male voice
};

// Speaker Announcement Prefix for Audio Context Flow
const SPEAKER_PREFIX_MAP = {
  'sri_ram': { en: 'Shree Ram said: ', hi: 'श्री राम बोले: ' },
  'sita': { en: 'Sita Ji said: ', hi: 'सीता जी बोलीं: ' },
  'lakshmana': { en: 'Shree Lakshman said: ', hi: 'लक्ष्मण जी बोले: ' },
  'hanuman': { en: 'Shree Hanuman said: ', hi: 'हनुमान जी बोले: ' },
  'ravana': { en: 'Ravana said: ', hi: 'रावण बोला: ' },
  'dasharatha': { en: 'King Dasharatha said: ', hi: 'राजा दशरथ बोले: ' },
  'kaikeyi': { en: 'Kaikeyi said: ', hi: 'कैकेयी बोली: ' },
  'kousalya': { en: 'Kausalya said: ', hi: 'कौशल्या बोलीं: ' },
  'sumitra': { en: 'Sumitra said: ', hi: 'सुमित्रा बोलीं: ' },
  'bharata': { en: 'Bharata said: ', hi: 'भरत बोले: ' },
  'shatrughna': { en: 'Shatrughna said: ', hi: 'शत्रुघ्न बोले: ' },
  'sugriva': { en: 'Sugriva said: ', hi: 'सुग्रीव बोले: ' },
  'vibhishana': { en: 'Vibhishana said: ', hi: 'विभीषण बोले: ' },
  'manthara': { en: 'Manthara said: ', hi: 'मंथरा बोली: ' },
  'surpanakha': { en: 'Surpanakha said: ', hi: 'शूर्पणखा बोली: ' },
  'indrajit': { en: 'Indrajit said: ', hi: 'इन्द्रजीत बोला: ' },
  'kumbhakarna': { en: 'Kumbhakarna said: ', hi: 'कुम्भकर्ण बोला: ' },
  'janaka': { en: 'King Janaka said: ', hi: 'राजा जनक बोले: ' },
  'vishwamitra': { en: 'Sage Vishwamitra said: ', hi: 'महर्षि विश्वामित्र बोले: ' },
  'vashistha': { en: 'Sage Vashistha said: ', hi: 'महर्षि वशिष्ठ बोले: ' },
  'jatayu': { en: 'Jatayu said: ', hi: 'जटायु बोला: ' },
  'angada': { en: 'Angada said: ', hi: 'अंगद बोले: ' },
  'maricha': { en: 'Maricha said: ', hi: 'मारीच बोला: ' },
  'shabari': { en: 'Shabari said: ', hi: 'शबरी बोलीं: ' },
  'guha': { en: 'Guha said: ', hi: 'गुहा बोले: ' }
};

// Helper to determine the correct voice ID for a shloka
async function getSpeakerVoiceForShloka(shloka) {
  let speakerChar = shloka.speaker_character;

  if (!speakerChar) {
    const MAX_RETRIES = 3;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const classified = await classifySpeaker(shloka.sanskrit, shloka.translation);
        if (classified) {
          await db.query('UPDATE ramayana_shlokas SET speaker_character = $1 WHERE id = $2', [classified, shloka.id]);
          shloka.speaker_character = classified;
          speakerChar = classified;
          break;
        }
      } catch (err) {
        attempt++;
        console.error(`[Speaker Classification Error] Attempt ${attempt}/${MAX_RETRIES} for Shloka ${shloka.id}:`, err.message);
        if (attempt >= MAX_RETRIES) {
          break;
        }
        // Wait 1.5 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  // Fallback if classification completely failed
  if (!speakerChar) {
    speakerChar = 'valmiki:वाल्मीकि:male';
  }

  // Parse speaker character string (can be 'character_en:name_hi:gender' or old cached format 'character_en')
  let charKey = speakerChar;
  let gender = 'male';

  if (speakerChar.includes(':')) {
    const parts = speakerChar.split(':');
    charKey = parts[0];
    gender = parts[2] || 'male';
  }

  // Return mapped voice or fall back by gender
  if (SPEAKER_VOICE_MAP[charKey]) {
    return SPEAKER_VOICE_MAP[charKey];
  }

  if (gender === 'female') {
    return 'shreya'; // Default female voice
  }
  return 'shubh'; // Default male voice
}

// Global endpoint concurrency limiters to protect Hugging Face container from freezes
const audioLimiter = new Bottleneck({
  maxConcurrent: 4 // Max 4 parallel audio generations globally
});

const translateLimiter = new Bottleneck({
  maxConcurrent: 5 // Max 5 parallel translations globally
});

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

// Helper to extract only the translation part from the structured Gemini string for TTS
function extractTranslationText(raw) {
  if (!raw) return '';
  const translationMatch = raw.match(/\|\|\|TRANSLATION\|\|\|([\s\S]*?)(?=\|\|\|CONTEXT\|\|\||\|\|\|INSIGHT\|\|\||$)/);
  let text = translationMatch ? translationMatch[1].trim() : raw.trim();
  // Strip any lingering header words at the very beginning of the translation
  text = text
    .replace(/^(translation|context|insight|अनुवाद|संदर्भ|विशेष दृष्टि)\s*[:：-]*\s*/i, '')
    .replace(/^(1\.\s*translation|2\.\s*context|3\.\s*insight)\s*[:：-]*\s*/i, '')
    .trim();
  return text;
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

  // Queue translation to prevent database key conflicts during simultaneous rotations
  return translateLimiter.schedule(async () => {
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
      const rawText = await getOrGenerateTranslation(shloka, type);
      textToProcess = extractTranslationText(rawText);
      langCode = type === 'hi' ? 'hi-IN' : 'en-IN';
    }

    // Get dynamic character speaker voice
    const voice = await getSpeakerVoiceForShloka(shloka);

    // Prefix speaker context flow if it's a dialogue character (not valmiki)
    const speakerChar = shloka.speaker_character || 'valmiki:वाल्मीकि:male';
    let charKey = speakerChar;
    let nameHi = '';
    let gender = 'male';

    if (speakerChar.includes(':')) {
      const parts = speakerChar.split(':');
      charKey = parts[0];
      nameHi = parts[1];
      gender = parts[2];
    }

    if (charKey !== 'valmiki') {
      let prefix = '';
      if (SPEAKER_PREFIX_MAP[charKey]) {
        prefix = (type === 'en') ? SPEAKER_PREFIX_MAP[charKey].en : SPEAKER_PREFIX_MAP[charKey].hi;
      } else {
        // Construct dynamic prefix
        if (type === 'en') {
          const capitalizedName = charKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          prefix = `${capitalizedName} said: `;
        } else {
          const displayName = nameHi || charKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          prefix = (gender === 'female') ? `${displayName} बोलीं: ` : `${displayName} बोले: `;
        }
      }
      textToProcess = prefix + textToProcess;
    }

    // Chunk, generate TTS, upload — sequential within each task
    // (Sarvam rate limiter in sarvam.js handles the throttling)
    const chunks = chunkTextSafely(textToProcess, 2000);
    const audioUrls = [];

    for (let i = 0; i < chunks.length; i++) {
      const audioBuffer = await generateTTSChunk(chunks[i], langCode, voice);
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

  // Bounded concurrency queue to protect container memory and event loop from freezes
  return audioLimiter.schedule(async () => {
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
        const rawText = await getOrGenerateTranslation(shloka, type);
        textToProcess = extractTranslationText(rawText);
        langCode = type === 'hi' ? 'hi-IN' : 'en-IN';
      }

      // Get dynamic character speaker voice
      const voice = await getSpeakerVoiceForShloka(shloka);

      // Prefix speaker context flow if it's a dialogue character (not valmiki)
      const speakerChar = shloka.speaker_character || 'valmiki:वाल्मीकि:male';
      let charKey = speakerChar;
      let nameHi = '';
      let gender = 'male';

      if (speakerChar.includes(':')) {
        const parts = speakerChar.split(':');
        charKey = parts[0];
        nameHi = parts[1];
        gender = parts[2];
      }

      if (charKey !== 'valmiki') {
        let prefix = '';
        if (SPEAKER_PREFIX_MAP[charKey]) {
          prefix = (type === 'en') ? SPEAKER_PREFIX_MAP[charKey].en : SPEAKER_PREFIX_MAP[charKey].hi;
        } else {
          // Construct dynamic prefix
          if (type === 'en') {
            const capitalizedName = charKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            prefix = `${capitalizedName} said: `;
          } else {
            const displayName = nameHi || charKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            prefix = (gender === 'female') ? `${displayName} बोलीं: ` : `${displayName} बोले: `;
          }
        }
        textToProcess = prefix + textToProcess;
      }

      // 4. Chunk Text
      const chunks = chunkTextSafely(textToProcess, 2000);
      const audioUrls = [];

      // 5. Generate and Upload Chunks
      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i];
        const audioBuffer = await generateTTSChunk(chunkText, langCode, voice);
        
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
});

// ---------------------------------------------------------
// GET /shlokas/search - Global Text Search
// ---------------------------------------------------------
fastify.get('/shlokas/search', async (request, reply) => {
  const { q } = request.query;

  if (!q || q.trim().length < 2) {
    return reply.status(400).send({ error: 'Search query must be at least 2 characters long' });
  }

  try {
    const searchTerm = `%${q.trim()}%`;
    const result = await db.query(
      `SELECT id, kanda, sarga, shloka_index, shloka_number, sanskrit, translation, translation_hi, speaker_character 
       FROM ramayana_shlokas 
       WHERE sanskrit ILIKE $1 
          OR translation ILIKE $1 
          OR translation_hi ILIKE $1 
          OR translation_tts_en ILIKE $1
       ORDER BY kanda ASC, sarga ASC, shloka_index ASC 
       LIMIT 50`,
      [searchTerm]
    );

    const results = result.rows.map(row => ({
      id: row.id,
      kanda: row.kanda,
      sarga: row.sarga,
      shloka_number: row.shloka_number,
      sanskrit: row.sanskrit,
      english: row.translation,
      hindi: row.translation_hi || null,
      speaker_character: row.speaker_character || 'valmiki'
    }));

    return { query: q, count: results.length, results };

  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Search failed', details: err.message });
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
