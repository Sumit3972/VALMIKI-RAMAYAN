/**
 * Seed script: reads API keys from file.txt and upserts into sarvam_api_keys table.
 * 
 * Usage:
 *   node seed_keys.js           # Insert keys from file.txt (skips duplicates)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seedKeys() {
  const filePath = path.join(__dirname, 'file.txt');

  if (!fs.existsSync(filePath)) {
    console.error('file.txt not found! Place your API keys in file.txt (one per line).');
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const keys = raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && line.startsWith('sk_'));

  if (keys.length === 0) {
    console.error('No valid API keys found in file.txt (expected lines starting with sk_).');
    process.exit(1);
  }

  console.log(`Found ${keys.length} API keys in file.txt`);

  try {
    await client.connect();

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const label = `key_${i + 1}`;

      try {
        await client.query(
          `INSERT INTO sarvam_api_keys (api_key, label, status) 
           VALUES ($1, $2, 'active') 
           ON CONFLICT (api_key) DO NOTHING`,
          [key, label]
        );
        inserted++;
        console.log(`  ✓ ${label}: ${key.slice(0, 12)}...${key.slice(-4)} → inserted`);
      } catch (err) {
        skipped++;
        console.log(`  ✗ ${label}: ${key.slice(0, 12)}...${key.slice(-4)} → skipped (${err.message})`);
      }
    }

    // Show final status
    const result = await client.query(
      `SELECT label, status, 
              LEFT(api_key, 12) || '...' || RIGHT(api_key, 4) as masked_key 
       FROM sarvam_api_keys ORDER BY id`
    );

    console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);
    console.log('\nCurrent key pool:');
    console.table(result.rows);

  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await client.end();
  }
}

seedKeys();
