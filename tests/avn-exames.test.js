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
test('ferro sérico é incluído com guarda por nome, código e aliases',()=>{
 const sql=read('db/sql/20261027_avn_exames_laboratoriais.sql');
 const ferro=sql.slice(sql.indexOf("SELECT 'ferro_serico','Ferro sérico'"),sql.indexOf('-- Faixas KDIGO'));
 assert.ok(ferro.startsWith("SELECT 'ferro_serico','Ferro sérico'"), 'Ferro sérico ausente');
 assert.match(ferro,/'Minerais','µg\/dL','indicador'/);
 assert.match(ferro,/WHERE NOT EXISTS \(/);
 assert.match(ferro,/c\.codigo='ferro_serico'/);
 assert.match(ferro,/lower\(c\.nome\)/);
 assert.match(ferro,/unnest\(c\.aliases\)/);
 assert.match(ferro,/ON CONFLICT\(codigo\) DO NOTHING/);
 assert.match(sql,/\('ferritina','Ferritina'/);
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

test('importação com IA aceita print colado e anexos JPEG, PNG e PDF com revisão obrigatória',()=>{
 const view=read('views/avn/exames-laboratoriais.html');
 const js=read('public/js/avn-exames.js');
 const api=read('src/routes/avn/avn-exames.routes.js');
 for(const id of ['exColarImagem','exAnexoPrevia','exMiniatura','exLimparAnexo'])
  assert.ok(view.includes('id="'+id+'"'));
 assert.match(view,/Ctrl\+V/);
 assert.match(view,/image\/jpeg,image\/png,application\/pdf/);
 assert.match(js,/addEventListener\('paste',colarAnexo\)/);
 assert.match(js,/clipboardData\?\.items/);
 assert.match(js,/URL\.revokeObjectURL/);
 assert.match(js,/fd\.append\('arquivo',arquivo/);
 assert.match(api,/upload\.single\('arquivo'\)/);
 assert.match(api,/type:'input_image'/);
 assert.match(api,/type:'input_file'/);
 assert.match(api,/arquivo\.mimetype!==tipoArquivo/);
 assert.match(api,/LIMIT_FILE_SIZE/);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(api));
});

test('TFG estimada tem categorias KDIGO e referência padrão automática',()=>{
 const sql=read('db/sql/20261027_avn_exames_laboratoriais.sql');
 const api=read('src/routes/avn/avn-exames.routes.js');
 const js=read('public/js/avn-exames.js');
 assert.match(sql,/\('tfg_estimada','TFG estimada \(eTFG\)'/);
 assert.match(sql,/mL\/min\/1,73 m²/);
 for(const t of ['G1 ≥90','G2 60–89','G3a 45–59','G3b 30–44','G4 15–29','G5 <15'])assert.ok(sql.includes(t));
 assert.match(sql,/AND NOT EXISTS \(/);
 assert.match(api,/referencia_catalogo:padrao\.rows\[0\]/);
 assert.match(js,/r\.referencia_catalogo/);
 assert.match(js,/≥ /);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(api));
});


test('catálogo inclui fósforo e cálcio total sem confundir com cálcio ionizado',()=>{
 const sql=read('db/sql/20261027_avn_exames_laboratoriais.sql');
 const linhas=sql.split(String.fromCharCode(10));
 for(const [codigo,nome] of [['fosforo','Fósforo'],['calcio_total','Cálcio total']]){
  const linha=linhas.find(l=>l.startsWith("('"+codigo+"','"+nome+"'"));
  assert.ok(linha, 'Exame ausente: '+nome);
  assert.ok(linha.includes("'Minerais','mg/dL','indicador'"), 'Unidade ou grupo inválido: '+nome);
 }
 const calcio=linhas.find(l=>l.startsWith("('calcio_total'"));
 assert.ok(!calcio.includes('ionizado'),'Não associar cálcio ionizado ao total');
});
