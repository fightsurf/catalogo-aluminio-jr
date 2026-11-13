'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Sono aparece no catálogo do AVN e usa rota autenticada',()=>{
 const routes=read('src/routes/avn/avn-sistema.routes.js');
 assert.match(routes,/rota:'\/avn\/sistema\/sono',nome:'Sono',categoria:'Saúde'/);
 assert.match(routes,/router\.get\('\/sono',\s*requireAuth/);
 assert.match(routes,/views\/avn\/sono\.html/);
});
test('A página de sono mantém filtros, resumo, gráficos e última noite',()=>{
 const html=read('views/avn/sono.html');
 for(const id of ['usuario','dias','status','latest-content','noites','duracao','pontuacao','profundo','rem','chart-duration','chart-score','history','reload'])
  assert.ok(html.includes('id="'+id+'"'),'ID ausente: '+id);
 assert.match(html,/public|\/js\/avn-sono\.js/);
 assert.match(html,/Enviar sono ao AVN/i);
});
test('O JavaScript compila e consome API autenticada de sono, sem dados simulados',()=>{
 const js=read('public/js/avn-sono.js');
 assert.doesNotThrow(()=>new vm.Script(js));
 assert.match(js,/\/api\/avn\/health\/usuarios\//);
 assert.match(js,/\/sono\?dias=/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/signal/);
 assert.match(js,/replaceChildren/);
 assert.match(js,/score/);
 assert.match(js,/segments/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});
test('O backend consulta sono e estágios reais do banco',()=>{
 const route=read('src/routes/avn/avn-health.routes.js');
 assert.match(route,/router\.get\('\/usuarios\/:usuarioId\/sono'/);
 assert.match(route,/public\.avn_sono_sessoes/);
 assert.match(route,/public\.avn_sono_estagios/);
 const migration=read('src/services/avn/avn-migration.service.js');
 assert.match(migration,/20261111_avn_sono_samsung\.sql/);
});
