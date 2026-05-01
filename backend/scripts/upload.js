const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function upload() {
  const client = await pool.connect();
  try {
    console.log('Reading dataset...');
    const filePath = 'valmiki_ramayana_dataset.json';
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`Loaded ${data.length} records.`);

    console.log('Preparing table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ramayana_shlokas (
        id SERIAL PRIMARY KEY,
        kanda INT NOT NULL,
        sarga INT NOT NULL,
        shloka_index INT NOT NULL,
        shloka_number TEXT,
        sanskrit TEXT NOT NULL,
        translation TEXT NOT NULL,
        translation_hi TEXT,
        translation_tts_en TEXT,
        audio_sanskrit_url TEXT,
        audio_english_url TEXT,
        audio_hindi_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ramayana_lookup ON ramayana_shlokas (kanda, sarga, shloka_index)
    `);

    // console.log('Clearing existing data...');
    // await client.query('TRUNCATE ramayana_shlokas');

    console.log(`Starting batch insert for ${data.length} shlokas...`);
    
    const startTime = Date.now();
    const batchSize = 100;
    const sargaCounts = {};

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Build a multi-row insert query
      // INSERT INTO table (cols) VALUES ($1, $2, ...), ($n, $n+1, ...)
      const values = [];
      const placeholders = [];
      
      batch.forEach((item, index) => {
        const key = `${item.kanda}-${item.sarga}`;
        sargaCounts[key] = (sargaCounts[key] || 0) + 1;
        const shlokaIndex = sargaCounts[key];

        const base = index * 6; // 6 columns
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
        values.push(
          item.kanda,
          item.sarga,
          shlokaIndex,
          item.shloka_num,
          item.sanskrit,
          item.translation
        );
      });

      const query = `
        INSERT INTO ramayana_shlokas 
        (kanda, sarga, shloka_index, shloka_number, sanskrit, translation) 
        VALUES ${placeholders.join(', ')}
      `;

      await client.query(query, values);
      
      const progress = Math.min(i + batchSize, data.length);
      const percent = ((progress / data.length) * 100).toFixed(1);
      process.stdout.write(`\rProgress: ${percent}% (${progress}/${data.length})`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n\nSuccess! Uploaded ${data.length} shlokas in ${duration} seconds.`);
    
  } catch (err) {
    console.error('\nError during upload:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
  } finally {
    client.release();
    await pool.end();
  }
}

upload();
