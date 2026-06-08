const axios = require('axios');
const db = require('../src/db');
require('dotenv').config();

async function test() {
  try {
    // Clear cache for shlokas 26 and 27
    await db.query('UPDATE ramayana_shlokas SET translation_hi = NULL WHERE shloka_number IN (\'2.109.26\', \'2.109.27\')');
    console.log('Cleared Hindi translation cache for Shlokas 2.109.26 and 2.109.27.\n');

    // Fetch details
    const result = await db.query('SELECT * FROM ramayana_shlokas WHERE shloka_number IN (\'2.109.26\', \'2.109.27\') ORDER BY shloka_number ASC');
    const row26 = result.rows[0];
    const row27 = result.rows[1];

    console.log('--- Shloka 26 Sanskrit ---');
    console.log(row26.sanskrit);
    console.log('--- Shloka 26 Reference English ---');
    console.log(row26.translation);

    console.log('\n--- Shloka 27 Sanskrit ---');
    console.log(row27.sanskrit);
    console.log('--- Shloka 27 Reference English ---');
    console.log(row27.translation);

    console.log('\nTranslating Shloka 26 into Hindi via API...');
    let res = await axios.post('http://127.0.0.1:3000/translate', { shloka_id: row26.id, lang: 'hi' });
    console.log('Shloka 26 Hindi Translation Result:\n', res.data.text);

    console.log('\nTranslating Shloka 27 into Hindi via API...');
    res = await axios.post('http://127.0.0.1:3000/translate', { shloka_id: row27.id, lang: 'hi' });
    console.log('Shloka 27 Hindi Translation Result:\n', res.data.text);

  } catch (err) {
    console.error('Error in test:', err.response ? JSON.stringify(err.response.data, null, 2) : err.message);
  } finally {
    process.exit(0);
  }
}

test();
