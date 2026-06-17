require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to DB. Altering table for audio translations...');
    await client.query(`
      ALTER TABLE ramayana_shlokas 
      ADD COLUMN IF NOT EXISTS audio_translation_hi TEXT,
      ADD COLUMN IF NOT EXISTS audio_translation_en TEXT;
    `);
    console.log('Migration of audio translation columns successful!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
