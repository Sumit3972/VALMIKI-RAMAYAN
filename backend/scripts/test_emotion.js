const db = require('../src/db');
const { getOrGenerateAudioDetails } = require('../api/server.js');
const { generateTTSChunk } = require('../src/sarvam.js');

async function runTest() {
  try {
    console.log('Fetching a shloka to test...');
    const res = await db.query('SELECT * FROM ramayana_shlokas ORDER BY id LIMIT 1');
    if (res.rows.length === 0) {
      console.log('No shlokas in DB.');
      return;
    }
    const shloka = res.rows[0];
    console.log('Original Shloka:', {
      id: shloka.id,
      sanskrit: shloka.sanskrit,
      translation: shloka.translation,
      speaker_character: shloka.speaker_character,
      emotion: shloka.emotion
    });

    // Clear cached speaker and translation so we force Gemini execution
    console.log('\nTemporarily setting speaker and translation to null to force LLM generation...');
    const originalSpeaker = shloka.speaker_character;
    const originalTranslationHi = shloka.audio_translation_hi;
    const originalEmotion = shloka.emotion;
    
    await db.query('UPDATE ramayana_shlokas SET speaker_character = NULL, audio_translation_hi = NULL, emotion = NULL WHERE id = $1', [shloka.id]);
    
    // Query it fresh from DB to make sure fields are null
    const freshRes = await db.query('SELECT * FROM ramayana_shlokas WHERE id = $1', [shloka.id]);
    const freshShloka = freshRes.rows[0];

    console.log('\nCalling getOrGenerateAudioDetails for Hindi...');
    const details = await getOrGenerateAudioDetails(freshShloka, 'hi');
    console.log('Gemini prep details returned:', details);

    // Verify it saved in DB
    const finalRes = await db.query('SELECT * FROM ramayana_shlokas WHERE id = $1', [shloka.id]);
    console.log('Database updated row:', {
      speaker_character: finalRes.rows[0].speaker_character,
      audio_translation_hi: finalRes.rows[0].audio_translation_hi,
      emotion: finalRes.rows[0].emotion
    });

    // Revert the row changes to keep DB clean
    console.log('\nRestoring original DB values...');
    await db.query('UPDATE ramayana_shlokas SET speaker_character = $1, audio_translation_hi = $2, emotion = $3 WHERE id = $4', 
      [originalSpeaker, originalTranslationHi, originalEmotion, shloka.id]);

    console.log('\nTesting generateTTSChunk locally with custom emotion...');
    // We will generate a short text using the emotion return or custom 'sorrow'
    const testText = "अहो! यह बहुत ही दुःखद घटना है...";
    console.log(`Generating audio for text: "${testText}" with voice 'aditya' and emotion 'sorrow'...`);
    const audioBuffer = await generateTTSChunk(testText, 'hi-IN', 'aditya', 'sorrow');
    console.log(`Successfully generated TTS audio chunk! Buffer length: ${audioBuffer.length} bytes.`);

  } catch (err) {
    console.error('Error running test:', err);
  } finally {
    process.exit(0);
  }
}

runTest();
