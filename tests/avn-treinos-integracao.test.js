'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=p=>fs.readFileSync(path.join(root,p),'utf8');

test('patch direto preserva server.js e não exige instalador',()=>{
 assert.equal(fs.existsSync(path.join(root,'server.js')),true);
 assert.equal(fs.existsSync(path.join(root,'APLICAR_PATCH_AVN_TREINOS.js')),false);
 for(const p of ['src/routes/avn/avn-sistema.routes.js','src/services/avn/avn-migration.service.js'])assert.ok(fs.existsSync(path.join(root,p)));
});
test('mantém migrações AVN anteriores e novas tabelas prefixadas',()=>{
 const m=file('src/services/avn/avn-migration.service.js');
 for(const s of ['20261022_avn_usuario.sql','20261024_avn_health.sql','20261024_avn_treinos.sql'])assert.ok(m.includes(s));
 const sql=file('db/sql/20261024_avn_treinos.sql');
 assert.ok(!/\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i.test(sql));
 assert.ok((sql.match(/CREATE TABLE IF NOT EXISTS public\.avn_/g)||[]).length>=7);
 assert.ok((sql.match(/https:\/\/cdn\.jsdelivr\.net\/gh\/bryllim/g)||[]).length>0);
});
test('quatro telas ligadas à central protegida e URLs consistentes',()=>{
 const route=file('src/routes/avn/avn-sistema.routes.js');
 const js=file('public/js/avn-treinos.js');
 assert.match(route,/requireAuth/);
 assert.match(route,/api\/treinos/);
 assert.match(js,/const API='\/avn\/sistema\/api\/treinos'/);
 for(const page of ['exercicios','montador','meus-treinos','treinar']){
  assert.ok(fs.existsSync(path.join(root,'views/avn/'+page+'.html')));
  assert.ok(route.includes("'"+page+"'"));
  assert.ok(file('views/avn/'+page+'.html').includes('/avn/sistema/'+page));
 }
});
test('atribuição obrigatória das ilustrações em todas as telas',()=>{
 for(const f of ['exercicios','montador','meus-treinos','treinar']){
   const html=file('views/avn/'+f+'.html');
   for(const k of ['bryllim/workout-guide','everkinetic/data','CC BY-SA 4.0'])assert.ok(html.includes(k));
 }
});
test('importação valida manifesto e possui dicionário de nomes em português',()=>{
 const source=file('src/services/avn/avn-treinos-catalogo.service.js');
 const pt=file('src/services/avn/avn-treinos-ptbr.js');
 assert.match(source,/function validManifest\(arr\)/);
 assert.match(source,/await client\.query\('BEGIN'\)/);
 assert.match(source,/ON CONFLICT\(slug\) DO UPDATE/);
 assert.ok((pt.match(/:'[^']+'/g)||[]).length>150);
});

test('a biblioteca oficial é dependência de produção e é servida pelo AVN, não por CDN',()=>{
 const pkg=JSON.parse(file('package.json'));
 assert.equal(pkg.dependencies['@bryllim/workout-guide'],'1.0.0');
 const route=file('src/routes/avn/avn-sistema.routes.js');
 assert.match(route,/router\.use\('\/midias'/);
 assert.match(route,/requireAuth, express\.static/);
 const catalog=file('src/services/avn/avn-treinos-catalogo.service.js');
 assert.match(catalog,/require\.resolve\('@bryllim\/workout-guide\/manifest\.json'\)/);
 assert.match(catalog,/LOCAL_BASE\+e\.slug/);
 assert.doesNotMatch(catalog,/fetch\(MANIFEST/);
});
test('o SVG originalmente branco usa moldura contrastante e filtro apenas na ilustração',()=>{
 const css=file('public/css/avn-treinos.css');
 assert.match(css,/\.thumb-frame img\.thumb/);
 assert.match(css,/filter:brightness\(0\)/);
 const js=file('public/js/avn-treinos.js');
 assert.match(js,/thumb-frame/);
 assert.match(js,/media-preview-frame/);
});
