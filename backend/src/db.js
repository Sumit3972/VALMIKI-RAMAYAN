const { Pool } = require('pg');
require('dotenv').config();

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    pool = new Pool({
      connectionString: connectionString,
      max: 5,
      idleTimeoutMillis: 10000
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client:', err.message);
    });
  }
  return pool;
}

module.exports = {
  query: (text, params) => getPool().query(text, params),
  get pool() {
    return getPool();
  }
};
