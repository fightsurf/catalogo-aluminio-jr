'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {metaPorKg,energiaMacros,razoesDaMeta}=require('../src/services/avn/avn-metas-gkg');
test('calculadora aceita taxas decimais independentes',()=>{
 assert.deepEqual(metaPorKg(85,{proteinas_g:2,carboidratos_g:3,gorduras_g:1.1}),
  {proteinas_g:170,carboidratos_g:255,gorduras_g:93.5,energia_macros_kcal:2541.5});
 assert.equal(metaPorKg(85,{proteinas_g:2.3,carboidratos_g:3,gorduras_g:1}).proteinas_g,195.5);
});
test('histórico guarda as razões reais sem inventar peso',()=>{
 assert.deepEqual(razoesDaMeta(85,{proteinas_g:170,carboidratos_g:255,gorduras_g:93.5}),{
  proteinas_g_kg:2,carboidratos_g_kg:3,gorduras_g_kg:1.1
 });
 assert.equal(razoesDaMeta(null,{proteinas_g:170}).proteinas_g_kg,null);
});
test('energia só é calculada quando os três macros estão definidos',()=>{
 assert.equal(energiaMacros({proteinas_g:170,carboidratos_g:255,gorduras_g:93.5}),2541.5);
 assert.equal(energiaMacros({proteinas_g:170,carboidratos_g:255,gorduras_g:null}),null);
});
test('rejeita valores impossíveis e não negativos',()=>{
 assert.throws(()=>metaPorKg(0,{proteinas_g:2,carboidratos_g:3,gorduras_g:1}),RangeError);
 assert.throws(()=>metaPorKg(85,{proteinas_g:-2,carboidratos_g:3,gorduras_g:1}),RangeError);
 assert.throws(()=>metaPorKg(85,{proteinas_g:2,carboidratos_g:11,gorduras_g:1}),RangeError);
});
