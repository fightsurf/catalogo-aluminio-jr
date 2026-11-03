'use strict';
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../../../db/connection');
let pronto = false;
let emExecucao = null;
async function criarEstrutura() {
  if (pronto) return;
  if (!emExecucao) {
    emExecucao = (async () => {
      for (const arquivo of ['20261103_compras.sql','20261103_compras_campos_opcionais.sql']) {
        const sql = fs.readFileSync(path.join(__dirname, '../../../db/sql', arquivo), 'utf8');
        await pool.query(sql);
      }
      pronto = true;
    })().finally(() => { emExecucao = null; });
  }
  return emExecucao;
}
module.exports = { criarEstrutura };
