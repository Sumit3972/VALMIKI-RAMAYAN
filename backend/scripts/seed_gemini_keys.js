require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const geminiKeys = [
  "AIzaSyAc7FOuVBpf0iaXIVW_j5nwT1yWCRK4ekA",
  "AIzaSyAj93lUtC4vAVYN8AS0bwy4YNgvvr6W80g",
  "AIzaSyBH4LnIbXmGMZSqjIAbR5z2MgSpkCMAVQM",
  "AIzaSyCX1uqdRBoKxXsiQRpo41Fi2yIQFm3lwZY",
  "AIzaSyDSXehMNh44hBzFpyVcqGYrB0rN4Holo08",
  "AIzaSyDTQYLS9Dt-dR6dFgGzL3HqWa0s4AZKkX4"
];

async function seedKeys() {
  try {
    await client.connect();

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < geminiKeys.length; i++) {
      const key = geminiKeys[i];
      const label = `gemini_key_${i + 1}`;

      try {
        await client.query(
          `INSERT INTO gemini_api_keys (api_key, label, status) 
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
       FROM gemini_api_keys ORDER BY id`
    );

    console.log(`\nDone! Inserted: ${inserted}, Skipped: ${skipped}`);
    console.log('\nCurrent Gemini key pool:');
    console.table(result.rows);

  } catch (err) {
    console.error('Seed failed:', err.message);
  } finally {
    await client.end();
  }
}

seedKeys();
