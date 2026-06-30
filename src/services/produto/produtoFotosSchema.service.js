const pool = require('../../../db/connection');

let schemaReady = null;

async function criarEstrutura() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    await pool.query(`
      ALTER TABLE produtos
        ADD COLUMN IF NOT EXISTS foto_2 TEXT,
        ADD COLUMN IF NOT EXISTS foto_3 TEXT,
        ADD COLUMN IF NOT EXISTS foto_4 TEXT,
        ADD COLUMN IF NOT EXISTS foto_5 TEXT,
        ADD COLUMN IF NOT EXISTS foto_6 TEXT
    `);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}

module.exports = {
  criarEstrutura,
};
