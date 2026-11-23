'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const validator=require('../src/services/compras/comprasValidator');

function carregar(arquivo,dependencias){
  const modulo={exports:{}};
  const fonte=fs.readFileSync(path.join(__dirname,'../src/services/compras',arquivo),'utf8');
  new Function('require','module','exports',fonte)(nome=>{
    if(Object.prototype.hasOwnProperty.call(dependencias,nome))return dependencias[nome];
    throw new Error('Dependência inesperada: '+nome);
  },modulo,modulo.exports);
  return modulo.exports;
}
const boleto={id:11,nota_id:7,tipo:'boleto',parcela:'1/1',vencimento:'2026-12-10',valor:100,status:'pendente'};
function ambiente({notaExiste=true,falharLeitura=false}={}){
  let estado={nota:{id:7,fornecedor_id:2,numero_nf:'NF-7',icms_frete:'12.34',icms_total:'50.00'},
    itens:[{id:31,nota_id:7,descricao:'Alumínio',quantidade:2}],boletos:[{...boleto}]};
  let anterior,conexoes=0,liberacoes=0;
  const chamadas=[];
  async function query(sql,p=[]){
    chamadas.push({sql,p});
    if(sql==='BEGIN'){anterior=structuredClone(estado);return {};}
    if(sql==='ROLLBACK'){estado=anterior;return {};}
    if(sql==='COMMIT')return {};
    if(sql.startsWith('SELECT 1 FROM public.fornecedores'))return {rowCount:1,rows:[{}]};
    if(sql.startsWith('SELECT id')&&sql.includes('FROM public.compras_notas'))
      return {rowCount:notaExiste?1:0,rows:notaExiste?[{...estado.nota}]:[]};
    if(sql.startsWith('SELECT n.*'))return {rows:[{...estado.nota,fornecedor_nome:'Fornecedor'}]};
    if(sql.startsWith('SELECT id, insumo_id'))return {rows:structuredClone(estado.itens)};
    if(sql.startsWith('SELECT id FROM public.compras_boletos'))
      return {rows:estado.boletos.filter(b=>b.nota_id===p[0]).map(b=>({id:b.id}))};
    if(sql.startsWith('SELECT id,nota_id')){
      if(falharLeitura)throw new Error('Falha de leitura simulada.');
      return {rows:structuredClone(estado.boletos.filter(b=>b.nota_id===Number(p[0])))};
    }
    if(sql.startsWith('UPDATE public.compras_boletos')){
      const atual=estado.boletos.find(b=>b.nota_id===p[0]&&b.id===p[1]);
      const campos=['tipo','parcela','numero_documento','nosso_numero','banco','vencimento','valor','linha_digitavel','codigo_barras','status','data_pagamento','valor_pago','observacao'];
      campos.forEach((campo,i)=>{atual[campo]=p[i+2];});
      return {rowCount:1};
    }
    if(sql.startsWith('INSERT INTO public.compras_boletos')){
      const campos=['nota_id','tipo','parcela','numero_documento','nosso_numero','banco','vencimento','valor','linha_digitavel','codigo_barras','status','data_pagamento','valor_pago','observacao','origem'];
      const novo={id:100};campos.forEach((campo,i)=>{novo[campo]=p[i];});
      estado.boletos.push(novo);return {rows:[{id:novo.id}]};
    }
    if(sql.startsWith('DELETE FROM public.compras_boletos')){
      estado.boletos=estado.boletos.filter(b=>b.nota_id!==p[0]||p[1].includes(b.id));return {};
    }
    if(sql.startsWith('UPDATE public.compras_notas')){
      const campos=['fornecedor_id','numero_nf','data_nf','valor_nf','quantidade_itens_nf','valor_frete','icms_frete','icms_total','origem'];
      campos.forEach((campo,i)=>{estado.nota[campo]=p[i];});
      return {rows:[{id:estado.nota.id}]};
    }
    if(sql.startsWith('DELETE FROM public.compras_itens')){estado.itens=[];return {};}
    throw new Error('SQL inesperado: '+sql);
  }
  const cliente={query,release(){liberacoes++;}};
  const pool={query,async connect(){conexoes++;return cliente;}};
  const dependencias={'../../../db/connection':pool,'./comprasValidator':validator};
  const boletos=carregar('comprasBoletos.service.js',dependencias);
  const service=carregar('compras.service.js',{...dependencias,'./comprasBoletos.service':boletos});
  return {service,chamadas,estado:()=>estado,conexoes:()=>conexoes,liberacoes:()=>liberacoes};
}

