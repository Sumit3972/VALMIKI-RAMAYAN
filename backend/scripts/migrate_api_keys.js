require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrateApiKeys() {
  try {
    await client.connect();
    console.log('Connected to DB. Creating sarvam_api_keys table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS sarvam_api_keys (
        id SERIAL PRIMARY KEY,
        api_key TEXT NOT NULL UNIQUE,
        label TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        total_requests INT DEFAULT 0,
        last_used_at TIMESTAMPTZ,
        expired_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Index for fast active key lookup
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sarvam_keys_status 
      ON sarvam_api_keys (status, last_used_at ASC);
    `);

    console.log('Migration successful! Table sarvam_api_keys created.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrateApiKeys();
