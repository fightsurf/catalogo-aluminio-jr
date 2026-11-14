'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

const migration=read('db/sql/20261114_avn_hemograma_completo.sql');
const manifest=read('src/services/avn/avn-migration.service.js');
const api=read('src/routes/avn/avn-exames.routes.js');
const web=read('public/js/avn-exames.js');
const html=read('views/avn/exames-laboratoriais.html');

test('hemograma inclui campos numericos, absolutos e morfologias sem alterar historico',()=>{
 assert.match(manifest,/20261114_avn_hemograma_completo\.sql/);
 for(const codigo of [
  'bastonetes','bastonetes_absoluto','eosinofilos_absoluto','basofilos_absoluto',
  'monocitos_absoluto','linfocitos_reativos','linfocitos_reativos_absoluto',
  'morfologia_serie_vermelha','morfologia_serie_branca','morfologia_serie_plaquetaria'
 ])assert.ok(migration.includes("('"+codigo+"'"),codigo);
 assert.match(migration,/ON CONFLICT \(codigo\) DO NOTHING/);
 assert.doesNotMatch(migration,/^\s*(?:DROP|DELETE|TRUNCATE)\b/mi);
 assert.doesNotMatch(migration,/INSERT\s+INTO public\.avn_exames_resultados/i);
 assert.match(migration,/unnest\(c\.aliases \|\| novos\.aliases_novos\)/);
});

test('importacao IA extrai resultados anteriores por data, observacoes e zeros sem inferir ausentes',()=>{
 for(const t of ['historico=true','historico:x.historico===true','NUNCA substitua','nunca calcule valores ausentes','nunca descarte resultados iguais a zero','morfologia','c.codigo'])
  assert.ok(api.includes(t),t);
 assert.match(api,/\(x\.valor==null\|\|x\.valor===''\)/);
 assert.match(api,/match\(cat,nome,x\.codigo\)/);
 assert.match(web,/RESULTADO ANTERIOR/);
 assert.match(web,/Resultado anterior identificado no laudo importado/);
 assert.match(web,/String\(r\.valor\?\?''\)\.trim\(\)!==''/);
 assert.match(web,/conferirPrevia\(\)/);
 assert.match(html,/NÃO sobrescreverá/);
 for(const src of [api,web])assert.doesNotThrow(()=>new Function(src));
});

test('a comparacao de coletas distingue novo, identico e divergente inclusive zero',async()=>{
 const start=api.indexOf('const unidadeComparavel=');
 const end=api.indexOf("router.post('/resultados/conferir'",start);
 assert.ok(start>0&&end>start);
 const comparar=new Function(api.slice(start,end)+';return {conferirColeta,valoresIguais};')();
 const item={exame_id:42,data_coleta:'2026-08-31',valor:0,valor_texto:null,unidade:'/mm³'};
 const semRegistro={query:async()=>({rows:[]})};
 assert.equal((await comparar.conferirColeta(semRegistro,1,item)).situacao,'novo');
 const existente={id:7,valor:'0',valor_texto:null,unidade:'/µL'};
 const igual={query:async()=>({rows:[existente]})};
 assert.equal((await comparar.conferirColeta(igual,1,item)).situacao,'identico');
 const diferente={query:async()=>({rows:[{...existente,valor:'123'}]})};
 const conflito=await comparar.conferirColeta(diferente,1,item);
 assert.equal(conflito.situacao,'divergente');
 assert.equal(conflito.existente.valor,'123');
 assert.equal(comparar.valoresIguais({valor:13.4,unidade:'g/dL'},{valor:13.4,unidade:'g/L'}),false);
 assert.equal(comparar.valoresIguais({valor:null,valor_texto:'NORMAL',unidade:'texto'},{valor:null,valor_texto:'normal',unidade:'texto'}),true);
});

test('importacao salva novos mas nao substitui coletas divergentes',()=>{
 assert.match(api,/router\.post\('\/resultados\/conferir'/);
 assert.match(api,/router\.post\('\/resultados\/lote'/);
 const batch=api.slice(api.indexOf("router.post('/resultados/lote'"),api.indexOf("router.put('/resultados/:id'"));
 assert.match(batch,/checagem\.situacao==='divergente'/);
 assert.match(batch,/divergencias\.push/);
 assert.match(batch,/continue;/);
 assert.match(batch,/checagem\.situacao==='identico'/);
 assert.match(batch,/insertOne\(db,uid,item,lote\)/);
 assert.doesNotMatch(batch,/UPDATE\s+public\.avn_exames_resultados/i);
 assert.match(web,/if\(conferencia\.divergentes>0&&!?confirm/);
 assert.match(web,/atualizarAviso\(item\.el/);
});
