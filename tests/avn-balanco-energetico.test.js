'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {avaliarBalanco,valor}=require('../src/services/avn/avn-balanco-energetico.service');
test('déficit usa só TMB + calorias ativas, sem somar passos',()=>{
 const r=avaliarBalanco({ingestao:1900,tmb:1700,ativas:500,passos:10000});
 assert.equal(r.classificacao,'deficit');assert.equal(r.gasto_estimado_kcal,2200);assert.equal(r.saldo_kcal,-300);
});
test('superávit e equilíbrio',()=>{
 assert.equal(avaliarBalanco({ingestao:2400,tmb:1700,ativas:200}).classificacao,'superavit');
 assert.equal(avaliarBalanco({ingestao:1900,tmb:1700,ativas:200}).classificacao,'equilibrio');
});
test('não presume zero para diário sem registros ou calorias ativas ausentes',()=>{
 assert.equal(avaliarBalanco({ingestao:null,tmb:1700,ativas:200}).classificacao,'indisponivel');
 assert.equal(avaliarBalanco({ingestao:1900,tmb:1700,ativas:null}).classificacao,'indisponivel');
 assert.equal(avaliarBalanco({ingestao:1800,tmb:1700,ativas:100,diarioCompleto:false}).classificacao,'indisponivel');
});
test('valor zero registrado é válido; texto vazio não é zero',()=>{
 assert.equal(valor(0),0);assert.equal(valor(''),null);
 assert.equal(avaliarBalanco({ingestao:1800,tmb:1700,ativas:0}).classificacao,'superavit');
});
