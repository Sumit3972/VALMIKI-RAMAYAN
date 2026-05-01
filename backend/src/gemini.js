const axios = require('axios');
const Bottleneck = require('bottleneck');
require('dotenv').config();

const { getActiveKey, rotateKey, markExpired, recordUsage } = require('./geminiKeyManager');

// Max retries = number of keys we could rotate through
const MAX_KEY_RETRIES = 6;

// Gemini Flash Free Tier allows 15 RPM.
// We set minTime to 4100ms (approx 14.6 req/min) to stay just under the limit safely per key.
const limiter = new Bottleneck({
  minTime: 4100,
  maxConcurrent: 1
});

/**
 * Detects if an Axios error is a temporary rate limit (429).
 */
function isRateLimited(error) {
  if (!error.response) return false;
  return error.response.status === 429;
}

/**
 * Detects if an Axios error is a permanent authentication/leak error (400, 403).
 */
function isInvalidKey(error) {
  if (!error.response) return false;
  return error.response.status === 403 || error.response.status === 400;
}

/**
 * Executes an API call with automatic key rotation on quota exhaustion.
 */
async function callGeminiWithRetry(requestFn) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
    let apiKey;
    
    try {
      apiKey = await getActiveKey();
    } catch (err) {
      throw err; // No active keys left at all
    }

    try {
      const result = await requestFn(apiKey);
      
      recordUsage(apiKey).catch(e => 
        console.error('[GeminiKeyManager] Failed to record usage:', e.message)
      );
      
      return result;

    } catch (error) {
      if (isRateLimited(error)) {
        console.warn(`[Gemini] 🔄 Key quota exhausted (attempt ${attempt + 1}/${MAX_KEY_RETRIES}). Rotating to next key...`);
        await rotateKey(apiKey);
        lastError = error;
        // Loop continues
      } else if (isInvalidKey(error)) {
        console.error(`[Gemini] 🚨 Key is INVALID or LEAKED (attempt ${attempt + 1}/${MAX_KEY_RETRIES}). Permanently expiring...`);
        await markExpired(apiKey);
        lastError = error;
        // Loop continues
      } else {
        throw error;
      }
    }
  }

  const err = new Error('ALL_KEYS_EXHAUSTED: All Gemini API keys are currently rate limited. Please try again in a minute.');
  err.statusCode = 503;
  err.originalError = lastError;
  throw err;
}

/**
 * Uses Gemini to generate a perfectly TTS-formatted translation.
 * Automatically rotates API key on quota exhaustion.
 */
