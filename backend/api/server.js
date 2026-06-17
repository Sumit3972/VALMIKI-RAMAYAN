const { Hono } = require("hono");
const { cors } = require("hono/cors");
const app = new Hono();

require("dotenv").config();
const Bottleneck = require("bottleneck");

// CORS middleware
app.use("*", cors());

const db = require("../src/db");
const { generateTTSChunk, chunkTextSafely } = require("../src/sarvam");
const { generateTranslationPrep, generateAudioTranslationPrep, generateAudioDetailsPrep, classifySpeaker } = require("../src/gemini");
const { uploadAudioToR2 } = require("../src/r2");
const { runConcurrent } = require("../src/taskQueue");
const { getKeyStats: getSarvamKeyStats } = require("../src/keyManager");

// Speaker to Voice Mapping for Sarvam AI TTS Bulbul V3
const SPEAKER_VOICE_MAP = {
  valmiki: "mani", // Premium Tier-1 clear male narrator
  sri_ram: "aditya", // Serene, clear male
  sita: "shreya", // Sweet, elegant female
  lakshmana: "tarun", // Assigned Tarun for professional/clear male voice
  hanuman: "varun", // Strong male voice
  ravana: "amit", // Powerful, booming male
  dasharatha: "ratan", // Mature, older male
  kaikeyi: "simran", // Dramatic female voice
  kousalya: "ritu", // Gentle motherly female voice
  sumitra: "suhani", // Calm motherly female voice
  bharata: "rehan", // Changed to Rehan (Tier-2 high quality pleasant male voice)
  shatrughna: "anand", // Male voice
  sugriva: "kabir", // Conversational male
  vibhishana: "sumit", // Calm male
  manthara: "kavitha", // Distinct/older female voice
  surpanakha: "simran", // Dramatic female voice
  indrajit: "rohan", // Young, fiery male voice
  kumbhakarna: "amit", // Loud, heavy male voice
  janaka: "ratan", // Wise, older male voice
  vishwamitra: "mani", // Authoritative male sage
  vashistha: "mani", // Wise male sage
  jatayu: "dev", // Elderly male bird character
  angada: "aayan", // Active young male monkey prince
  maricha: "tarun", // Deceptive male voice
  shabari: "pooja", // Devout elderly female voice
  guha: "sunny", // Friendly boatman / tribal king
  other: "shubh", // Default male voice
};

// Speaker Announcement Prefix for Audio Context Flow
const SPEAKER_PREFIX_MAP = {
  sri_ram: { en: "Shree Ram said: ", hi: "श्री राम बोले: " },
  sita: { en: "Sita Ji said: ", hi: "सीता जी बोलीं: " },
  lakshmana: { en: "Shree Lakshman said: ", hi: "लक्ष्मण जी बोले: " },
  hanuman: { en: "Shree Hanuman said: ", hi: "हनुमान जी बोले: " },
  ravana: { en: "Ravana said: ", hi: "रावण बोला: " },
  dasharatha: { en: "King Dasharatha said: ", hi: "राजा दशरथ बोले: " },
  kaikeyi: { en: "Kaikeyi said: ", hi: "कैकेयी बोली: " },
  kousalya: { en: "Kausalya said: ", hi: "कौशल्या बोलीं: " },
  sumitra: { en: "Sumitra said: ", hi: "सुमित्रा बोलीं: " },
  bharata: { en: "Bharata said: ", hi: "भरत बोले: " },
  shatrughna: { en: "Shatrughna said: ", hi: "शत्रुघ्न बोले: " },
  sugriva: { en: "Sugriva said: ", hi: "सुग्रीव बोले: " },
  vibhishana: { en: "Vibhishana said: ", hi: "विभीषण बोले: " },
  manthara: { en: "Manthara said: ", hi: "मंथरा बोली: " },
  surpanakha: { en: "Surpanakha said: ", hi: "शूर्पणखा बोली: " },
  indrajit: { en: "Indrajit said: ", hi: "इन्द्रजीत बोला: " },
  kumbhakarna: { en: "Kumbhakarna said: ", hi: "कुम्भकर्ण बोला: " },
  janaka: { en: "King Janaka said: ", hi: "राजा जनक बोले: " },
  vishwamitra: {
    en: "Sage Vishwamitra said: ",
    hi: "महर्षि विश्वामित्र बोले: ",
  },
  vashistha: { en: "Sage Vashistha said: ", hi: "महर्षि वशिष्ठ बोले: " },
  jatayu: { en: "Jatayu said: ", hi: "जटायु बोला: " },
  angada: { en: "Angada said: ", hi: "अंगद बोले: " },
  maricha: { en: "Maricha said: ", hi: "मारीच बोला: " },
  shabari: { en: "Shabari said: ", hi: "शबरी बोलीं: " },
  guha: { en: "Guha said: ", hi: "गुहा बोले: " },
};

