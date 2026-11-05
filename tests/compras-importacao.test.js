'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validator = require('../src/services/compras/comprasValidator');

function criarServicoFalso() {
  const estado = {
    nota: {id:42,fornecedor_id:2,numero_nf:'0007',valor_nf:null,data_nf:null,
      quantidade_itens_nf:null,valor_frete:null,icms_frete:null,origem:'manual'},
    itens:[],
  };
  const cliente = {
    release() {},
    async query(q, p=[]) {
      const s=q.trim();
      if (['BEGIN','COMMIT','ROLLBACK'].includes(s)) return {rows:[],rowCount:0};
      if (s.startsWith('SELECT * FROM public.compras_notas')) return {rows:[estado.nota],rowCount:1};
      if (s.startsWith('UPDATE public.compras_notas')) {
        for(let i=0;i<5;i++) {
          const campo=['data_nf','valor_nf','quantidade_itens_nf','valor_frete','icms_frete'][i];
          estado.nota[campo]=estado.nota[campo] ?? p[i+1];
        }
        return {rowCount:1};
      }
      if (s.startsWith('SELECT id, insumo_id, descricao')) return {rows:estado.itens.map(i=>({...i})),rowCount:estado.itens.length};
      if (s.startsWith('INSERT INTO public.compras_itens')) {
        estado.itens.push({id:estado.itens.length+1,insumo_id:p[1],descricao:p[2],unidade:p[3],
          quantidade:p[4],preco_unitario:p[5],valor_total:p[6],posicao:p[7]});
        return {rowCount:1};
      }
      if (s.startsWith('UPDATE public.compras_itens')) return {rowCount:0};
      throw new Error('SQL desconhecido no teste: '+s.slice(0,85));
    },
  };
  const pool = {
    async connect(){return cliente;},
    async query(q) {
      if (q.startsWith('SELECT n.*, f.nome')) return {rows:[{...estado.nota,fornecedor_nome:'Fornecedor'}]};
      if (q.startsWith('SELECT id, insumo_id')) return {rows:estado.itens};
      throw new Error('SQL desconhecido no teste: '+q.slice(0,85));
    },
  };
  const arquivo=path.join(__dirname,'../src/services/compras/compras.service.js');
  const codigo=fs.readFileSync(arquivo,'utf8');
  const modulo={exports:{}};
  const fakeRequire = nome => {
    if (nome==='../../../db/connection') return pool;
    if (nome==='./comprasValidator') return validator;
    if (nome==='./comprasBoletos.service') return {listar:async()=>[],validarBoletos:xs=>xs,sincronizar:async()=>{},importar:async()=>0};
    throw new Error('Dependência inesperada: '+nome);
  };
  new Function('require','module','exports',codigo)(fakeRequire,modulo,modulo.exports);
  return {servico:modulo.exports,estado};
}
test('a mesma foto não duplica os insumos e preenche os campos faltantes',async()=>{
  const {servico,estado}=criarServicoFalso();
  const registro={fornecedor_id:2,numero_nf:'0007',valor_nf:120.40,valor_frete:4,icms_frete:0.8,
    itens:[{descricao:'Disco de alumínio',unidade:'kg',quantidade:2,preco_unitario:52}]};
  const primeiro=await servico.importarDaIa(registro);
  const segundo=await servico.importarDaIa(registro);
  assert.equal(primeiro.criada,false);
  assert.equal(primeiro.itensIncluidos,1);
  assert.equal(segundo.itensIncluidos,0);
  assert.equal(estado.itens.length,1);
  assert.equal(estado.nota.valor_nf,120.4);
  assert.equal(estado.nota.valor_frete,4);
});
test('a IA preserva valor já registrado manualmente',async()=>{
  const {servico,estado}=criarServicoFalso();
  estado.nota.valor_nf=99;
  await servico.importarDaIa({fornecedor_id:2,numero_nf:'0007',valor_nf:120.4,itens:[]});
  assert.equal(estado.nota.valor_nf,99);
});
