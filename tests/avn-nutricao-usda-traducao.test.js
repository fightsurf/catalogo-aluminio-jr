'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const translator=require('../src/services/avn/avn-nutricao-traducao.service');
const usda=require('../src/services/avn/avn-nutricao-usda.service');
const prevKey=process.env.OPENAI_API_KEY,prevUsda=process.env.USDA_API_KEY;

test.after(()=>{if(prevKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=prevKey;
 if(prevUsda===undefined)delete process.env.USDA_API_KEY;else process.env.USDA_API_KEY=prevUsda;});

test('tradução local de nomes comuns sem chave; não inventa tradução de termos desconhecidos',async()=>{
 delete process.env.OPENAI_API_KEY;
 const words=await translator.traduzirTitulos(['Rice, white, cooked','Unknown food, 123']);
 assert.deepEqual(words,['Arroz branco cozido','Unknown food, 123']);
});

test('listagem e detalhamento USDA apresentam título em português e preservam original e nutrientes',async(t)=>{
 process.env.OPENAI_API_KEY='fake-test-key';process.env.USDA_API_KEY='fake-test-usda';
 const saved=global.fetch;
 t.after(()=>{global.fetch=saved;});
 const calls=[];
 global.fetch=async(url,options)=>{
  url=String(url);calls.push(url);
  if(url.includes('api.openai.com')){
   const payload=JSON.parse(options.body);
   assert.ok(payload.messages[0].content.includes('Não invente informações'));
   const titles=JSON.parse(payload.messages[1].content).titles;
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({translations:titles.map(x=>({i:x.i,pt:'Arroz branco cozido, sem sal'}))})}}]})};
  }
  if(url.includes('/foods/search?'))return {ok:true,json:async()=>({foods:[{fdcId:12345,description:'Rice, white, cooked, without salt',dataType:'Foundation',brandOwner:''}]})};
  if(url.includes('/food/12345'))return {ok:true,json:async()=>({description:'Rice, white, cooked, without salt',dataType:'Foundation',foodNutrients:[{nutrient:{id:1003,unitName:'g'},amount:2.7},{nutrient:{id:1089,unitName:'mg'},amount:0.2}]})};
  throw Error('URL inesperada: '+url);
 };
 const results=await usda.search('arroz branco cozido sem sal');
 assert.equal(results.opcoes[0].descricao,'Arroz branco cozido, sem sal');
 assert.equal(results.opcoes[0].descricaoOriginal,'Rice, white, cooked, without salt');
 const out=await usda.detail('12345',[{codigo:'ferro_mg',unidade:'mg'}]);
 assert.equal(out.descricao,'Arroz branco cozido, sem sal');
 assert.equal(out.descricaoOriginal,'Rice, white, cooked, without salt');
 assert.equal(out.macros.proteinas_g,2.7);
 assert.equal(out.micros.ferro_mg,0.2);
 assert.equal(calls.filter(x=>x.includes('api.openai.com')).length,2); // pesquisa reformulada + tradução em lote; detalhe usa cache
});

test('títulos em português são mostrados no modal e a descrição original é identificada separadamente',()=>{
 const html=fs.readFileSync(path.join(root,'public/js/avn-nutricao-comparador.js'),'utf8');
 assert.match(html,/USDA \(original\)/);
 assert.match(html,/esc\(item\.descricao\)/);
 assert.match(html,/esc\(d\.descricaoOriginal\)/);
 new vm.Script(html);
});
