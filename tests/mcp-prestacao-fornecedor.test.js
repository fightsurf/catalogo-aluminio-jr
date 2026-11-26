'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validar } = require('../src/routes/integracao/mcpValidacao');
const { outputSchemaFor } = require('../src/routes/integracao/mcpOutputSchemas');
function carregar(file, deps) {
  const module = { exports:{} };
  new Function('require','module','exports',fs.readFileSync(path.join(__dirname,'..',file),'utf8'))(name=>{
    if (!(name in deps)) throw new Error('Dependência não simulada: '+name);
    return deps[name];
  },module,module.exports);
  return module.exports;
}
const selecao={ prestacao_id:9, fornecedor_id:3 };
const pagamento={ ...selecao, data:'2026-11-26', valor:123.45, observacao:'Pix Santander PJ' };
function ambiente() {
  const chamadas=[];
  const p={ id:9, fornecedor_id:3, fornecedor_nome:'José Teste', titulo:'Novembro',
    status:'ABERTA', data_referencia:'2026-11-01', total_material:'1000.00', total_pago:'200.00', saldo_restante:'800.00' };
  const r={ fornecedor_id:3, fornecedor:'José Teste', telefone:'5584999990000', quantidade_pagamentos:1, mensagem:'Resumo original da tela' };
  const prestacoes={
    listar: async status=>{ assert.equal(status,'ABERTA'); return [p,{...p,id:10,titulo:'Outra'}]; },
    buscarPorId: async id=>id===9?{...p}:null,
    _statusPrestacao: x=>x.status,
    criarPagamento:async(id,d,{validarPrestacao})=>{
      validarPrestacao(p); chamadas.push(['criarPagamento',id,d]);
      p.total_pago='323.45';p.saldo_restante='676.55';
      return {id:20, data_pagamento:d.data, valor:d.valor, observacao:d.observacao};
    },
    prepararResumoWhatsapp:async()=>({...r}),
    enviarResumoWhatsapp:async(id,{validarResumo})=>{
      validarResumo(r); chamadas.push(['enviarResumoWhatsapp',id]);return {...r};
    }
  };
  const controle={ verificar:async key=>{assert.equal(key,'prestacoes_resumo');},
    comFuncionalidade:async(key,fn)=>{assert.equal(key,'prestacoes_resumo');return fn();} };
  const svc=carregar('src/services/integracao/mcpPrestacaoFornecedor.service.js',{
    '../prestacao_contas/prestacao_contas.service':prestacoes,
    '../whatsapp/central-controle.service':controle
  });
  const contexto={ registrarProgresso:async etapa=>chamadas.push(['progresso',etapa]) };
  return {svc,p,r,chamadas,contexto,prestacoes,controle};
}
test('busca aberta por nome sem acento mantém todas as opções e pagina',async()=>{
  const a=ambiente();
  const r=await a.svc.buscarAbertas({fornecedor:'Jose',limite:1});
  assert.equal(r.total_encontrado,2);assert.equal(r.proxima_pagina,2);assert.equal(r.prestacoes[0].fornecedor,'José Teste');
  assert.ok(validar(outputSchemaFor('buscar_prestacoes_fornecedor'),r));
  assert.equal((await a.svc.buscarAbertas({fornecedor_id:999})).total_encontrado,0);
});
test('prévia não grava, calcula saldo e confirmação usa rotina original uma vez',async()=>{
  const a=ambiente();const previa=await a.svc.prepararPagamento(pagamento);
  assert.equal(previa.resumo.saldo_previsto,676.55);
  assert.equal(previa.resumo.total_pago_previsto,323.45);
  assert.deepEqual(a.chamadas,[]);
  const r=await a.svc.executarPagamento(previa.payload,a.contexto);
  assert.equal(r.status,'gravado');assert.equal(r.pagamento.id,20);assert.equal(r.prestacao.saldo_restante,676.55);
  assert.equal(r.whatsapp_enviado,false);
  assert.deepEqual(a.chamadas.filter(x=>x[0]==='criarPagamento'),[['criarPagamento',9,{data:pagamento.data,valor:pagamento.valor,observacao:pagamento.observacao}]]);
  await assert.rejects(()=>a.svc.executarPagamento(previa.payload,a.contexto),/mudou/);
});
test('bloqueia fornecedor incorreto, conta concluída, data impossível e valores inválidos',async()=>{
  const a=ambiente();
  for(const args of [{...pagamento,fornecedor_id:4},{...pagamento,data:'2026-02-30'},{...pagamento,valor:0},{...pagamento,valor:1.001},{...pagamento,observacao:null}]){
    await assert.rejects(()=>a.svc.prepararPagamento(args));
  }
  a.p.status='CONCLUIDA';await assert.rejects(()=>a.svc.prepararPagamento(pagamento),/concluída/);
  assert.deepEqual(a.chamadas,[]);
});
test('bloqueia alteração de valores desde a prévia e não chama gravação',async()=>{
  const a=ambiente();const previa=await a.svc.prepararPagamento(pagamento);a.p.total_pago='201.00';
  await assert.rejects(()=>a.svc.executarPagamento(previa.payload,a.contexto),/mudou/);
  assert.deepEqual(a.chamadas,[]);
});
test('WhatsApp só envia após confirmação, preserva texto da rotina web e controle',async()=>{
  const a=ambiente();const previa=await a.svc.prepararWhatsApp(selecao);
  assert.equal(previa.resumo.mensagem,a.r.mensagem);
  assert.equal(previa.resumo.destinatario.telefone,a.r.telefone);
  assert.deepEqual(a.chamadas,[]);
  const r=await a.svc.executarWhatsApp(previa.payload,a.contexto);
  assert.equal(r.status,'aceito_pelo_provedor');assert.equal(r.entrega_confirmada,false);
  assert.deepEqual(a.chamadas.filter(x=>x[0]==='enviarResumoWhatsapp'),[['enviarResumoWhatsapp',9]]);
});
test('bloqueia resumo alterado e Central de Controle desativada',async()=>{
  const a=ambiente();const previa=await a.svc.prepararWhatsApp(selecao);
  a.r.mensagem='Mudou';
  await assert.rejects(()=>a.svc.executarWhatsApp(previa.payload,a.contexto),/mudou/);
  assert.deepEqual(a.chamadas,[]);
  a.controle.verificar=async()=>{throw new Error('Desativado');};
  await assert.rejects(()=>a.svc.prepararWhatsApp(selecao),/Desativado/);
});
