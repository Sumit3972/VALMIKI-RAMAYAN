require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    await client.connect();
    console.log('Connected to database. Creating gemini_api_keys table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS gemini_api_keys (
        id SERIAL PRIMARY KEY,
        api_key TEXT UNIQUE NOT NULL,
        label VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active',
        total_requests INT DEFAULT 0,
        last_used_at TIMESTAMP WITH TIME ZONE,
        expired_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('gemini_api_keys table created successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
