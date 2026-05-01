require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to DB. Altering table...');
    await client.query(`
      ALTER TABLE ramayana_shlokas 
      ADD COLUMN IF NOT EXISTS translation_hi TEXT,
      ADD COLUMN IF NOT EXISTS translation_tts_en TEXT,
      ADD COLUMN IF NOT EXISTS audio_sanskrit_url TEXT,
      ADD COLUMN IF NOT EXISTS audio_english_url TEXT,
      ADD COLUMN IF NOT EXISTS audio_hindi_url TEXT;
    `);
    console.log('Migration successful!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
