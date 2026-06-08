require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to DB. Altering table for speaker_character...');
    await client.query(`
      ALTER TABLE ramayana_shlokas 
      ADD COLUMN IF NOT EXISTS speaker_character VARCHAR(50) DEFAULT 'valmiki';
    `);
    console.log('Database migration for speaker_character column successful!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