async function generateTranslationPrep(sanskritText, existingTranslation, targetLanguage) {
  return limiter.schedule(async () => {
    return callGeminiWithRetry(async (apiKey) => {
      const systemPrompt = targetLanguage === 'hi'
        ? `आप वाल्मीकि रामायण के विशेषज्ञ संस्कृत-से-हिंदी अनुवादक हैं। यह एक पवित्र धार्मिक ग्रंथ है, इसलिए अनुवाद में श्रद्धा और गरिमा बनाए रखें।

अनुवाद के नियम:
- "राम" को सदैव "श्री राम" लिखें। कभी अकेला "राम" न लिखें।
- "सीता" को "माता सीता" या "सीता जी" लिखें।
- "हनुमान" को "श्री हनुमान" या "हनुमान जी" लिखें।
- "लक्ष्मण" को "लक्ष्मण जी" लिखें।
- "रावण" जैसे खलनायकों के नाम यथावत रखें, उनमें जी या श्री न लगाएं।
- ऋषि-मुनियों के लिए "महर्षि", "मुनि", या "ऋषि" जैसे सम्मानसूचक शब्दों का प्रयोग करें।
- भाषा सरल, स्वाभाविक, और बोलचाल की हिंदी में हो जो सुनने में मधुर लगे।
- श्लोक का अर्थ सटीक रखें, अनावश्यक शब्द न जोड़ें।
- केवल अनुवाद लिखें। कोई टिप्पणी, व्याख्या, या परिचय न दें।
- कोई बुलेट पॉइंट, तारांकन, या मार्कडाउन न लगाएं।`
        : `You are an expert Sanskrit-to-English translator specializing in the Valmiki Ramayana, one of the holiest scriptures of Sanatan Dharma.

Translation Rules:
- Always refer to "Rama" as "Shree Ram" or "Lord Shree Ram". Never write just "Rama" or "Ram" alone.
- Refer to "Sita" as "Mata Sita" or "Devi Sita".
- Refer to "Hanuman" as "Shree Hanuman" or "Lord Hanuman".
- Refer to "Lakshmana" as "Shree Lakshman".
- Antagonists like "Ravana" should be written as-is without honorifics.
- Use respectful titles for sages: "Maharishi", "Sage", "Rishi" as appropriate.
- Maintain a reverential, dignified tone befitting sacred scripture.
- Produce natural, flowing English that sounds graceful when spoken aloud.
- Preserve the meaning faithfully — do not add or omit content.
- Output ONLY the translated text. No commentary, no notes, no introductions.
- No bullet points, no markdown, no asterisks, no numbering.`;

      let userPrompt = '';
      if (targetLanguage === 'hi') {
        if (existingTranslation && existingTranslation.trim() !== '') {
          userPrompt = `इस संस्कृत श्लोक का हिंदी अनुवाद करें। संदर्भ अनुवाद को सटीकता के लिए देखें, लेकिन स्वाभाविक बोलचाल की हिंदी में लिखें।

श्लोक:
${sanskritText}

संदर्भ अनुवाद:
${existingTranslation}`;
        } else {
          userPrompt = `इस संस्कृत श्लोक का हिंदी अनुवाद करें। स्वाभाविक बोलचाल की हिंदी में लिखें।

श्लोक:
${sanskritText}`;
        }
      } else {
        if (existingTranslation && existingTranslation.trim() !== '') {
          userPrompt = `Translate this Sanskrit shloka into spoken English. Use the reference for accuracy but produce natural, reverent English.

Shloka:
${sanskritText}

Reference:
${existingTranslation}`;
        } else {
          userPrompt = `Translate this Sanskrit shloka into spoken English. Produce natural, reverent English.

Shloka:
${sanskritText}`;
        }
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const payload = {
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [{
          parts: [{ text: userPrompt }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 10024,
        }
      };

      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.data || !response.data.candidates || response.data.candidates.length === 0) {
        throw new Error('Invalid response from Gemini API');
      }

      let content = response.data.candidates[0].content?.parts?.[0]?.text;
      
      if (!content) {
        console.error("Gemini returned empty content. Response:", JSON.stringify(response.data));
        throw new Error('Gemini returned empty content.');
      }

      // Post-processing: clean up markdown artifacts for TTS
      content = content
        .replace(/^\s*[\*\-•]\s*/gm, '')
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/`/g, '')
        .replace(/^#+\s*/gm, '')
        .replace(/\[.*?\]\(.*?\)/g, '')
        .replace(/\n{2,}/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      // Post-processing: enforce honorifics as a safety net
      content = applyHonorifics(content, targetLanguage);

      return content;
    });
  });
}

/**
 * Ensures proper honorifics are applied to sacred names.
 */
function applyHonorifics(text, lang) {
  if (lang === 'hi') {
    text = text.replace(/(?<!श्री\s)(?<!परशु)(?<!अभि)(?<!बल)(?<!राम)राम(?!ायण|चंद्र|ानुज)/g, 'श्री राम');
    text = text.replace(/श्री\s+श्री\s+राम/g, 'श्री राम');
  } else {
    text = text.replace(/(?<!Shree\s)(?<!Lord\s)(?<!Parashu)(?<!Bala)\bRama?\b(?!yana)/gi, () => 'Shree Ram');
    text = text.replace(/Shree\s+Shree\s+Ram/gi, 'Shree Ram');
    text = text.replace(/Lord\s+Shree\s+Shree\s+Ram/gi, 'Lord Shree Ram');
  }
  return text;
}

module.exports = { generateTranslationPrep };
