'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fonte = fs.readFileSync(path.join(__dirname, '../src/services/legado/pedido/resumo-pedido-ia.service.js'),'utf8');
function carregar(pedido) {
  const modulo = { exports: {} };
  const mock = {
    buscarDetalhePedido: async () => pedido,
    buscarItensPedido: async () => ({ carradaAtual: pedido.carradaAtual || null })
  };
  let chamadas = 0;
  vm.runInNewContext(fonte, {
    module: modulo, require: () => mock,
    process: { env: { OPENAI_API_KEY:'chave-falsa-teste', RESUMO_PEDIDO_IA_MODEL:'gpt-4o-mini' } },
    AbortSignal,
    fetch: async () => {
      chamadas++;
      return {ok:true,json:async()=>({ choices:[{message:{content:JSON.stringify({
        indices:[0,1,2], abertura:'Que boa escolha você fez!', despedida:'Obrigado pela confiança!'
      })}}] })};
    }
  }, {filename:'resumo-pedido-ia.service.js'});
  return {servico:modulo.exports,numeroDeChamadas:()=>chamadas};
}
function pedido(tipos, data='2026-11-15T00:00:00.000Z') {
  return {
    idMestre:123, numero:'00123', cliente:{nome:'José',telefonePrincipal:'5583999999999'},
    carradaAtual:data?{codigo:456,data}:null, situacao:'A',
    itens:tipos.map(([item,descricao,quantidade,preco])=>({item,descricao,quantidade,preco})),
    total:tipos.reduce((s,[,,q,p])=>s+q*p,0)
  };
}

test('detectar Kit Feirinha com preços iguais e itens distintos', () => {
  const {servico} = carregar(pedido([]));
  assert.equal(servico.detectarTipo([{item:1,preco:16},{item:2,preco:16}]),'kit-feirinha');
  assert.equal(servico.detectarTipo([{item:1,preco:16},{item:2,preco:18}]),'orcamento');
  assert.equal(servico.detectarTipo([{item:1,preco:16}]),'orcamento');
  assert.equal(servico.dataBR('2026-11-15T00:00:00.000Z'),'15/11/2026');
});

test('resumo do Kit contém preço médio, total e data corretos', async () => {
  const p = pedido([[1,'Panela de pressão',1,16],[2,'Cafeteira',1,16],[3,'Frigideira',2,16]]);
  const {servico,numeroDeChamadas}=carregar(p);
  const dados=await servico.gerarResumo('123','automatico');
  assert.equal(dados.tipo,'kit-feirinha');
  assert.equal(dados.precoMedio,16);
  assert.equal(dados.total,64);
  assert.equal(dados.dataPrevisao,'15/11/2026');
  assert.equal(dados.produtosDestacados.length,3);
  assert.match(dados.texto,/preço médio por peça/);
  assert.match(dados.texto,/64,00/);
  assert.match(dados.texto,/15\/11\/2026/);
  assert.equal(numeroDeChamadas(),1);
});

test('resumo de orçamento normal inclui total mas não preço médio', async () => {
  const {servico}=carregar(pedido([[1,'Panela de pressão',10,145],[2,'Cafeteira',10,100]]));
  const dados=await servico.gerarResumo('123','automatico');
  assert.equal(dados.tipo,'orcamento');
  assert.equal(dados.precoMedio,null);
  assert.doesNotMatch(dados.texto,/preço médio/);
  assert.match(dados.texto,/2.450,00/);
});

test('não inventa data para pedido sem carrada', async () => {
  const {servico}=carregar(pedido([[1,'Panela',2,40]],null));
  const dados=await servico.gerarResumo('123','automatico');
  assert.equal(dados.dataPrevisao,null);
  assert.match(dados.texto,/ainda não foi informada/);
});

test('aceita correção manual de Kit/orçamento e rejeita pedido inválido', async () => {
  const {servico}=carregar(pedido([[1,'Panela',2,40],[2,'Cafeteira',1,30]]));
  const dados=await servico.gerarResumo('123','kit-feirinha');
  assert.equal(dados.tipo,'kit-feirinha');
  await assert.rejects(()=>servico.gerarResumo('outro'),/Identificador inválido/);
});

