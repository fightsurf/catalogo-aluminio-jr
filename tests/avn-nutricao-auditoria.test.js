'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {auditar}=require('../src/services/avn/avn-nutricao-auditoria.service');
test('ovo cru coerente, alerta de origem sem URL e nome duplicado',()=>{
 const v=auditar({nome:'Ovo, cru, cru',macros:{kcal:143,proteinas_g:12.6,carboidratos_g:.7,gorduras_g:9.5,fibras_g:0},micros:{agua_g:75.8,colesterol_mg:372},fontes:[]},{alegaFonte:true});
 assert.ok(v.some(x=>x.codigo==='sem_fontes'));assert.ok(v.some(x=>x.codigo==='fonte_nao_verificada'));assert.ok(v.some(x=>x.codigo==='nome_duplicado'));assert.ok(!v.some(x=>x.codigo==='energia_macros'));
});
test('sinaliza kcal incompatíveis e erros físicos',()=>{
 const v=auditar({nome:'Teste',macros:{kcal:50,proteinas_g:30,carboidratos_g:20,gorduras_g:15,fibras_g:10},micros:{agua_g:80},fontes:[]});
 assert.ok(v.some(x=>x.codigo==='energia_macros'));assert.ok(v.some(x=>x.codigo==='balanco_massa'));
});
test('mantém desconhecido separado de zero',()=>{
 const v=auditar({nome:'Teste',macros:{kcal:null,proteinas_g:null,carboidratos_g:0,gorduras_g:null,fibras_g:0},micros:{colesterol_mg:null},fontes:[{url:'https://example.org'}]});assert.deepEqual(v,[]);
});
