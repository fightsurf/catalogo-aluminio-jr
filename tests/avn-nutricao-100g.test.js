'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const svc=require('../src/services/avn/avn-nutricao-ia-json.service');
const food={nome:'Ovo inteiro cru',preparo:'cru'};
const cat=[{codigo:'ferro',nome:'Ferro',unidade:'mg',categoria:'minerais'}];
const result=(base,peso,kcal,ferro)=>({base_valores:base,peso_porcao_comestivel_g:peso,macros:{kcal,proteinas_g:6,carboidratos_g:0.4,gorduras_g:5,fibras_g:0},micros:{ferro},fontes:[],observacoes:''});
test('porção de ovo de 50g é convertida para 100g',()=>{
 const r=svc.normalize(result('porcao',50,72,0.8),food,cat,[]);
 assert.equal(r.macros.kcal,144);assert.equal(r.macros.proteinas_g,12);
 assert.equal(r.micros.ferro,1.6);assert.equal(r.macros.fibras_g,0);
 assert.match(r.observacoes,/convertidos matematicamente/);
});
test('dados já por 100g não são duplicados',()=>{
 const r=svc.normalize(result('100g',null,144,1.6),food,cat,[]);
 assert.equal(r.macros.kcal,144);assert.equal(r.micros.ferro,1.6);
});
test('valores por porção sem peso comestível são recusados',()=>{
 assert.throws(()=>svc.normalize(result('porcao',null,72,0.8),food,cat,[]),/peso comestível válido/);
});
test('todos os nutrientes do catálogo são obrigatórios',()=>{
 assert.throws(()=>svc.normalize({...result('100g',null,144,1.6),micros:{}},food,cat,[]),/todos os campos/);
});