test('resumo curto prioriza pressão e antiaderentes e fala quantidades exatas', async () => {
  const p=pedido([
    [1,'Cafeteira',8,16],
    [2,'Bule de alumínio',5,16],
    [3,'Caneca',4,16],
    [4,'Panela de pressão 4,5 litros',7,16],
    [5,'Frigideira antiaderente',3,16]
  ],'2026-11-03T00:00:00.000Z');
  const {servico}=carregar(p);
  const dados=await servico.gerarResumo('123','kit-feirinha');
  assert.equal(dados.produtosDestacados.length,3);
  assert.match(dados.texto,/7 unidades de Panela de pressão 4,5 litros/);
  assert.match(dados.texto,/3 unidades de Frigideira antiaderente/);
  assert.doesNotMatch(dados.texto,/tipos de produtos|agradece pela confiança|Obrigado pela confiança/i);
  assert.match(dados.texto,/03\/11\/2026/);
});

test('expande TMP para tampa somente na apresentação, sem alterar demais nomes', async () => {
  const p = pedido([
    [1, 'TMP DE PRESSÃO 4,5 L', 2, 25],
    [2, 'Kit TMP-20 CM', 1, 30],
    [3, 'ESTAMPADA', 1, 20]
  ]);
  const {servico} = carregar(p);
  const dados = await servico.gerarResumo('123','orcamento');
  assert.match(dados.texto, /2 unidades de tampa DE PRESSÃO 4,5 L/);
  assert.match(dados.texto, /1 unidade de Kit tampa-20 CM/);
  assert.match(dados.texto, /1 unidade de ESTAMPADA/);
  assert.doesNotMatch(dados.texto, /\\bTMP\\b/);
  assert.ok(dados.produtosDestacados.some(nome => nome.includes('tampa DE PRESSÃO')));
  assert.equal(p.itens[0].descricao, 'TMP DE PRESSÃO 4,5 L');
  assert.equal(p.itens[1].descricao, 'Kit TMP-20 CM');
});

test('CRAQ e TMP são expandidos apenas como abreviações isoladas no pitch', async () => {
  const p = pedido([
    [1, 'TMP CRAQ 24 CM', 2, 25],
    [2, 'CRAQ-30 CM', 1, 30],
    [3, 'ACRAQADO', 1, 20]
  ]);
  const {servico} = carregar(p);
  const dados = await servico.gerarResumo('123', 'orcamento');
  assert.match(dados.texto, /2 unidades de tampa craqueado 24 CM/);
  assert.match(dados.texto, /1 unidade de craqueado-30 CM/);
  assert.match(dados.texto, /1 unidade de ACRAQADO/);
  assert.equal(p.itens[0].descricao, 'TMP CRAQ 24 CM');
  assert.equal(p.itens[1].descricao, 'CRAQ-30 CM');
});

test('previsão contextualizada usa a semana local do Brasil e dias reais', () => {
  const {servico} = carregar(pedido([]));
  const agora = new Date('2026-11-11T20:00:00Z'); // 17h no horário de Brasília.
  assert.equal(servico.previsaoFalavel('2026-11-15', agora), '15/11/2026, domingo desta semana');
  assert.equal(servico.previsaoFalavel('2026-11-20', agora), '20/11/2026, sexta-feira da semana que vem');
  assert.equal(servico.previsaoFalavel('2026-11-29', agora), '29/11/2026, domingo, daqui a 18 dias');
  assert.equal(servico.previsaoFalavel('2026-11-08', agora), '08/11/2026, domingo');
  assert.equal(servico.previsaoFalavel('2026-02-30', agora), '');
  // Na virada de data UTC, ainda é 11/11 em São Paulo.
  assert.equal(servico.previsaoFalavel('2026-11-12', new Date('2026-11-12T01:00:00Z')), '12/11/2026, quinta-feira desta semana');
});

test('pitch sempre termina com mensagem fixa sobre fotos inclusive sem previsão', async () => {
  const frase = 'Vou enviar as fotos de todos os itens do seu pedido agora. Um momento.';
  const comCarrada = carregar(pedido([[1, 'TMP CRAQ', 1, 30]]));
  const dados = await comCarrada.servico.gerarResumo('123', 'orcamento');
  assert.ok(dados.texto.endsWith(frase));
  assert.match(dados.texto, /previsão de finalização do pedido é para o dia 15\/11\/2026, domingo/);
  const semCarrada = carregar(pedido([[1, 'TMP', 1, 30]], null));
  const semPrevisao = await semCarrada.servico.gerarResumo('123', 'orcamento');
  assert.ok(semPrevisao.texto.endsWith(frase));
  assert.match(semPrevisao.texto, /previsão de finalização ainda não foi informada/);
});
