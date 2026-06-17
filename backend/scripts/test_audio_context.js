const axios = require('axios');
const db = require('../src/db');
require('dotenv').config();

async function test() {
  try {
    console.log('Clearing shloka 1 to force classification...');
    await db.query('UPDATE ramayana_shlokas SET speaker_character = NULL, audio_sanskrit_url = NULL, audio_hindi_url = NULL, audio_english_url = NULL, audio_translation_hi = NULL, audio_translation_en = NULL WHERE id = 1');

    // We will test if single audio generation runs successfully.
    // Shloka 1 classification will typically classify as 'valmiki' narrator.
    console.log('\nGenerating Sanskrit audio for Shloka 1 (should classify and run without prefix since it is valmiki)...');
    let res = await axios.post('http://127.0.0.1:3000/audio', { shloka_id: 1, type: 'sanskrit' });
    console.log('Sanskrit audio generated. Result:', res.data);

    // Query DB to see speaker character
    let shlokaRes = await db.query('SELECT * FROM ramayana_shlokas WHERE id = 1');
    console.log('DB Speaker Character after classification:', shlokaRes.rows[0].speaker_character);

    // Now, force speaker_character to 'sri_ram' to test prefix generation.
    console.log('\nForcing speaker_character of shloka 1 to "sri_ram" and clearing audio URLs and translations...');
    await db.query("UPDATE ramayana_shlokas SET speaker_character = 'sri_ram', audio_sanskrit_url = NULL, audio_hindi_url = NULL, audio_english_url = NULL, audio_translation_hi = NULL, audio_translation_en = NULL WHERE id = 1");

    console.log('\nGenerating Hindi audio for shloka 1 (now forced to "sri_ram" - should prefix with "श्री राम बोले: ")...');
    res = await axios.post('http://127.0.0.1:3000/audio', { shloka_id: 1, type: 'hi' });
    console.log('Hindi audio generated successfully! URLs:', res.data.urls);

    // Check DB urls cached
    shlokaRes = await db.query('SELECT * FROM ramayana_shlokas WHERE id = 1');
    console.log('Cached Hindi URLs in DB:', shlokaRes.rows[0].audio_hindi_url);

  } catch(e) {
    console.error('Error in test:', e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
  } finally {
    process.exit(0);
  }
}
test();
