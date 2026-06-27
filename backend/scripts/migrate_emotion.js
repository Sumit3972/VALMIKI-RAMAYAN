require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to DB. Altering table for emotion...');
    await client.query(`
      ALTER TABLE ramayana_shlokas 
      ADD COLUMN IF NOT EXISTS emotion VARCHAR(50) DEFAULT 'neutral';
    `);
    console.log('Database migration for emotion column successful!');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
