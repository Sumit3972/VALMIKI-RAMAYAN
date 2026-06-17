const { Client } = require('pg');
require('dotenv').config();

async function query(text, params) {
  const connectionString = process.env.DATABASE_URL;
  const client = new Client({
    connectionString: connectionString
  });
  
  await client.connect();
  try {
    return await client.query(text, params);
  } finally {
    await client.end().catch(err => {
      console.error('Error closing database client:', err.message);
    });
  }
}

module.exports = {
  query,
  get pool() {
    return {
      query: (t, p) => query(t, p)
    };
  }
};
