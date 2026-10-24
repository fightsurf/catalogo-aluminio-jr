'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const SRC=path.join(__dirname,'../src/services/avn/avn-treinos-catalogo.service.js');
function manifest(ext){
 const slugs=['bench-press',...Array.from({length:301},(_,i)=>`teste-${i+1}`)];
 return slugs.map(slug=>({slug,name:'Exercício',primaryMuscle:'Chest',equipment:'Barbell',frames:[1,2,3].map(n=>({path:`assets/${slug}/frame-${n}.${ext}`,format:ext}))}));
}
function service(format){
 const items=manifest(format),queries=[],groups=['peito','costas','ombros','biceps','triceps','quadriceps','posteriores','gluteos','panturrilhas','abdomen','lombar','cardio','antebracos','adutores','mobilidade'].map((slug,i)=>({id:i+1,slug}));
 const client={query:async(sql,values=[])=>{queries.push({sql,values});return {rows:sql.startsWith('SELECT id,slug')?groups:[],rowCount:1};},release:()=>{}};
 const fakeFs={readFileSync:()=>JSON.stringify(items)};
 const pool={connect:async()=>client};
 const fauxRequire=id=>{
  if(id==='node:fs')return fakeFs;
  if(id==='../../../db/connection')return pool;
  if(id==='./avn-treinos-ptbr')return {};
  throw Error('Dependência inesperada: '+id);
 };
 fauxRequire.resolve=()=>'/fake/node_modules/@bryllim/workout-guide/manifest.json';
 const context={require:fauxRequire,module:{exports:{}},console:{log:()=>{}},Buffer};
 vm.runInNewContext(fs.readFileSync(SRC,'utf8'),context,{filename:SRC});
 return {catalogo:context.module.exports,queries,items};
}
for(const ext of ['png','svg']){
 test('manifesto '+ext+': 302 exercícios e mídias locais',async()=>{
  const {catalogo,queries,items}=service(ext);
  assert.equal(catalogo.validManifest(items).length,302);
  assert.equal(catalogo.normalizeExercise(items[0]).image,'/avn/sistema/midias/bench-press/frame-1.'+ext);
  assert.equal(catalogo.normalizarMidia('https://cdn.jsdelivr.net/gh/bryllim/workout-guide@main/packages/workout-guide/assets/bench-press/frame-1.svg'),'/avn/sistema/midias/bench-press/frame-1.'+ext);
  assert.equal(catalogo.normalizarMidia('/avn/sistema/midias/bench-press/frame-2.svg'),'/avn/sistema/midias/bench-press/frame-2.'+ext);
  assert.equal(catalogo.normalizarMidia('https://site-usuario.example/minha-imagem.png'),'https://site-usuario.example/minha-imagem.png');
  const result=await catalogo.importarCatalogo();
  assert.equal(result.total,302);
  assert.equal(queries.filter(q=>q.sql.includes('INSERT INTO public.avn_exercicios')).length,7);
  assert.equal(queries.some(q=>q.sql==='COMMIT'),true);
  const urls=queries.flatMap(q=>q.values).filter(x=>typeof x==='string'&&x.startsWith('/avn/sistema/midias/'));
  assert.equal(urls.length,302);
  assert.ok(urls.every(u=>u.endsWith('.'+ext)));
 });
}
test('manifesto inválido indica qual registro falhou',()=>{
 const {catalogo,items}=service('png');items[6].frames[2].path='assets/outro/frame-3.png';
 assert.throws(()=>catalogo.validManifest(items),/exercício 7/);
});
test('validação de URL aceita PNG e SVG sem aceitar caminhos arbitrários',()=>{
 const validator=require('../src/services/avn/avn-treinos-validacao');
 assert.equal(validator.midiaUrl('/avn/sistema/midias/bench-press/frame-1.png'),'/avn/sistema/midias/bench-press/frame-1.png');
 assert.equal(validator.midiaUrl('/avn/sistema/midias/bench-press/frame-1.svg'),'/avn/sistema/midias/bench-press/frame-1.svg');
 assert.throws(()=>validator.midiaUrl('/etc/passwd'),/URL da mídia inválida/);
});
