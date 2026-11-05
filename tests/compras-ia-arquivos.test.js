'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const codigo=fs.readFileSync(path.join(__dirname,'../src/services/compras/comprasIa.service.js'),'utf8');
const modulo={exports:{}};
const erro=(mensagem,status)=>Object.assign(new Error(mensagem),{status});
new Function('require','module','exports',codigo)((nome)=>{
  if(nome==='sharp') return ()=>({});
  if(nome==='./comprasValidator') return {erro};
  if(nome==='./compras.service') return {fornecedores:async()=>[],insumos:async()=>[]};
  throw new Error('Dependência inesperada: '+nome);
},modulo,modulo.exports);
const {validarArquivos}=modulo.exports;
const pdf=()=>({originalname:'nota.pdf',mimetype:'application/pdf',buffer:Buffer.from('%PDF-1.7\n1 0 obj\n%%EOF')});
const foto=()=>({originalname:'foto.jpg',mimetype:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff])});
test('aceita PDF válido como arquivo único',()=>{
  assert.equal(validarArquivos([pdf()]),'pdf');
});
test('aceita fotos JPG e PNG sem mudar o fluxo antigo',()=>{
  assert.equal(validarArquivos([foto(),{...foto(),mimetype:'image/png'}]),'imagens');
});
test('não permite misturar PDF com fotos',()=>{
  assert.throws(()=>validarArquivos([pdf(),foto()]),/único PDF/);
});
test('rejeita PDF com assinatura inválida',()=>{
  assert.throws(()=>validarArquivos([{...pdf(),buffer:Buffer.from('conteúdo inválido')}]),/PDF inválido/);
});
test('rejeita PDF acima de 12 MB e fotos acima de 7 MB',()=>{
  assert.throws(()=>validarArquivos([{...pdf(),buffer:Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(12*1024*1024)])}]),/12 MB/);
  assert.throws(()=>validarArquivos([{...foto(),buffer:Buffer.alloc(7*1024*1024+1)}]),/7 MB/);
});
test('rejeita tipos de arquivo não suportados',()=>{
  assert.throws(()=>validarArquivos([{originalname:'malware.exe',mimetype:'application/octet-stream',buffer:Buffer.from('abc')}]),/Formato inválido/);
});