test('salvar boletos altera somente os títulos e retorna a lista confirmada',async()=>{
  const a=ambiente(),nota=structuredClone(a.estado().nota),itens=structuredClone(a.estado().itens);
  const resultado=await a.service.gravarBoletos('7',[{...boleto,valor:175}]);
  assert.equal(resultado.nota_id,7);
  assert.equal(resultado.boletos[0].valor,175);
  assert.deepEqual(a.estado().nota,nota);
  assert.deepEqual(a.estado().itens,itens);
  assert.equal(a.chamadas.some(c=>/^(UPDATE|INSERT|DELETE).*public\.compras_(notas|itens)/.test(c.sql)),false);
  assert.equal(a.chamadas[0].sql,'BEGIN');
  assert.match(a.chamadas[1].sql,/compras_notas.*FOR UPDATE/);
  assert.equal(a.chamadas.at(-1).sql,'COMMIT');
  assert.equal(a.liberacoes(),1);
});
test('lista vazia remove boletos sem apagar a nota ou seus insumos',async()=>{
  const a=ambiente();
  assert.deepEqual(await a.service.gravarBoletos(7,[]),{nota_id:7,boletos:[]});
  assert.equal(a.estado().nota.id,7);
  assert.equal(a.estado().itens.length,1);
});
test('id ou lista inválidos são rejeitados antes de abrir uma conexão',async()=>{
  const a=ambiente();
  for(const id of ['abc',0,-1,1.5])await assert.rejects(a.service.gravarBoletos(id,[]),/Nota inválida/);
  for(const lista of [undefined,null,{}])await assert.rejects(a.service.gravarBoletos(7,lista),/Lista de boletos inválida/);
  assert.equal(a.conexoes(),0);
});
test('NF inexistente é 404 e a transação é revertida',async()=>{
  const a=ambiente({notaExiste:false});
  await assert.rejects(a.service.gravarBoletos(7,[]),e=>e.status===404);
  assert.equal(a.chamadas.at(-1).sql,'ROLLBACK');
  assert.equal(a.liberacoes(),1);
  assert.equal(a.estado().boletos.length,1);
});
test('boleto de outra nota é rejeitado sem alteração parcial',async()=>{
  const a=ambiente(),antes=structuredClone(a.estado());
  await assert.rejects(a.service.gravarBoletos(7,[{...boleto,valor:200},{...boleto,id:99}]),/Boleto inexistente/);
  assert.deepEqual(a.estado(),antes);
  assert.equal(a.chamadas.at(-1).sql,'ROLLBACK');
});
test('falha ao obter a lista reverte a sincronização antes do commit',async()=>{
  const a=ambiente({falharLeitura:true}),antes=structuredClone(a.estado());
  await assert.rejects(a.service.gravarBoletos(7,[{...boleto,valor:200}]),/Falha de leitura/);
  assert.deepEqual(a.estado(),antes);
  assert.equal(a.chamadas.some(c=>c.sql==='COMMIT'),false);
  assert.equal(a.liberacoes(),1);
});
test('editar NF sem ICMS do frete preserva seu valor e permite zero insumos',async()=>{
  const a=ambiente();
  const nota=await a.service.gravar({fornecedor_id:2,numero_nf:'NF-7',icms_total:80,itens:[]},7);
  assert.equal(nota.icms_frete,'12.34');
  assert.equal(nota.icms_total,80);
  assert.deepEqual(nota.itens,[]);
  assert.equal(nota.boletos.length,1);
});
test('ICMS do frete explicitamente informado continua aceitando zero, valor e null',async()=>{
  for(const icms_frete of [0,7.50,null]){
    const a=ambiente();
    const nota=await a.service.gravar({fornecedor_id:2,numero_nf:'NF-7',icms_frete,itens:[]},7);
    assert.equal(nota.icms_frete,icms_frete);
  }
});
