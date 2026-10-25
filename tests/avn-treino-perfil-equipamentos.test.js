'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const Module=require('node:module');
const original=Module._load;Module._load=function(request,...args){if(request==='../../../db/connection')return {};return original.call(this,request,...args);};
const S=require('../src/services/avn/avn-treinos-equipamentos.service');Module._load=original;
const ex=(nome,equipamento,slug='teste')=>({nome,equipamento,slug});
test('Máquinas de panturrilha são distintas',()=>{
 assert.deepEqual(S.inferir(ex('Panturrilha em pé na máquina','Máquina','panturrilha-em-pe-na-maquina')).slugs,['panturrilha-em-pe']);
 assert.deepEqual(S.inferir(ex('Panturrilha sentado','Máquina','panturrilha-sentado')).slugs,['panturrilha-sentado']);
});
test('não libera máquina genérica sem identificação',()=>{
 assert.equal(S.inferir(ex('Elevação flexão muscular','Máquina')).modo,'pendente');
});
test('rolinho e estação paralela são separados',()=>{
 assert.deepEqual(S.inferir(ex('Abdominal no rolinho','Peso corporal','abdominal-no-rolinho')).slugs,['ab-wheel']);
 assert.deepEqual(S.inferir(ex('Elevação de joelhos na paralela','Peso corporal','elevacao-de-joelhos-na-paralela')).slugs,['estacao-paralelas']);
});
test('exercício livre não exige aparelho; supino com halteres exige banco',()=>{
 assert.equal(S.inferir(ex('Prancha abdominal','Peso corporal','prancha-abdominal')).modo,'livre');
 assert.deepEqual(S.inferir(ex('Supino reto com halteres','Halteres','supino-reto-com-halteres')).slugs,['halteres','banco-regulavel']);
});
test('classificações manuais prevalecem sobre inferência',()=>{
 let x=S.resolver({id:33,...ex('Remada máquina','Máquina')},new Map([['33',{modo:'livre',ids:[]}]]),new Map());
 assert.equal(x.modo,'livre');assert.equal(x.origem,'manual');
});
test('migração contém tabelas, integridade e cadastro inicial',()=>{
 const f=fs.readFileSync(path.join(__dirname,'../db/sql/20261025_avn_treino_perfil_equipamentos.sql'),'utf8');
 for(const table of ['avn_treino_perfil','avn_equipamentos','avn_usuario_equipamentos','avn_exercicio_requisitos','avn_exercicio_equipamentos'])assert.match(f,new RegExp('CREATE TABLE IF NOT EXISTS public\\.'+table));
 assert.doesNotMatch(f,/^\s*DROP\s+/mi);assert.match(f,/ON CONFLICT\(slug\) DO NOTHING/);
});
test('IA recebe perfil e lista filtrada, com validação de IDs na resposta',()=>{
 const f=fs.readFileSync(path.join(__dirname,'../src/routes/avn/avn-treinos.routes.js'),'utf8');
 assert.match(f,/exercicios\.filter\(e=>e\.compativel\)/);assert.match(f,/perfil_treinamento:perfil/);assert.match(f,/ids\.has\(e\.exercicio_id\)/);assert.match(f,/nivel==='nao_informado'/);
});

test('filtro respeita inventário e exclui pendentes',async()=>{
 const exs=[
  {id:1,nome:'Panturrilha em pé na máquina',slug:'panturrilha-em-pe-na-maquina',equipamento:'Máquina',grupo:'Panturrilhas'},
  {id:2,nome:'Panturrilha sentado',slug:'panturrilha-sentado',equipamento:'Máquina',grupo:'Panturrilhas'},
  {id:3,nome:'Máquina de nome desconhecido',slug:'maquina-x',equipamento:'Máquina',grupo:'Pernas'},
  {id:4,nome:'Prancha abdominal',slug:'plank',equipamento:'Peso corporal',grupo:'Abdômen'}
 ];
 const equipments=[{id:10,slug:'panturrilha-em-pe',nome:'Panturrilha em pé',categoria:'Pernas'},{id:11,slug:'panturrilha-sentado',nome:'Panturrilha sentado',categoria:'Pernas'}];
 let index=0;const responses=[[...exs],equipments,[{equipamento_id:10}],[],[]];
 const client={query:async()=>({rows:responses[index++]})};
 const data=await S.dadosCompatibilidade(1,client);
 assert.deepEqual(data.exercicios.map(e=>e.compativel),[true,false,false,true]);
 assert.equal(data.exercicios[2].modo,'pendente');
});
