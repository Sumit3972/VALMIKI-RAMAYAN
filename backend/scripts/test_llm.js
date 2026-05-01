const axios = require('axios');
const db = require('../src/db');
require('dotenv').config();

async function test() {
  try {
    await db.query('UPDATE ramayana_shlokas SET translation_hi = NULL, translation_tts_en = NULL, audio_hindi_url = NULL, audio_english_url = NULL WHERE id = 1');
    console.log('Cleared DB cache for id = 1');

    console.log('Testing /translate for hindi...');
    let res = await axios.post('http://127.0.0.1:3000/translate', { shloka_id: 1, lang: 'hi' });
    console.log('Hindi Translation Result:\n', res.data.text);

    console.log('\nTesting /translate for english...');
    res = await axios.post('http://127.0.0.1:3000/translate', { shloka_id: 1, lang: 'en' });
    console.log('English Translation Result:\n', res.data.text);

  } catch(e) {
    console.error(e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
  } finally {
    process.exit(0);
  }
}
test();
