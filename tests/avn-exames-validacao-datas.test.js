'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'src/routes/avn/avn-exames.routes.js'),'utf8');
const frontend=fs.readFileSync(path.join(root,'public/js/avn-exames.js'),'utf8');

function obterBackend(){
 const trecho=backend.slice(backend.indexOf('function hojeColeta()'),backend.indexOf('const clean='));
 assert.ok(trecho.includes('function day('));
 return new Function('bad',trecho+';return {day,hojeColeta,avisoDataIA};')(
  mensagem=>Object.assign(new Error(mensagem),{status:400})
 );
}
function deslocarDia(data,dias){
 const d=new Date(data+'T12:00:00Z');
 d.setUTCDate(d.getUTCDate()+dias);
 return d.toISOString().slice(0,10);
}

test('coleta aceita datas válidas até hoje e bloqueia amanhã e 2031',()=>{
 const {day,hojeColeta}=obterBackend();
 const hoje=hojeColeta();
 assert.equal(day(hoje),hoje);
 assert.equal(day(deslocarDia(hoje,-1)),deslocarDia(hoje,-1));
 assert.equal(day('2026-08-31'),'2026-08-31');
 for(const data of [deslocarDia(hoje,1),'2031-08-31']){
  assert.throws(()=>day(data),/Data de coleta futura/);
 }
 for(const data of ['2026-02-30','2026-13-01','31/08/2026','']){
  assert.throws(()=>day(data),/Data de coleta inválida/);
 }
});

test('IA sinaliza datas não identificadas, futuras e muito antigas sem adivinhar ano',()=>{
 const {avisoDataIA}=obterBackend();
 assert.match(avisoDataIA(null),/não identificada/);
 assert.match(avisoDataIA('2031-08-31'),/futura/);
 assert.match(avisoDataIA('2010-02-17'),/dez anos/);
 assert.equal(avisoDataIA('2026-08-31'),null);
 assert.match(backend,/data_coleta:dataColeta,aviso_data/);
 assert.match(backend,/precisa_revisao:!c\|\|Boolean\(aviso_data\)/);
});

test('todas as rotas de escrita e de conferência usam validação no payload',()=>{
 assert.match(backend,/exame_id:id\(v.exame_id\),data_coleta:day\(v.data_coleta\)/);
 assert.match(backend,/router.post\('\/resultados\/conferir'[\s\S]*?items.map\(payload\)/);
 assert.match(backend,/router.post\('\/resultados\/lote'[\s\S]*?items.map\(payload\)/);
 assert.match(backend,/router.post\('\/resultados'[\s\S]*?payload\(req.body\)/);
 assert.match(backend,/router.put\('\/resultados\/:id'[\s\S]*?payload\(req.body\)/);
});

test('prévia identifica datas futuras, preserva histórico e exige confirmação de antigas',()=>{
 assert.match(frontend,/function erroDataColeta\(data\)/);
 assert.match(frontend,/data>localDate\(\)/);
 assert.match(frontend,/const validoImportacao=r=>Boolean\(r.exame_id&&!erroDataColeta\(r.data_coleta\)/);
 assert.match(frontend,/data-data-aviso/);
 assert.match(frontend,/const dataInvalida=rows.find\(x=>erroDataColeta/);
 assert.match(frontend,/const antigas=rows.filter\(x=>dataMuitoAntiga/);
 assert.match(frontend,/confirm\('Atenção: '/);
 assert.doesNotThrow(()=>new Function(frontend));
});
