'use strict';
const fs = require('fs');
const path = require('path');
const pool = require('../../../db/connection');

module.exports = async function migrarAvn() {
  for (const nome of [
    '20261022_avn_usuario.sql',
    '20261024_avn_health.sql',
    '20261024_avn_treinos.sql',
    '20261024_avn_nutricao.sql',
    '20261025_avn_receitas.sql',
    '20261025_avn_treino_perfil_equipamentos.sql',
    '20261026_avn_treinos_mobile.sql',
  ]) {
    const sql=fs.readFileSync(path.join(__dirname,'../../../db/sql',nome),'utf8');
    await pool.query(sql);
  }
  console.log('[AVN] Migrações de usuários, saúde, treinos e nutrição verificadas.');
  // Não consulta serviços externos: arquivos e manifesto vêm do pacote npm do build.
  try {
    const catalogo=require('./avn-treinos-catalogo.service');
    const manifest=catalogo.loadManifest();
    const ext=manifest[0].frames[0].path.endsWith('.png')?'.png':'.svg';
    // Só considera concluídos os 302 arquivos quando têm a extensão REAL do pacote.
    const {rows:[contagem]}=await pool.query(
      'SELECT COUNT(*)::int AS total FROM public.avn_exercicios WHERE midia_url LIKE $1 AND RIGHT(midia_url,4)=$2',
      ['/avn/sistema/midias/%',ext]
    );
    if(contagem.total>=302)return;
    const r=await catalogo.importarCatalogo();
    console.log('[AVN] Catálogo ilustrado sincronizado: '+r.total+' exercícios ('+ext+').');
  } catch(e) {
    console.error('[AVN] Falha ao importar catálogo local. A aplicação continuará, mas os exercícios podem apresentar mídias ausentes:',e);
  }
};