// Helper to determine the correct voice ID for a shloka
async function getSpeakerVoiceForShloka(shloka) {
  let speakerChar = shloka.speaker_character;

  if (!speakerChar) {
    const MAX_RETRIES = 3;
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      try {
        const classified = await classifySpeaker(
          shloka.sanskrit,
          shloka.translation,
          shloka,
        );
        if (classified) {
          await db.query(
            "UPDATE ramayana_shlokas SET speaker_character = $1 WHERE id = $2",
            [classified, shloka.id],
          );
          shloka.speaker_character = classified;
          speakerChar = classified;
          break;
        }
      } catch (err) {
        attempt++;
        console.error(
          `[Speaker Classification Error] Attempt ${attempt}/${MAX_RETRIES} for Shloka ${shloka.id}:`,
          err.message,
        );
        if (attempt >= MAX_RETRIES) {
          break;
        }
        // Wait 1.5 seconds before retrying
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  }

  // Fallback if classification completely failed
  if (!speakerChar) {
    speakerChar = "valmiki:वाल्मीकि:male";
  }

  // Parse speaker character string (can be 'character_en:name_hi:gender' or old cached format 'character_en')
  let charKey = speakerChar;
  let gender = "male";

  if (speakerChar.includes(":")) {
    const parts = speakerChar.split(":");
    charKey = parts[0];
    gender = parts[2] || "male";
  }

  // Return mapped voice or fall back by gender
  if (SPEAKER_VOICE_MAP[charKey]) {
    return SPEAKER_VOICE_MAP[charKey];
  }

  if (gender === "female") {
    return "shreya"; // Default female voice
  }
  return "shubh"; // Default male voice
}

// Global endpoint concurrency limiters optimized for Cloudflare Workers
const audioLimiter = new Bottleneck({
  maxConcurrent: 15, // Max 15 parallel audio generations globally
});

const translateLimiter = new Bottleneck({
  maxConcurrent: 20, // Max 20 parallel translations globally
});

// Concurrency caps for batch operations
const TRANSLATION_CONCURRENCY = 15; // 15 parallel LLM calls
const AUDIO_CONCURRENCY = 8; // 8 parallel TTS+upload pipelines

// Helper to get or generate translation
async function getOrGenerateTranslation(shloka, lang) {
  if (lang === "hi") {
    if (shloka.translation_hi) return shloka.translation_hi;
    const newText = await generateTranslationPrep(
      shloka.sanskrit,
      shloka.translation,
      "hi",
      shloka,
    );
    await db.query(
      "UPDATE ramayana_shlokas SET translation_hi = $1 WHERE id = $2",
      [newText, shloka.id],
    );
    return newText;
  } else {
    if (shloka.translation_tts_en) return shloka.translation_tts_en;
    const newText = await generateTranslationPrep(
      shloka.sanskrit,
      shloka.translation,
      "en",
      shloka,
    );
    await db.query(
      "UPDATE ramayana_shlokas SET translation_tts_en = $1 WHERE id = $2",
      [newText, shloka.id],
    );
    return newText;
  }
}

// Helper to get or generate audio translation and speaker classification in a single LLM call
async function getOrGenerateAudioDetails(shloka, lang) {
  const targetLang = lang === "sanskrit" ? "hi" : lang; // If sanskrit, use Hindi to pre-cache translation
  const translationColumn = targetLang === "hi" ? "audio_translation_hi" : "audio_translation_en";
  
  let speaker = shloka.speaker_character;
  let translation = shloka[translationColumn];
  
  // If we already have the speaker (usually true after first classification) AND the translation, return cached
  // Note: if the audio type is 'sanskrit', we only need speaker, so we check if speaker is already cached.
  if (lang === "sanskrit" && speaker) {
    return { speaker, translation: shloka.sanskrit };
  }
  
  if (speaker && translation) {
    return { speaker, translation };
  }
  
  // Call combined LLM function to get both details in one call
  const result = await generateAudioDetailsPrep(
    shloka.sanskrit,
    shloka.translation,
    targetLang,
    shloka
  );
  
  const { speaker: newSpeaker, translation: newTranslation } = result;
  
  const updates = [];
  const params = [];
  let paramIdx = 1;
  
  if (!speaker && newSpeaker) {
    shloka.speaker_character = newSpeaker;
    speaker = newSpeaker;
    updates.push(`speaker_character = $${paramIdx++}`);
    params.push(newSpeaker);
  }
  
  if (!translation && newTranslation) {
    shloka[translationColumn] = newTranslation;
    translation = newTranslation;
    updates.push(`${translationColumn} = $${paramIdx++}`);
    params.push(newTranslation);
  }
  
  if (updates.length > 0) {
    params.push(shloka.id);
    await db.query(
      `UPDATE ramayana_shlokas SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      params
    );
  }
  
  if (lang === "sanskrit") {
    return { speaker, translation: shloka.sanskrit };
  }
  
  return { speaker, translation };
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
app.get("/metadata", async (c) => {
  try {
    const result = await db.query(
      `SELECT kanda, json_agg(DISTINCT sarga ORDER BY sarga ASC) as sargas
       FROM ramayana_shlokas
       GROUP BY kanda
       ORDER BY kanda ASC`,
    );
    return c.json({ metadata: result.rows });
  } catch (error) {
    console.error("Metadata error:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// ---------------------------------------------------------
// GET /shlokas - Text Only (Fast DB Fetch)
// ---------------------------------------------------------
app.get("/shlokas", async (c) => {
  const kanda = c.req.query("kanda");
  const sarga = c.req.query("sarga");

  if (!kanda || !sarga) {
    return c.json({ error: "kanda and sarga are required" }, 400);
  }

  try {
    const result = await db.query(
      `SELECT * FROM ramayana_shlokas WHERE kanda = $1 AND sarga = $2 ORDER BY shloka_index ASC`,
      [kanda, sarga],
    );

    if (result.rows.length === 0) {
      return c.json({ error: "No shlokas found." }, 404);
    }

    const shlokas = result.rows.map((row) => ({
      id: row.id,
      kanda: row.kanda,
      sarga: row.sarga,
      shloka_number: row.shloka_number,
      sanskrit: row.sanskrit,
      english: row.translation,
      hindi: row.translation_hi || null, // Send null if missing, Frontend will request it on-demand
    }));

    return c.json({ kanda, sarga, count: shlokas.length, shlokas });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error", details: err.message }, 500);
  }
});

// ---------------------------------------------------------
// POST /translate - On-Demand LLM Translation
// ---------------------------------------------------------
app.post("/translate", async (c) => {
  const body = await c.req.json();
  const { shloka_id, lang } = body; // lang: 'hi' or 'en' (for TTS prep)

  if (!shloka_id || !["hi", "en"].includes(lang)) {
    return c.json({ error: "Invalid shloka_id or lang" }, 400);
  }

  // Queue translation to prevent database key conflicts during simultaneous rotations
  return translateLimiter.schedule(async () => {
    try {
      const result = await db.query(
        `SELECT * FROM ramayana_shlokas WHERE id = $1`,
        [shloka_id],
      );
      if (result.rows.length === 0)
        return c.json({ error: "Shloka not found" }, 404);

      const shloka = result.rows[0];
      const newText = await getOrGenerateTranslation(shloka, lang);

      return c.json({ shloka_id, lang, text: newText });
    } catch (err) {
      console.error(err);
      return c.json({ error: "Failed to translate", details: err.message }, 500);
    }
  });
});

// ---------------------------------------------------------
// POST /batch/translate - Concurrent Multi-Shloka Translation
// ---------------------------------------------------------
app.post("/batch/translate", async (c) => {
  const body = await c.req.json();
  const { items } = body; // items: [{ shloka_id, lang }]

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "items array is required" }, 400);
  }

  if (items.length > 20) {
    return c.json({ error: "Maximum 20 items per batch" }, 400);
  }

  // Validate all items upfront
  for (const item of items) {
    if (!item.shloka_id || !["hi", "en"].includes(item.lang)) {
      return c.json({ error: `Invalid item: ${JSON.stringify(item)}` }, 400);
    }
  }

  // Prefetch all shlokas in a single DB query
  const shlokaIds = items.map((i) => i.shloka_id);
  const result = await db.query(
    `SELECT * FROM ramayana_shlokas WHERE id = ANY($1)`,
    [shlokaIds],
  );

  const shlokaMap = new Map(result.rows.map((row) => [row.id, row]));

  // Build task array
  const tasks = items.map(({ shloka_id, lang }) => async () => {
    const shloka = shlokaMap.get(shloka_id);
    if (!shloka) throw new Error(`Shloka ${shloka_id} not found`);

    const text = await getOrGenerateTranslation(shloka, lang);
    return { shloka_id, lang, text };
  });

  // Execute with bounded concurrency
  const results = await runConcurrent(tasks, TRANSLATION_CONCURRENCY);

  return c.json({
    total: items.length,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
    results,
  });
});

// ---------------------------------------------------------
// POST /batch/audio - Concurrent Multi-Shloka Audio Generation
// ---------------------------------------------------------
app.post("/batch/audio", async (c) => {
  const body = await c.req.json();
  const { items } = body; // items: [{ shloka_id, type }]

  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: "items array is required" }, 400);
  }

  if (items.length > 10) {
    return c.json({ error: "Maximum 10 items per batch (audio is expensive)" }, 400);
  }

  // Validate all items upfront
  for (const item of items) {
    if (!item.shloka_id || !["sanskrit", "hi", "en"].includes(item.type)) {
      return c.json({ error: `Invalid item: ${JSON.stringify(item)}` }, 400);
    }
  }

  // Prefetch all shlokas in a single DB query
  const shlokaIds = items.map((i) => i.shloka_id);
  const result = await db.query(
    `SELECT * FROM ramayana_shlokas WHERE id = ANY($1)`,
    [shlokaIds],
  );

  const shlokaMap = new Map(result.rows.map((row) => [row.id, row]));

  const columnMap = {
    sanskrit: "audio_sanskrit_url",
    en: "audio_english_url",
    hi: "audio_hindi_url",
  };

  // Build task array — each task handles one shloka's full audio pipeline
  const tasks = items.map(({ shloka_id, type }) => async () => {
    const shloka = shlokaMap.get(shloka_id);
    if (!shloka) throw new Error(`Shloka ${shloka_id} not found`);

    const columnName = columnMap[type];

    // Return cached if available
    if (shloka[columnName]) {
      return {
        shloka_id,
        type,
        urls: parseUrls(shloka[columnName]),
        cached: true,
      };
    }

    // Get speaker and translation in a single operation
    const details = await getOrGenerateAudioDetails(shloka, type);
    const speakerChar = details.speaker || "valmiki:वाल्मीकि:male";
    let textToProcess = details.translation;
    let langCode = type === "en" ? "en-IN" : "hi-IN";

    // Get dynamic character speaker voice
    const voice = await getSpeakerVoiceForShloka(shloka);

    // Prefix speaker context flow if it's a dialogue character (not valmiki)
    let charKey = speakerChar;
    let nameHi = "";
    let gender = "male";

    if (speakerChar.includes(":")) {
      const parts = speakerChar.split(":");
      charKey = parts[0];
      nameHi = parts[1];
      gender = parts[2];
    }

    if (charKey !== "valmiki") {
      let prefix = "";
      if (SPEAKER_PREFIX_MAP[charKey]) {
        prefix =
          type === "en"
            ? SPEAKER_PREFIX_MAP[charKey].en
            : SPEAKER_PREFIX_MAP[charKey].hi;
      } else {
        // Construct dynamic prefix
        if (type === "en") {
          const capitalizedName = charKey
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          prefix = `${capitalizedName} said: `;
        } else {
          const displayName =
            nameHi ||
            charKey
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ");
          prefix =
            gender === "female"
              ? `${displayName} बोलीं: `
              : `${displayName} बोले: `;
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
      const fileName = `k${shloka.kanda}_s${shloka.sarga}_sh${shloka.shloka_number}_${type}_pt${i + 1}_${Date.now()}.mp3`;
      const publicUrl = await uploadAudioToR2(audioBuffer, fileName);
      audioUrls.push(publicUrl);
    }

    // Cache in DB
    const stringifiedUrls = JSON.stringify(audioUrls);
    await db.query(
      `UPDATE ramayana_shlokas SET ${columnName} = $1 WHERE id = $2`,
      [stringifiedUrls, shloka_id],
    );

    return { shloka_id, type, urls: audioUrls, cached: false };
  });

  // Execute with bounded concurrency
  const results = await runConcurrent(tasks, AUDIO_CONCURRENCY);

  return c.json({
    total: items.length,
    succeeded: results.filter((r) => r.status === "fulfilled").length,
    failed: results.filter((r) => r.status === "rejected").length,
    results,
  });
});

// ---------------------------------------------------------
// POST /audio - On-Demand Real-Time Audio Generation
// ---------------------------------------------------------
app.post("/audio", async (c) => {
  const body = await c.req.json();
  const { shloka_id, type } = body; // type: 'sanskrit', 'hi', 'en'

  if (!shloka_id || !["sanskrit", "hi", "en"].includes(type)) {
    return c.json({ error: "Invalid shloka_id or type (must be sanskrit, hi, en)" }, 400);
  }

  // Bounded concurrency queue to protect container memory and event loop from freezes
  return audioLimiter.schedule(async () => {
    try {
      // 1. Fetch Shloka
      const result = await db.query(
        `SELECT * FROM ramayana_shlokas WHERE id = $1`,
        [shloka_id],
      );
      if (result.rows.length === 0) {
        return c.json({ error: "Shloka not found" }, 404);
      }
      const shloka = result.rows[0];

      // 2. Check Cache
      const columnMap = {
        sanskrit: "audio_sanskrit_url",
        en: "audio_english_url",
        hi: "audio_hindi_url",
      };
      const columnName = columnMap[type];

      if (shloka[columnName]) {
        // Already generated and chunked! Return the array.
        return c.json({ type, urls: parseUrls(shloka[columnName]) });
      }

      // 3. Prepare Text and Speaker Character in a single operation
      const details = await getOrGenerateAudioDetails(shloka, type);
      const speakerChar = details.speaker || "valmiki:वाल्मीकि:male";
      let textToProcess = details.translation;
      let langCode = type === "en" ? "en-IN" : "hi-IN";

      // Get dynamic character speaker voice
      const voice = await getSpeakerVoiceForShloka(shloka);

      // Prefix speaker context flow if it's a dialogue character (not valmiki)
      let charKey = speakerChar;
      let nameHi = "";
      let gender = "male";

      if (speakerChar.includes(":")) {
        const parts = speakerChar.split(":");
        charKey = parts[0];
        nameHi = parts[1];
        gender = parts[2];
      }

      if (charKey !== "valmiki") {
        let prefix = "";
        if (SPEAKER_PREFIX_MAP[charKey]) {
          prefix =
            type === "en"
              ? SPEAKER_PREFIX_MAP[charKey].en
              : SPEAKER_PREFIX_MAP[charKey].hi;
        } else {
          // Construct dynamic prefix
          if (type === "en") {
            const capitalizedName = charKey
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ");
            prefix = `${capitalizedName} said: `;
          } else {
            const displayName =
              nameHi ||
              charKey
                .split("_")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ");
            prefix =
              gender === "female"
                ? `${displayName} बोलीं: `
                : `${displayName} बोले: `;
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

        const fileName = `k${shloka.kanda}_s${shloka.sarga}_sh${shloka.shloka_number}_${type}_pt${i + 1}_${Date.now()}.mp3`;
        const publicUrl = await uploadAudioToR2(audioBuffer, fileName);
        audioUrls.push(publicUrl);
      }

      // 6. Cache the Array in DB
      const stringifiedUrls = JSON.stringify(audioUrls);
      await db.query(
        `UPDATE ramayana_shlokas SET ${columnName} = $1 WHERE id = $2`,
        [stringifiedUrls, shloka_id],
      );

      return c.json({ type, urls: audioUrls });
    } catch (err) {
      console.error(err);
      return c.json({ error: "Failed to generate audio", details: err.message }, 500);
    }
  });
});

// ---------------------------------------------------------
// GET /shlokas/search - Global Text Search
// ---------------------------------------------------------
app.get("/shlokas/search", async (c) => {
  const q = c.req.query("q");

  if (!q || q.trim().length < 2) {
    return c.json({ error: "Search query must be at least 2 characters long" }, 400);
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
      [searchTerm],
    );

    const results = result.rows.map((row) => ({
      id: row.id,
      kanda: row.kanda,
      sarga: row.sarga,
      shloka_number: row.shloka_number,
      sanskrit: row.sanskrit,
      english: row.translation,
      hindi: row.translation_hi || null,
      speaker_character: row.speaker_character || "valmiki",
    }));

    return c.json({ query: q, count: results.length, results });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Search failed", details: err.message }, 500);
  }
});

// ---------------------------------------------------------
// GET /api-keys/status - Monitor API Key Pool Health
// ---------------------------------------------------------
app.get("/api-keys/status", async (c) => {
  try {
    const sarvamStats = await getSarvamKeyStats();
    const sarvamActive = sarvamStats.filter(
      (k) => k.status === "active",
    ).length;
    const sarvamExpired = sarvamStats.filter(
      (k) => k.status === "expired",
    ).length;

    return c.json({
      sarvam: {
        total: sarvamStats.length,
        active: sarvamActive,
        expired: sarvamExpired,
        healthy: sarvamActive > 0,
        keys: sarvamStats,
      },
      llm: {
        total: 1,
        active: 1,
        expired: 0,
        healthy: true,
        keys: [
          { label: "default", status: "active", masked_key: "sk-gynEZ...UHYh" },
        ],
      },
    });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Failed to fetch key stats" }, 500);
  }
});

module.exports = app;

// If running locally via Node.js
if (require.main === module) {
  const { serve } = require("@hono/node-server");
  const port = process.env.PORT || 3000;
  serve({
    fetch: app.fetch,
    port: Number(port)
  }, (info) => {
    console.log(`Hono Server listening at http://localhost:${info.port}`);
    console.log(`Concurrency: Translation=${TRANSLATION_CONCURRENCY}, Audio=${AUDIO_CONCURRENCY}`);
  });
}
