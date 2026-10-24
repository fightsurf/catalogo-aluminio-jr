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
  // Catálogo local instalado pelo npm: nenhuma consulta externa no runtime.
  try {
    const {rows:[contagem]}=await pool.query("SELECT COUNT(*)::int AS total FROM public.avn_exercicios WHERE midia_url LIKE '/avn/sistema/midias/%'");
    if(contagem.total >= 302) return;
    const {importarCatalogo}=require('./avn-treinos-catalogo.service');
    const r=await importarCatalogo();
    console.log('[AVN] Catálogo ilustrado sincronizado: '+r.total+' exercícios.');
  } catch(e) { console.error('[AVN] Falha ao importar catálogo SVG local. A aplicação continuará, mas o AVN pode apresentar imagens ausentes:',e); }
};
