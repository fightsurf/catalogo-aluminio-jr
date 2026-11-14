'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Web e Android expõem último peso executado sem mudar a carga programada',async()=>{
 const code=file('src/services/avn/avn-treinos-ultimas-cargas.service.js');
 const mod={exports:{}};
 new Function('require','module','exports',code)(()=>({}),mod,mod.exports);
 const result=[
  {exercicio_id:'10',carga_kg:'42.50',carga_unidade:'kg',carga_placas:null,data_carga:'2026-11-14T12:00:00Z'},
  {exercicio_id:'20',carga_kg:null,carga_unidade:'placas',carga_placas:8,data_carga:'2026-11-14T13:00:00Z'}
 ];
 const mock={query:async(sql,params)=>{
  assert.match(sql,/avn_treino_sessao_itens/);
  assert.match(sql,/avn_treino_execucao_eventos/);
  assert.match(sql,/DISTINCT ON \(exercicio_id\)/);
  assert.deepEqual(params,[7]);
  return {rows:result};
 }};
 const dias=[{dia_semana:0,exercicios:[
  {exercicio_id:10,carga_kg:30,carga_unidade:'kg',carga_placas:null},
  {exercicio_id:20,carga_kg:null,carga_unidade:'placas',carga_placas:5},
  {exercicio_id:30,carga_kg:50,carga_unidade:'kg',carga_placas:null}
 ]}];
 const atual=await mod.exports.aplicarUltimasCargas(7,dias,mock);
 assert.equal(atual[0].exercicios[0].carga_kg,30);
 assert.equal(atual[0].exercicios[0].ultima_carga_kg,'42.50');
 assert.equal(atual[0].exercicios[1].carga_placas,5);
 assert.equal(atual[0].exercicios[1].ultima_carga_placas,8);
 assert.equal(atual[0].exercicios[2].ultima_carga_kg,undefined);
 const webRoutes=file('src/routes/avn/avn-treinos.routes.js');
 const mobileRoutes=file('src/routes/avn/avn-treino-mobile.routes.js');
 assert.match(webRoutes,/await aplicarUltimasCargas\(r\.rows\[0\]\.usuario_id,dias,client\)/);
 assert.match(mobileRoutes,/await aplicarUltimasCargas\(req\.avnm\.usuario_id,dias\)/);
});
test('formulários Web e execução retomada utilizam última carga sem perder séries',()=>{
 const source=file('public/js/avn-treinos.js');
 assert.doesNotThrow(()=>new Function(source));
 assert.match(source,/function cargaParaSessao\(item\)/);
 assert.match(source,/\(d\?\.exercicios\|\|\[\]\)\.map\(cargaParaSessao\)/);
 assert.match(source,/const i=cargaParaSessao\(original\)/);
 assert.match(source,/webExec\.itens\[p\]/);
 assert.match(source,/ev\.carga_placas/);
 assert.match(source,/INSERT INTO public\.avn_treino_sessao_itens\(/.test(file('src/routes/avn/avn-treinos.routes.js')) ? file('src/routes/avn/avn-treinos.routes.js') : '');
});
