const axios = require('axios');
const db = require('../src/db');
require('dotenv').config();

async function test() {
  try {
    console.log('Querying shloka 1 details...');
    const shlokaRes = await db.query('SELECT * FROM ramayana_shlokas WHERE id = 1');
    if (shlokaRes.rows.length === 0) {
      console.log('Shloka 1 not found in database.');
      return;
    }
    const shloka = shlokaRes.rows[0];
    console.log('Current shloka data:', {
      id: shloka.id,
      kanda: shloka.kanda,
      sarga: shloka.sarga,
      shloka_number: shloka.shloka_number,
      speaker_character: shloka.speaker_character,
      audio_sanskrit_url: shloka.audio_sanskrit_url,
      audio_hindi_url: shloka.audio_hindi_url,
      audio_english_url: shloka.audio_english_url
    });

    console.log('\nClearing audio URLs and speaker_character for shloka 1 to force classification & regeneration...');
    await db.query('UPDATE ramayana_shlokas SET speaker_character = NULL, audio_sanskrit_url = NULL, audio_hindi_url = NULL, audio_english_url = NULL WHERE id = 1');

    console.log('\nGenerating Sanskrit audio (which triggers speaker classification)...');
    let res = await axios.post('http://127.0.0.1:3000/audio', { shloka_id: 1, type: 'sanskrit' });
    console.log('Sanskrit audio generated successfully! Result:', res.data);

    console.log('\nQuerying shloka 1 details again to verify cached speaker and audio URL...');
    const updatedRes = await db.query('SELECT * FROM ramayana_shlokas WHERE id = 1');
    const updatedShloka = updatedRes.rows[0];
    console.log('Updated shloka data:', {
      id: updatedShloka.id,
      speaker_character: updatedShloka.speaker_character,
      audio_sanskrit_url: updatedShloka.audio_sanskrit_url
    });

  } catch(e) {
    console.error('Error in test:', e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
  } finally {
    process.exit(0);
  }
}
test();
