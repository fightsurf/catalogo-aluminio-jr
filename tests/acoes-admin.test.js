'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const acoes = require('../src/services/whatsapp/acoes-admin.service');
const admin = require('../src/services/whatsapp/intencoes-admin.service');

const clienteAcao = {
  id:12,nome:'Buscar clientes',entidade:'clientes',filtro:'nome_informado',
  ordenacao:'nome_asc',limite:6,campos:['nome','cidade','uf','telefone'],
  cabecalho:'Clientes para {{termo}}',
  item:'{{indice}}. {{nome}}\nCidade: {{cidade}}/{{uf}}\nTelefone: {{telefone}}',
  vazio:'Nenhum cliente para {{termo}}.',ativo:true
};
const pedidosAcao = {
  id:13,nome:'Consultar pedidos',entidade:'pedidos',filtro:'cliente_selecionado',
  ordenacao:'data_desc',limite:5,campos:['numero','data','total','situacao'],
  cabecalho:'Pedidos de {{cliente.nome}}',
  item:'{{indice}}. Pedido {{numero}}\nData: {{data}}\nValor: {{total}}\nSituação: {{situacao}}',
  vazio:'Nenhum pedido para {{cliente.nome}}.',ativo:true
};

test('catálogo somente expõe entidades e campos autorizados',()=>{
  assert.deepEqual(Object.keys(acoes.ENTIDADES),['clientes','pedidos']);
  assert.equal(acoes.validacao(clienteAcao).entidade,'clientes');
  assert.throws(()=>acoes.validacao({...pedidosAcao,campos:['senha']}),/campos válidos/);
  assert.throws(()=>acoes.validacao({...pedidosAcao,item:'{{senha}}'}),/não autorizado/);
  assert.throws(()=>acoes.validacao({...pedidosAcao,limite:500}),/Limite permitido/);
  assert.throws(()=>acoes.validacao({...pedidosAcao,ordenacao:'sql_custom'}),/não permitida/);
});

test('ação de pedidos aplica filtro pelo cliente e formata moeda, data e limite',async()=>{
  const consultados=[];
  const saida=await acoes.executar(pedidosAcao,{cliente:{favorecido:90,nome:'Maria'}},{
    listarPedidosPorCliente:async id=>{
      consultados.push(id);
      return {dados:[
        {numero:50,data:'2026-10-01',total:10,situacao:'A'},
        {numero:70,data:'2026-11-05',total:1500.5,situacao:'A'},
        {numero:60,data:'2026-11-03',total:100,situacao:'C'},
        {numero:65,data:'2026-11-04',total:45,situacao:'A'},
        {numero:55,data:'2026-11-02',total:30,situacao:'A'},
        {numero:54,data:'2026-11-01',total:22,situacao:'A'}
      ]};
    }
  });
  assert.deepEqual(consultados,[90]);
  assert.match(saida.mensagem,/Pedidos de Maria/);
  assert.match(saida.mensagem,/1\. Pedido 70\nData: 05\/11\/2026\nValor: R\$\s*1\.500,50/);
  assert.doesNotMatch(saida.mensagem,/Pedido 50/);
  assert.equal(saida.registros.length,5);
  await assert.rejects(()=>acoes.executar(pedidosAcao,{},{
    listarPedidosPorCliente:async()=>{throw Error('Não pode consultar sem cliente');}
  }),/Primeiro localize e selecione/);
});

test('intenções configuradas: buscar cliente, escolher número 6 e consultar pedidos',async()=>{
  const intents=[
    {id:1,chave:'buscar_config',nome:'Buscar cliente',descricao:'Busca o cliente.',
      acao:'configurada',acao_id:12,ativo:true,frases:'buscar cliente',proximas_intencoes:[2]},
    {id:2,chave:'pedidos_config',nome:'Consultar pedidos',descricao:'Consulta pedidos desse cliente.',
      acao:'configurada',acao_id:13,ativo:true,frases:'consultar pedidos',proximas_intencoes:[]}
  ];
  const mensagens=[]; const consultados=[];
  const deps={
    listarAcoes:async()=>[clienteAcao,pedidosAcao],
    listarIntencoes:async()=>intents,
    classificar:async(text,disponiveis)=>{
      if(text.includes('cliente')){
        assert.equal(disponiveis[0].entidade,'clientes');
        return {intencao:disponiveis[0],argumento:'Maria'};
      }
      return {intencao:disponiveis[1],argumento:''};
    },
    listarClientes:async()=>Array.from({length:6},(_,i)=>({
      favorecido:i+1,nome:'Maria '+(i+1),cidade:'Patos',uf:'PB',telefonePrincipal:'83999990000'
    })),
    listarPedidosPorCliente:async id=>{
      consultados.push(id);
      return {dados:[{numero:101,data:'2026-11-05',total:80,situacao:'A'}]};
    },
    enviar:async ({mensagem})=>mensagens.push(mensagem)
  };
  const telefone='5583988776688';
  const busca=await admin.processarMensagem({telefone,texto:'Buscar cliente Maria',permitido:true},deps);
  assert.match(busca.resposta,/6\. Maria 6/);
  const selecao=await admin.processarMensagem({telefone,texto:'6',permitido:true},deps);
  assert.match(selecao.resposta,/Maria 6/);
  assert.match(selecao.resposta,/1\. Consultar pedidos/);
  const pedidos=await admin.processarMensagem({telefone,texto:'1',permitido:true},deps);
  assert.match(pedidos.resposta,/Pedidos de Maria 6/);
  assert.deepEqual(consultados,[6]);
  assert.equal(mensagens.length,3);
});
