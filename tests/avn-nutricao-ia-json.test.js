'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const service=require('../src/services/avn/avn-nutricao-ia-json.service');
const catalog=[{codigo:'vitamina_c_mg',nome:'Vitamina C',unidade:'mg',categoria:'Vitaminas'},
 {codigo:'iodo_ug',nome:'Iodo',unidade:'µg',categoria:'Minerais'},
 {codigo:'omega3_g',nome:'Ômega-3',unidade:'g',categoria:'Outros'}];
const evidence=[{titulo:'Publicação pública',url:'https://example.org/alimento'}];
const structured={nome:'Exemplo',preparo:'cozido',marca:null,referencia_100g:'100 g da parte comestível',
 macros:{kcal:115,proteinas_g:2.5,carboidratos_g:24,gorduras_g:0.3,fibras_g:null},
 micros:{vitamina_c_mg:0,iodo_ug:null,omega3_g:null},fontes:evidence,observacoes:'A fonte contém valores parciais.'};
test('esquema dinâmico inclui todo o catálogo por categoria e cinco macros',()=>{
 const sc=service.schema(catalog);
 assert.deepEqual(sc.properties.micros.required,catalog.map(n=>n.codigo));
 assert.equal(sc.properties.macros.required.length,5);
 assert.deepEqual(sc.properties.micros.properties.iodo_ug.type,['number','null']);
 assert.equal(sc.additionalProperties,false);
});
test('não transforma desconhecido em zero nem altera micronutrientes do catálogo',()=>{
 const d=service.normalize(structured,{nome:'Arroz cozido',preparo:'cozido',marca:''},catalog,evidence);
 assert.equal(d.micros.iodo_ug,null);assert.equal(d.micros.vitamina_c_mg,0);
 assert.equal(d.macros.fibras_g,null);assert.equal(d.nome,'Arroz cozido');
 assert.deepEqual(Object.keys(d.micros),catalog.map(n=>n.codigo));
});
test('rejeita dados numéricos sem fonte citável e resultado incompleto',()=>{
 assert.throws(()=>service.normalize(structured,{nome:'Exemplo'},catalog,[]),/fonte/);
 assert.throws(()=>service.normalize({...structured,micros:{iodo_ug:2}},{nome:'Exemplo'},catalog,evidence),/todos os campos/);
 assert.throws(()=>service.normalize({...structured,macros:{...structured.macros,kcal:1200}},{nome:'Exemplo'},catalog,evidence),/inconsistente/);
});
test('busca fontes devolvidas pelo próprio motor de pesquisa, sem URLs HTTP',()=>{
 const d={output:[{type:'web_search_call',action:{sources:[{title:'Publicação pública',url:'https://example.org/alimento'},{titulo:'Inseguro',url:'http://example.org/data'}]}}]};
 assert.deepEqual(service.searchSources(d),evidence);
});
test('não envia dados pessoais na validação da consulta',()=>{
 const food=service.validateInput({nome:'Arroz branco',preparo:'cozido',marca:'Marca',usuarioId:123,sexo:'masculino'},catalog);
 assert.deepEqual(food,{nome:'Arroz branco',preparo:'cozido',marca:'Marca'});
});
test('fluxo IA com simulação das duas chamadas externas',async()=>{
 const orig=global.fetch;const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='teste-local-nao-real';
 let chamadas=0;
 try{
  global.fetch=async(_url,options)=>{
   chamadas++;
   const req=JSON.parse(options.body);
   const content=chamadas===1?{output:[{type:'web_search_call',action:{sources:evidence}},{type:'message',content:[{type:'output_text',text:'Fonte: https://example.org/alimento. Valores pesquisados por 100 g.'}]}]}:{output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(structured)}]}]};
   if(chamadas===1)assert.equal(req.tools[0].type,'web_search');
   if(chamadas===2)assert.equal(req.text.format.strict,true);
   return {ok:true,json:async()=>content};
  };
  const r=await service.gerar({nome:'Exemplo',preparo:'cozido'},catalog);
  assert.equal(chamadas,2);assert.equal(r.macros.kcal,115);assert.equal(r.micros.iodo_ug,null);
 }finally{global.fetch=orig;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
});
