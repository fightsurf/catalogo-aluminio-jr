'use strict';
// Executar: node --test tests/perfis-preco.test.js (sem conexões externas)
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
process.env.ADMIN_SESSION_SECRET = 'chave-de-teste-nao-usar-producao';
const profiles = new Map(), sends = [], deliveries = [];
let idProfile = 0, idSend = 0, idDelivery = 0;
const itensProduto = [{id:1,nome:'Panela',preco:40,ativo:true,categoria:'PRESSÃO',categorias:[],fotos:[]},
  {id:2,nome:'Cafeteira',preco:15.53,ativo:true,categoria:'COZINHA',categorias:[],fotos:[]}];
const zapiCalls = [];
let falharUmDestino = null;
function sql(q, v=[]) {
  if (q.includes('CREATE TABLE IF NOT EXISTS')) return {rows: []};
  if (q.includes('INSERT INTO perfis_preco_vendedor')) {
    const id=++idProfile;
    const p={id,nome:v[0],tipo:v[1],valor:v[2],telefone_vendedor:v[3],token_hash:v[4],token_criptografado:v[5],ativo:true,criado_em:new Date().toISOString(),atualizado_em:new Date().toISOString()};
    profiles.set(id,p);return {rows:[p]};
  }
  if (q.includes('FROM perfis_preco_vendedor WHERE token_hash')) {
    const p=[...profiles.values()].find(x=>x.token_hash===v[0]);return {rows:p?[p]:[]};
  }
  if (q.includes('FROM perfis_preco_vendedor ORDER BY')) return {rows:[...profiles.values()]};
  if (q.includes('UPDATE perfis_preco_vendedor SET nome')) {
    const p=profiles.get(Number(v[0]));if(!p)return {rows:[]};
    Object.assign(p,{nome:v[1],tipo:v[2],valor:v[3],telefone_vendedor:v[4],ativo:v[5]});return {rows:[p]};
  }
  if (q.includes('UPDATE perfis_preco_vendedor SET token_hash')) {
    const p=profiles.get(Number(v[0]));Object.assign(p,{token_hash:v[1],token_criptografado:v[2]});return {rows:[p]};
  }
  if (q.includes('SELECT id,fingerprint FROM perfis_preco_envios')) {
    const s=sends.find(x=>x.perfil_id===Number(v[0])&&x.chave_cliente===v[1]);return {rows:s?[s]:[]};
  }
  if (q.includes('SELECT pg_advisory_xact_lock')) return {rows:[{}]};
  if (q.includes('COUNT(*) FILTER')) return {rows:[{minuto:0,dia:0}]};
  if (q.includes('INSERT INTO perfis_preco_envios')) {
    const s={id:++idSend,perfil_id:Number(v[0]),chave_cliente:v[1],fingerprint:v[2],modulo:v[3],itens:JSON.parse(v[4]),
      preco_base_centavos:v[5],preco_venda_centavos:v[6],comissao_centavos:v[7],relatorio_pedido:v[8],relatorio_comissao:v[9]};
    sends.push(s);return {rows:[s]};
  }
  if (q.includes('INSERT INTO perfis_preco_entregas')) {
    const d={id:++idDelivery,envio_id:Number(v[0]),telefone:v[1],ordem:v[2],mensagem:v[3],situacao:'pendente'};
    deliveries.push(d);return {rows:[d]};
  }
  if (q.includes('UPDATE perfis_preco_entregas SET situacao=\'enviando\'')) {
    const d=deliveries.find(x=>x.id===Number(v[0]));if (d.situacao!=='pendente')return {rows:[]};d.situacao='enviando';return{rows:[d]};
  }
  if (q.includes('UPDATE perfis_preco_entregas SET situacao=\'aceito\'')) {
    const d=deliveries.find(x=>x.id===Number(v[0]));d.situacao='aceito';return{rows:[]};
  }
  if (q.includes('UPDATE perfis_preco_entregas SET situacao=\'incerto\'')) {
    const d=deliveries.find(x=>x.id===Number(v[0]));d.situacao='incerto';return{rows:[]};
  }
  if (q.includes('FROM perfis_preco_entregas WHERE envio_id=$1 AND telefone=')) {
    return {rows: deliveries.filter(x=>x.envio_id===Number(v[0])&&x.telefone===v[1]&&x.ordem===1)};
  }
  if (q.includes('FROM perfis_preco_entregas') && q.includes('WHERE envio_id=$1')) {
    return {rows:deliveries.filter(x=>x.envio_id===Number(v[0])).sort((a,b)=>a.telefone.localeCompare(b.telefone)||a.ordem-b.ordem)};
  }
  throw new Error('SQL não simulado no teste: '+q.slice(0,150));
}
const pool = {query:async(q,v)=>sql(q,v),connect:async()=>({query:async(q,v)=>(['BEGIN','COMMIT','ROLLBACK'].includes(q)?{rows:[]}:sql(q,v)),release(){}})};
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if (request==='../../../db/connection'&&parent?.filename.includes('perfisPreco.service'))return pool;
  if (request==='../produto/produto.service'&&parent?.filename.includes('perfisPreco.service')) return {
    listar:async opts=>itensProduto.filter(p=>opts?.apenasAtivos ? p.ativo:true)
  };
  if (request==='../integracoes/zapi.service'&&parent?.filename.includes('perfisPreco.service'))return {
    enviarTexto:async obj=>{zapiCalls.push(obj);if(obj.telefone===falharUmDestino)throw new Error('Timeout de teste');return{success:true}}
  };
  return originalLoad(request,parent,isMain);
};
const service = require('../src/services/perfis-preco/perfisPreco.service');
Module._load=originalLoad;

