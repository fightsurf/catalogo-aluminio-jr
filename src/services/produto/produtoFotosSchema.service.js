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
        ADD COLUMN IF NOT EXISTS foto_6 TEXT,
        ADD COLUMN IF NOT EXISTS observacao TEXT,
        ADD COLUMN IF NOT EXISTS perfil_kit_feirinha BOOLEAN DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS perfil_orcamento BOOLEAN DEFAULT TRUE
    `);

    await pool.query(`
      UPDATE produtos
      SET perfil_kit_feirinha = COALESCE(perfil_kit_feirinha, TRUE),
          perfil_orcamento = COALESCE(perfil_orcamento, TRUE)
      WHERE perfil_kit_feirinha IS NULL
         OR perfil_orcamento IS NULL
    `);

    await pool.query(`
      ALTER TABLE produtos
        ALTER COLUMN perfil_kit_feirinha SET DEFAULT TRUE,
        ALTER COLUMN perfil_kit_feirinha SET NOT NULL,
        ALTER COLUMN perfil_orcamento SET DEFAULT TRUE,
        ALTER COLUMN perfil_orcamento SET NOT NULL
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
