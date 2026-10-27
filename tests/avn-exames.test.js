'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('migração aditiva de exames é carregada pelo AVN',()=>{
 const migration=read('src/services/avn/avn-migration.service.js');
 const sql=read('db/sql/20261027_avn_exames_laboratoriais.sql');
 assert.match(migration,/20261027_avn_exames_laboratoriais\.sql/);
 for(const table of ['avn_exames_catalogo','avn_exames_referencias','avn_exames_resultados'])
  assert.match(sql,new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+table));
 assert.match(sql,/ON CONFLICT\(codigo\) DO NOTHING/);
 assert.doesNotMatch(sql,/^\s*(DROP|TRUNCATE)\b/mi);
 assert.match(sql,/usuario_id BIGINT NOT NULL REFERENCES public\.avn_usuario/);
});
test('Saúde tem rota autenticada e menu cadastrado',()=>{
 const routes=read('src/routes/avn/avn-sistema.routes.js');
 assert.match(routes,/categoria:'Saúde'/);
 assert.match(routes,/router\.use\('\/api\/exames', requireAuth, avnExamesRoutes\)/);
 assert.match(routes,/router\.get\('\/saude\/exames', requireAuth/);
 assert.match(routes,/todosApps = \[\.\.\.treinoApps, \.\.\.nutricaoApps, \.\.\.corporalApps, \.\.\.saudeApps\]/);
});
test('API de resultados exige usuário, valida dados e salva apenas depois da confirmação',()=>{
 const api=read('src/routes/avn/avn-exames.routes.js');
 assert.match(api,/checkUser\(uid/);
 assert.match(api,/FROM public\.avn_exames_resultados/);
 assert.match(api,/router\.post\('\/resultados\/lote'/);
 assert.match(api,/router\.post\('\/interpretar'/);
 assert.match(api,/store:false/);
 assert.match(api,/FOR KEY SHARE/);
 assert.match(api,/REFERENCIA|referencia/);
 assert.match(api,/duplicado/);
});
test('interface mantém prévia revisável e gráfico com dados do histórico',()=>{
 const view=read('views/avn/exames-laboratoriais.html');
 const js=read('public/js/avn-exames.js');
 for(const id of ['exForm','exGrafico','exImportModal','exLinhasPrevia','exConfirmar'])
  assert.ok(view.includes('id="'+id+'"'));
 assert.match(js,/renderPreview\(\)/);
 assert.match(js,/saveImported\(\)/);
 assert.match(js,/const excluded=all\.length-rows\.length/);
 assert.match(js,/r\.unidade===unit&&norm\(r\.metodo\)===method/);
 for(const src of ['src/routes/avn/avn-exames.routes.js','public/js/avn-exames.js'])
  assert.doesNotThrow(()=>new Function(read(src)));
});