test('acréscimo percentual e fixo arredondados por unidade',()=>{
  assert.equal(service.precoAjustadoCentavos(40,{tipo:'percentual',valor:10}),4400);
  assert.equal(service.precoAjustadoCentavos(40,{tipo:'fixo',valor:5}),4500);
  assert.equal(service.precoAjustadoCentavos(15.53,{tipo:'percentual',valor:10}),1708);
});

test('CRUD e tokens aleatórios, não inferíveis da porcentagem',async()=>{
  const p1=await service.criarAdmin({nome:'Perfil 10',tipo:'percentual',valor:10,telefone_vendedor:'(83) 99999-9999'});
  const p2=await service.criarAdmin({nome:'Perfil 10 B',tipo:'percentual',valor:10,telefone_vendedor:'5583999999998'});
  assert.notEqual(p1.token,p2.token); assert.match(p1.token,/^[\w-]{43}$/);
  assert.ok(!p1.token.includes('Perfil'));
  const publicos=await service.listarProdutos(p1.token,'orcamento');
  assert.equal(publicos.produtos[0].preco,44);
  assert.equal(JSON.stringify(publicos).includes('preco_base_centavos'),false);
  const kit=await service.construirPedido(p1.token,'kit-feirinha',[{id:1,qtd:10}]);
  assert.equal(kit.totalBase,40000);assert.equal(kit.totalVenda,44000);assert.equal(kit.totalComissao,4000);
  assert.ok(!kit.relatorioComissao.includes('Comissão unitária: R$ 40,00'));assert.match(kit.relatorioComissao,/COMISSÃO TOTAL: R\$ 40,00/);
  const alterado=await service.atualizarAdmin(p1.id,{nome:'Perfil Fixo',tipo:'fixo',valor:5,telefone_vendedor:'5583999999999',ativo:true});
  assert.equal(alterado.token,p1.token);assert.equal((await service.listarProdutos(p1.token,'catalogo')).produtos[0].preco,45);
  const novoToken=await service.regenerarToken(p1.id);
  await assert.rejects(service.localizar(p1.token),/inexistente/);
  assert.equal((await service.listarProdutos(novoToken.token,'orcamento')).produtos[0].preco,45);
  await service.atualizarAdmin(p1.id,{nome:'Inativo',tipo:'fixo',valor:5,telefone_vendedor:'5583999999999',ativo:false});
  await assert.rejects(service.listarProdutos(novoToken.token,'orcamento'),/desativado/);
});

test('envia apenas quatro mensagens (duas por destino) e não duplica ao repetir',async()=>{
  const perfil=await service.criarAdmin({nome:'Perfil 10 Envio',tipo:'percentual',valor:10,telefone_vendedor:'5583999999997'});
  const chave='fedcba98-1234-4abc-8def-123456789abc';
  const dados={modulo:'orcamento',chave,itens:[{id:1,qtd:2},{id:2,qtd:1}]};
  const primeiro=await service.enviar(perfil.token,dados);
  assert.equal(primeiro.concluido,true);
  assert.equal(sends.length,1);
  assert.equal(deliveries.length,4);assert.equal(zapiCalls.length,4);
  assert.match(sends[0].relatorio_pedido,/Valor total: R\$ 105,08/);
  assert.match(sends[0].relatorio_comissao,/COMISSÃO TOTAL: R\$ 9,55/);
  const segundo=await service.enviar(perfil.token,dados);
  assert.equal(segundo.concluido,true);assert.equal(zapiCalls.length,4);
  await assert.rejects(service.enviar(perfil.token,{...dados,itens:[{id:1,qtd:3}]}),/outros itens/);
});

test('não repete automaticamente um envio incerto e preserva a comissão do kit',async()=>{
  const perfil=await service.criarAdmin({nome:'Kit com falha',tipo:'fixo',valor:5,telefone_vendedor:'5583999999996'});
  const chave='aabbccdd-1234-4abc-8def-123456789abc';
  const dados={modulo:'kit-feirinha',chave,itens:[{id:1,qtd:2},{id:2,qtd:1}]};
  falharUmDestino='5583999999996';
  const primeiro=await service.enviar(perfil.token,dados);
  assert.equal(primeiro.concluido,false);
  const registro=sends.at(-1);
  assert.equal(registro.comissao_centavos,1500);
  assert.match(registro.relatorio_comissao,/COMISSÃO TOTAL: R\$ 15,00/);
  const chamadas=zapiCalls.length;
  falharUmDestino=null;
  const retry=await service.enviar(perfil.token,dados);
  assert.equal(retry.concluido,false);
  assert.equal(zapiCalls.length,chamadas,'timeout não deve causar mensagem repetida');
  assert.ok(retry.entregas.some(e=>e.situacao==='incerto'));
});


test('relatório da comissão separa itens por linha vazia e não inclui rodapé', async()=>{
  const p=await service.criarAdmin({nome:'Perfil Relatório',tipo:'percentual',valor:10,telefone_vendedor:'5583999999911'});
  for (const modulo of ['orcamento','kit-feirinha']) {
    const pedido=await service.construirPedido(p.token,modulo,[{id:1,qtd:1},{id:2,qtd:1}]);
    const relatorio=pedido.relatorioComissao;
    assert.match(relatorio, /💼 COMISSÃO PREVISTA - (ORÇAMENTO|KIT FEIRINHA)/);
    assert.match(relatorio, /Perfil: Perfil Relatório\n\n• Panela/);
    assert.match(relatorio, /Comissão do item: R\$ 4,00\n\n• Cafeteira/);
    assert.match(relatorio, /Comissão do item: R\$ 1,55\n\nCOMISSÃO TOTAL: R\$ 5,55$/);
    assert.ok(!relatorio.includes('Valor sujeito à confirmação'));
    assert.ok(!relatorio.includes('COMISSÃO TOTAL PREVISTA'));
  }
});
