'use strict';
const fs = require('fs');
const path = require('path');
const pool = require('../../../db/connection');

module.exports = async function migrarAvn() {
  for (const nome of [
    '20261022_avn_usuario.sql',
    '20261024_avn_health.sql',
    '20261024_avn_treinos.sql',
  ]) {
    const sql=fs.readFileSync(path.join(__dirname,'../../../db/sql',nome),'utf8');
    await pool.query(sql);
  }
  console.log('[AVN] Migrações de usuários, saúde e treinos verificadas.');
  // A rede externa não é pré-requisito para iniciar o sistema.
  // Após a importação inicial, não consulta o GitHub em todo restart do Render.
  try {
    const {rows:[contagem]}=await pool.query("SELECT COUNT(*)::int AS total FROM public.avn_exercicios WHERE slug LIKE 'wg-%'");
    if(contagem.total >= 180) return;
    const {importarCatalogo}=require('./avn-treinos-catalogo.service');
    const r=await importarCatalogo({timeoutMs:6500});
    console.log('[AVN] Catálogo ilustrado sincronizado: '+r.total+' exercícios.');
  } catch(e) { console.warn('[AVN] Catálogo externo não sincronizado (74 exercícios locais permanecem disponíveis):',e.message); }
};
