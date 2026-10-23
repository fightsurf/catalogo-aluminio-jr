const fs = require('fs');
const path = require('path');
const pool = require('../../../db/connection');

module.exports = async function migrarAvn() {
  const arquivo = path.join(__dirname, '../../../db/sql/20261022_avn_usuario.sql');
  const sql = fs.readFileSync(arquivo, 'utf8');
  await pool.query(sql);
  console.log('[AVN] Estrutura avn_usuario verificada.');
};
