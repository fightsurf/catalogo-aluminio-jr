'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const validator=require('../src/services/compras/comprasValidator');
const src=fs.readFileSync(path.join(__dirname,'../src/services/compras/comprasBoletos.service.js'),'utf8');
const modulo={exports:{}};
new Function('require','module','exports',src)(nome=>{
  if(nome==='../../../db/connection')return {};
  if(nome==='./comprasValidator')return validator;
  throw new Error('Dependência inesperada: '+nome);
},modulo,modulo.exports);
const {validarBoletos,iguais,importar}=modulo.exports;
const a={tipo:'duplicata',parcela:'1/2',vencimento:'2026-12-10',valor:250.50};
const b={tipo:'duplicata',parcela:'2/2',vencimento:'2027-01-10',valor:250.50};
test('uma NF aceita zero ou múltiplos boletos',()=>{
  assert.deepEqual(validarBoletos([]),[]);
  assert.equal(validarBoletos([a,b]).length,2);
});
test('duplicata sem código bancário permanece a confirmar',()=>{
  assert.equal(validarBoletos([a])[0].status,'a_confirmar');
});
test('mesma parcela não duplica, parcelas distintas permanecem separadas',()=>{
  assert.equal(iguais(a,{...a}),true);
  assert.equal(iguais({...a,parcela:'1/2'},{...a,parcela:'2/2'}),false);
});
test('valor, data e linha digitável são validados',()=>{
  assert.throws(()=>validarBoletos([{...a,valor:null}]),/valor/i);
  assert.throws(()=>validarBoletos([{...a,vencimento:'2026-02-30'}]),/inválida/i);
  assert.throws(()=>validarBoletos([{...a,linha_digitavel:'123'}]),/digitável/i);
});
test('importação repetida complementa título sem cadastrar duas vezes',async()=>{
  const estado=[];
  const cliente={async query(sql,p=[]){
    if(sql.startsWith('SELECT id,nota_id'))return {rows:estado.map(x=>({...x}))};
    if(sql.startsWith('INSERT INTO public.compras_boletos')){
      const novo={...a,...{nota_id:p[0],tipo:p[1],parcela:p[2],numero_documento:p[3],nosso_numero:p[4],banco:p[5],vencimento:p[6],valor:p[7],linha_digitavel:p[8],codigo_barras:p[9],status:p[10]},id:estado.length+1};
      estado.push(novo);return {rows:[{id:novo.id}]};
    }
    if(sql.startsWith('UPDATE public.compras_boletos'))return {rowCount:1};
    throw Error('SQL inesperado: '+sql.slice(0,60));
  }};
  const bs=validarBoletos([a,b],'ia');
  assert.equal(await importar(cliente,2,bs),2);
  assert.equal(await importar(cliente,2,bs),0);
  assert.equal(estado.length,2);
});
