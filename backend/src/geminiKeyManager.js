/**
 * Gemini API Key Pool Manager
 * 
 * Manages a DB-backed pool of Gemini API keys with in-memory caching.
 * When a key is exhausted (429 Resource Exhausted), it's pushed to the back of the queue
 * (round-robin) so it can be retried later when its rate limit resets.
 */
const db = require('./db');

// In-memory cache — avoids DB hit on every request
let cachedKey = null;

/**
 * Returns the next active API key (least-recently-used first).
 * Uses in-memory cache; only hits DB when cache is empty.
 * 
 * @returns {Promise<string>} The active API key
 * @throws {Error} ALL_KEYS_EXHAUSTED if no active keys remain
 */
async function getActiveKey() {
  if (cachedKey) return cachedKey;

  const result = await db.query(
    `SELECT api_key FROM gemini_api_keys 
     WHERE status = 'active' 
     ORDER BY last_used_at ASC NULLS FIRST 
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    throw new Error('ALL_KEYS_EXHAUSTED: No active Gemini API keys remaining.');
  }

  cachedKey = result.rows[0].api_key;
  console.log(`[GeminiKeyManager] Active key loaded: ${maskKey(cachedKey)}`);
  return cachedKey;
}

/**
 * Marks an API key as permanently expired in the DB.
 * Clears in-memory cache so next getActiveKey() picks a new key.
 * 
 * @param {string} apiKey - The key to mark as expired
 */
async function markExpired(apiKey) {
  await db.query(
    `UPDATE gemini_api_keys 
     SET status = 'expired', expired_at = NOW() 
     WHERE api_key = $1 AND status = 'active'`,
    [apiKey]
  );

  console.log(`[GeminiKeyManager] ❌ Key EXPIRED (Permanently Invalid/Leaked): ${maskKey(apiKey)}`);
  cachedKey = null;
}

/**
 * Rotates the API key by updating its last_used_at timestamp.
 * This pushes it to the back of the queue for the round-robin loop.
 * Clears in-memory cache so next getActiveKey() picks a new key.
 * 
 * @param {string} apiKey - The key that hit a rate limit
 */
async function rotateKey(apiKey) {
  await db.query(
    `UPDATE gemini_api_keys 
     SET last_used_at = NOW() 
     WHERE api_key = $1`,
    [apiKey]
  );

  console.log(`[GeminiKeyManager] 🔄 Key Rate Limited (429). Pushed to back of queue: ${maskKey(apiKey)}`);

  // Clear cache so next call picks a fresh key from DB
  cachedKey = null;
}

/**
 * Records a successful API usage for the key.
 * Increments counter and updates last_used_at.
 * 
 * @param {string} apiKey - The key that was used
 */
async function recordUsage(apiKey) {
  await db.query(
    `UPDATE gemini_api_keys 
     SET total_requests = total_requests + 1, last_used_at = NOW() 
     WHERE api_key = $1`,
    [apiKey]
  );
}

/**
 * Returns status of all keys for monitoring.
 * 
 * @returns {Promise<Array>} Array of key status objects
 */
async function getKeyStats() {
  const result = await db.query(
    `SELECT id, label, status, total_requests, last_used_at, expired_at,
            LEFT(api_key, 12) || '...' || RIGHT(api_key, 4) as masked_key
     FROM gemini_api_keys 
     ORDER BY id`
  );
  return result.rows;
}

/**
 * Masks an API key for safe logging.
 * @param {string} key 
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length < 16) return '***';
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}

module.exports = { getActiveKey, rotateKey, markExpired, recordUsage, getKeyStats };
