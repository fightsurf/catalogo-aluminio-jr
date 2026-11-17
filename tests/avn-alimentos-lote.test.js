'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MAX_ITENS,chave,comparar,validarIdentidade}=require('../src/services/avn/avn-alimentos-lote.service');

test('AVN lote: nomes divididos entre nome e preparo são reconhecidos como o mesmo alimento',()=>{
 const existentes=[{id:7,nome:'Arroz branco, cozido',marca:null,preparo:null}];
 const [resultado]=comparar([{nome:'ARROZ BRANCO',marca:'',preparo:'Cozido'}],existentes);
 assert.equal(resultado.duplicado.id,7);
 assert.equal(chave(existentes[0]),chave(resultado));
});
test('AVN lote: diferentes preparos e marcas não são confundidos',()=>{
 const cadastrados=[{id:10,nome:'Ovo',preparo:'cru',marca:''},{id:11,nome:'Iogurte natural',preparo:'',marca:'Marca A'}];
 const entrada=[
  {nome:'Ovo',preparo:'cozido',marca:''},
  {nome:'Iogurte natural',preparo:'',marca:'Marca B'},
  {nome:'Ovo',preparo:'cru',marca:''}
 ];
 const result=comparar(entrada,cadastrados);
 assert.equal(result[0].duplicado,null);
 assert.equal(result[1].duplicado,null);
 assert.equal(result[2].duplicado.id,10);
});
test('AVN lote: repetições no mesmo print são sinalizadas',()=>{
 const result=comparar([{nome:'Banana prata',marca:'',preparo:'crua'},{nome:'BANANA PRATA, crua',marca:'',preparo:''}],[]);
 assert.equal(result[0].repetido_na_imagem,false);
 assert.equal(result[1].repetido_na_imagem,true);
});
test('AVN lote: nomes vazios, marcas ou preparos muito longos não passam',()=>{
 assert.throws(()=>validarIdentidade({nome:' ',marca:'',preparo:''}),/Revise o nome/);
 assert.throws(()=>validarIdentidade({nome:'Arroz',marca:'x'.repeat(121),preparo:''}),/Revise o nome/);
 assert.throws(()=>validarIdentidade({nome:'Arroz',marca:'',preparo:'x'.repeat(121)}),/Revise o nome/);
 assert.equal(MAX_ITENS,15);
});
