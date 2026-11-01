'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/services/marketing/agendadorModulos.service.js'),'utf8');
const m={exports:{}};
vm.runInNewContext(src,{module:m,require:p=>({}),console,process:{env:{}},Date,Intl,setInterval,setTimeout});
const a=m.exports;
test('duração ISO dos vídeos',()=>{
 assert.equal(a.duration('PT1M28S'),88);
 assert.equal(a.duration('PT11M'),660);
 assert.equal(a.duration('PT2S'),2);
 assert.equal(a.duration('PT12M'),720);
});
test('janela horária em Fortaleza',()=>{
 const c={inicio:'06:00',fim:'22:00'};
 assert.equal(a.nextWindow(c,new Date('2026-11-01T08:01:00Z')).toISOString(),'2026-11-01T09:00:00.000Z');
 assert.equal(a.nextWindow(c,new Date('2026-11-02T02:00:00Z')).toISOString(),'2026-11-02T09:00:00.000Z');
});
