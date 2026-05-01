require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function clearData() {
  try {
    await client.connect();
    console.log('Connected to database. Clearing generated translations and audio URLs...');

    const result = await client.query(`
      UPDATE ramayana_shlokas 
      SET 
        translation_hi = NULL,
        translation_tts_en = NULL,
        audio_sanskrit_url = NULL,
        audio_english_url = NULL,
        audio_hindi_url = NULL
    `);

    console.log(`Successfully cleared data for ${result.rowCount} shlokas.`);

  } catch (err) {
    console.error('Failed to clear data:', err.message);
  } finally {
    await client.end();
  }
}

clearData();
