const axios = require('axios');
const Bottleneck = require('bottleneck');
require('dotenv').config();

const { getActiveKey, markExpired, recordUsage } = require('./keyManager');

const TTS_URL = 'https://api.sarvam.ai/text-to-speech';

// Max retries = number of keys we could rotate through
const MAX_KEY_RETRIES = 7;

// Sarvam Starter tier rate limit is 60 req/min (1 per second)
const limiter = new Bottleneck({
  minTime: 1050,
  maxConcurrent: 1
});

/**
 * Detects if an Axios error is a quota/rate-limit exhaustion.
 * Sarvam returns: HTTP 429 + { error: { code: 'insufficient_quota_error' } }
 * 
 * @param {Error} error - The Axios error
 * @returns {boolean}
 */
function isQuotaExhausted(error) {
  if (!error.response) return false;
  
  const status = error.response.status;
  const errorCode = error.response.data?.error?.code;
  const errorMessage = error.response.data?.error?.message || '';

  return (
    status === 429 ||
    errorCode === 'insufficient_quota_error' ||
    errorMessage.toLowerCase().includes('quota') ||
    errorMessage.toLowerCase().includes('rate limit')
  );
}

/**
 * Executes an API call with automatic key rotation on quota exhaustion.
 * 
 * Flow:
 *   1. Get active key from keyManager (cached)
 *   2. Execute requestFn with that key
 *   3. On success → record usage, return result
 *   4. On 429/quota → mark key expired → retry with next key
 *   5. Repeat up to MAX_KEY_RETRIES times
 * 
 * @param {(apiKey: string) => Promise<any>} requestFn - Function that makes the API call
 * @returns {Promise<any>} The API response
 */
async function callWithRetry(requestFn) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_KEY_RETRIES; attempt++) {
    let apiKey;
    
    try {
      apiKey = await getActiveKey();
    } catch (err) {
      // No active keys left at all
      throw err;
    }

    try {
      const result = await requestFn(apiKey);
      
      // Success — record usage (fire-and-forget, don't block response)
      recordUsage(apiKey).catch(e => 
        console.error('[KeyManager] Failed to record usage:', e.message)
      );
      
      return result;

    } catch (error) {
      if (isQuotaExhausted(error)) {
        console.warn(`[Sarvam] 🔄 Key quota exhausted (attempt ${attempt + 1}/${MAX_KEY_RETRIES}). Rotating...`);
        await markExpired(apiKey);
        lastError = error;
        // Loop continues → getActiveKey() will fetch next key from DB
      } else {
        // Non-quota error (network, 400, 500, etc.) — don't rotate, just throw
        throw error;
      }
    }
  }

  // All retries exhausted
  const err = new Error('ALL_KEYS_EXHAUSTED: All Sarvam API keys have been used up.');
  err.statusCode = 503;
  err.originalError = lastError;
  throw err;
}

/**
 * Smartly splits text into chunks under a specific character limit without breaking sentences.
 * @param {string} text 
 * @param {number} limit 
 * @returns {string[]}
 */
function chunkTextSafely(text, limit = 2000) {
  if (text.length <= limit) return [text];
  
  // Split by common sentence terminators in English, Hindi, and Sanskrit
  const regex = /([^.!?।॥|]+[.!?।॥|]+)/g;
  const sentences = text.match(regex) || [text];
  
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk.length + sentence.length) > limit) {
      if (currentChunk) chunks.push(currentChunk.trim());
      
      // If a single sentence is bizarrely larger than the limit, forcefully slice it
      if (sentence.length > limit) {
        let remaining = sentence;
        while (remaining.length > 0) {
          chunks.push(remaining.slice(0, limit).trim());
          remaining = remaining.slice(limit);
        }
        currentChunk = '';
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += ' ' + sentence;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Generates an audio buffer from text using Sarvam TTS.
 * Automatically rotates API key on quota exhaustion.
 * 
 * @param {string} text - The text to synthesize.
 * @param {string} languageCode - e.g., 'sa-IN', 'hi-IN', 'en-IN'
 * @returns {Promise<Buffer>} The audio buffer.
 */
async function generateTTSChunk(text, languageCode) {
  return limiter.schedule(async () => {
    return callWithRetry(async (apiKey) => {
      const payload = {
        text: text,
        target_language_code: languageCode,
        speaker: 'shubh',
        pace: 1.0,
        model: 'bulbul:v3'
      };

      const response = await axios.post(TTS_URL, payload, {
        headers: {
          'api-subscription-key': apiKey,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.data || !response.data.audios || response.data.audios.length === 0) {
        throw new Error('No audio returned from Sarvam API');
      }

      const base64Audio = response.data.audios[0];
      return Buffer.from(base64Audio, 'base64');
    });
  });
}

module.exports = { generateTTSChunk, chunkTextSafely };
