'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {avaliarBalanco,valor,estimarCaloriasPassos}=require('../src/services/avn/avn-balanco-energetico.service');
test('déficit considera TMB, calorias de treino e a estimativa adicional de caminhada',()=>{
 const r=avaliarBalanco({ingestao:1900,tmb:1700,ativas:161,caloriasPassos:320});
 assert.equal(r.classificacao,'deficit');assert.equal(r.gasto_estimado_kcal,2181);assert.equal(r.saldo_kcal,-281);
});
test('contagem bruta de passos não é somada diretamente ao gasto',()=>{
 const r=avaliarBalanco({ingestao:1900,tmb:1700,ativas:500,passos:10000});
 assert.equal(r.gasto_estimado_kcal,2200);assert.equal(r.saldo_kcal,-300);
});
test('superávit e equilíbrio',()=>{
 assert.equal(avaliarBalanco({ingestao:2400,tmb:1700,ativas:200,caloriasPassos:100}).classificacao,'superavit');
 assert.equal(avaliarBalanco({ingestao:1900,tmb:1700,ativas:100,caloriasPassos:100}).classificacao,'equilibrio');
});
test('diário sem registros continua indisponível; ausência de calorias ativas vale zero',()=>{
 assert.equal(avaliarBalanco({ingestao:null,tmb:1700,ativas:200}).classificacao,'indisponivel');
 const semAtivas=avaliarBalanco({ingestao:1900,tmb:1700,ativas:null});
 assert.equal(semAtivas.classificacao,'superavit');
 assert.equal(semAtivas.gasto_estimado_kcal,1700);
 assert.equal(semAtivas.saldo_kcal,200);
 assert.equal(avaliarBalanco({ingestao:1900,tmb:1700}).saldo_kcal,200);
 assert.equal(avaliarBalanco({ingestao:1900,tmb:1700,ativas:''}).saldo_kcal,200);
 assert.equal(avaliarBalanco({ingestao:1800,tmb:1700,ativas:100,diarioCompleto:false}).classificacao,'indisponivel');
});
test('valor zero é válido e gasto estimado não usa TMB duas vezes',()=>{
 assert.equal(valor(0),0);assert.equal(valor(''),null);
 assert.equal(estimarCaloriasPassos({passos:0,pesoKg:85,alturaCm:175}),0);
 assert.equal(avaliarBalanco({ingestao:1800,tmb:1700,ativas:0,caloriasPassos:0}).classificacao,'superavit');
});
test('estimativa de passos usa massa e altura e exige dados válidos',()=>{
 assert.equal(estimarCaloriasPassos({passos:10000,pesoKg:85,alturaCm:175}),308.7);
 assert.equal(estimarCaloriasPassos({passos:200,pesoKg:85,alturaCm:175}),6.2);
 assert.equal(estimarCaloriasPassos({passos:10000,pesoKg:null,alturaCm:175}),null);
 assert.equal(estimarCaloriasPassos({passos:10000,pesoKg:85,alturaCm:0}),null);
 assert.equal(avaliarBalanco({ingestao:1800,tmb:1700,ativas:0,caloriasPassos:null}).classificacao,'indisponivel');
});
