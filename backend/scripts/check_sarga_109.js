const db = require('../src/db');

async function check() {
  try {
    const result = await db.query(
      `SELECT id, kanda, sarga, shloka_number, shloka_index, sanskrit, translation 
       FROM ramayana_shlokas 
       WHERE kanda = 2 AND sarga = 109 
       ORDER BY shloka_index ASC`
    );

    const rows = result.rows;
    console.log(`Checking duplicates for ${rows.length} shlokas in Kanda 2, Sarga 109:`);

    const translationMap = {};
    rows.forEach(row => {
      const trans = row.translation ? row.translation.trim() : '';
      if (!trans) {
        console.log(`[EMPTY TRANSLATION] Shloka ${row.shloka_number} is empty!`);
        return;
      }
      if (translationMap[trans]) {
        translationMap[trans].push(row.shloka_number);
      } else {
        translationMap[trans] = [row.shloka_number];
      }
    });

    Object.keys(translationMap).forEach(trans => {
      const shlokas = translationMap[trans];
      if (shlokas.length > 1) {
        console.log(`[DUPLICATED TRANSLATION] The following shlokas have identical translations (${shlokas.join(', ')}):\n"${trans.slice(0, 150)}..."\n`);
      }
    });

  } catch (err) {
    console.error('Error querying DB:', err.message);
  } finally {
    process.exit(0);
  }
}

check();
