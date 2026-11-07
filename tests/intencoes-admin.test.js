'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../src/services/whatsapp/intencoes-admin.service');
const ia = require('../src/services/whatsapp/classificador-intencoes-admin.service');
const intencoes = [{ id:1, chave:'localizar_cliente', nome:'Localizar cliente',
  descricao:'Localiza clientes pelo nome informado sem realizar alterações.', acao:'localizar_cliente', ativo:true,
  frases:'localize cliente\nlocalizar cliente\nprocure cliente\nbusque cliente' }];
test('interpreta comando de voz com ou sem palavra Sistema', () => {
  assert.equal(admin.identificar('Sistema, localize cliente José de Sousa', intencoes).argumento, 'José de Sousa');
  assert.equal(admin.identificar('localize cliente Maria', intencoes).argumento, 'Maria');
  assert.equal(admin.identificar('localizar cliente', intencoes).argumento, '');
  assert.equal(admin.identificar('estou falando com um cliente', intencoes), null);
  assert.equal(admin.identificar('localize cliente Maria', [{...intencoes[0], ativo:false}]), null);
});
test('não executa busca sem autorização', async () => {
  const r = await admin.processarMensagem({telefone:'5583999792085',texto:'localize cliente Maria'});
  assert.equal(r.reconhecido, false);
});
test('consulta e responde somente quando autorizado, sem alterar cadastro', async () => {
  const enviados = []; let nomeBuscado;
  const deps = {
    classificar: async (frase, catalogo) => {
      assert.equal(catalogo[0].descricao, intencoes[0].descricao);
      return { intencao: intencoes[0], argumento: 'Maria' };
    },
    listarIntencoes: async () => intencoes,
    listarClientes: async nome => { nomeBuscado = nome; return [
      {favorecido:7,nome:'Maria Lima',cidade:'Sousa',uf:'PB',telefonePrincipal:'83999990000'},
      {favorecido:8,nome:'Maria Silva',cidade:'Patos',uf:'PB',telefone1:'83988887777'} ]; },
    enviar: async ({mensagem}) => enviados.push(mensagem)
  };
  const r = await admin.processarMensagem({
    telefone:'5583999792085',texto:'Sistema, localize cliente Maria',permitido:true
  },deps);
  assert.equal(nomeBuscado,'Maria');
  assert.equal(r.reconhecido,true);
  assert.match(enviados[0],/Maria Lima/);
  assert.match(enviados[0],/Maria Silva/);
  assert.match(enviados[0],/1\. \*Maria Lima\*\nCidade: Sousa\/PB\nTelefone: \(83\) 99999-0000/);
  assert.match(enviados[0],/\n\n2\. \*Maria Silva\*\nCidade: Patos\/PB\nTelefone: \(83\) 98888-7777/);
  assert.equal(enviados.length, 1);
});
test('pergunta nome e continua a mesma conversa', async () => {
  const enviados=[]; let buscado='';
  const deps={
    classificar: async frase => frase === 'localize cliente'
      ? { intencao:intencoes[0], argumento:'' } : { intencao:null, argumento:'' },
    listarIntencoes: async()=>intencoes,
    listarClientes: async nome=>{buscado=nome;return [];},
    enviar:async({mensagem})=>enviados.push(mensagem)
  };
  await admin.processarMensagem({telefone:'5583999792085',texto:'localize cliente',permitido:true},deps);
  assert.match(enviados[0],/Qual é o nome/);
  await admin.processarMensagem({telefone:'5583999792085',texto:'João',permitido:true},deps);
  assert.equal(buscado,'João');
});

test('classificador recebe mensagem completa, descrição e exemplos, sem inventar ação', async () => {
  const anterior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'CHAVE_DE_TESTE';
  try {
    let chamadas = 0;
    const classificar = async (texto, retorno) => ia.classificar(texto, intencoes, {
      fetch: async (url, opcoes) => {
        chamadas++;
        assert.equal(url, 'https://api.openai.com/v1/chat/completions');
        const body = JSON.parse(opcoes.body);
        assert.equal(body.response_format.type, 'json_object');
        const dados = JSON.parse(body.messages[1].content);
        assert.equal(dados.mensagem_recebida, 'Sistema, localize o cliente Maria');
        assert.equal(dados.intencoes_disponiveis[0].descricao, intencoes[0].descricao);
        assert.deepEqual(dados.intencoes_disponiveis[0].frases_exemplo.slice(0,2),
          ['localize cliente','localizar cliente']);
        return {ok:true, json:async()=>({choices:[{message:{content:JSON.stringify(retorno)}}]})};
      }
    });
    const reconhecida = await classificar('Sistema, localize o cliente Maria',
      {chave:'localizar_cliente',argumento:'Maria'});
    assert.equal(reconhecida.intencao.acao, 'localizar_cliente');
    assert.equal(reconhecida.argumento, 'Maria');
    assert.equal((await classificar('Sistema, localize o cliente Maria',
      {chave:'inventada', argumento:'Maria'})).intencao, null);
    assert.equal(chamadas, 2);
  } finally {
    if (anterior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = anterior;
  }
});

test('intenção não reconhecida não consulta o cadastro nem envia WhatsApp', async () => {
  let consultou = false;
  let enviou = false;
  const r = await admin.processarMensagem({
    telefone:'5583999792085', texto:'Quero ouvir música', permitido:true
  },{
    listarIntencoes:async()=>intencoes,
    classificar:async()=>({intencao:null,argumento:''}),
    listarClientes:async()=>{consultou=true;return[];},
    enviar:async()=>{enviou=true;}
  });
  assert.equal(r.reconhecido,false);
  assert.equal(r.motivo,'intencao_nao_reconhecida');
  assert.equal(consultou,false);
  assert.equal(enviou,false);
});

test('limita a resposta a cinco clientes e separa os blocos com uma linha em branco', () => {
  const encontrados = Array.from({length: 8}, (_, i) => ({
    favorecido: i + 1, nome: 'Cliente ' + (i + 1), cidade: 'Patos', uf: 'PB',
    telefonePrincipal: '8399999000' + i
  }));
  const respostas = admin.respostasClientes('Cliente', encontrados);
  assert.equal(respostas.length, 1);
  const texto = respostas[0];
  assert.equal((texto.match(/Cidade:/g) || []).length, 5);
  assert.equal((texto.match(/Telefone:/g) || []).length, 5);
  assert.match(texto, /1\. \*Cliente 1\*\nCidade: Patos\/PB\nTelefone: \(83\) 99999-0000\n\n2\. \*Cliente 2\*/);
  assert.match(texto, /5\. \*Cliente 5\*/);
  assert.doesNotMatch(texto, /Cliente 6|Cliente 7|Cliente 8|cód\./);
});

test('consulta telefone no cadastro somente para os primeiros cinco clientes sem número', async () => {
  const enviados = [];
  const codigosConsultados = [];
  const deps = {
    listarIntencoes: async () => intencoes,
    classificar: async () => ({ intencao: intencoes[0], argumento: 'Maria' }),
    listarClientes: async () => [
      ...Array.from({length: 6}, (_, i) => ({
        favorecido: i + 1, nome: 'Maria ' + (i + 1), cidade: 'Sousa', uf: 'PB'
      }))
    ],
    buscarCliente: async favorecido => {
      codigosConsultados.push(favorecido);
      return { favorecido, telefonePrincipal: '83999990000' };
    },
    enviar: async ({mensagem}) => enviados.push(mensagem)
  };
  const resultado = await admin.processarMensagem({
    telefone: '5583999792085', texto: 'Sistema, localize cliente Maria', permitido: true
  }, deps);
  assert.equal(resultado.reconhecido, true);
  assert.deepEqual(codigosConsultados.sort(), [1, 2, 3, 4, 5]);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0], /Telefone: \(83\) 99999-0000/);
  assert.doesNotMatch(enviados[0], /Maria 6/);
});


test('wizard numera clientes, guarda escolha e respeita etapas futuras inativas', async () => {
  const telefone = '5583988887777';
  const enviados = [];
  let chamadasIA = 0;
  const comVinculo = {...intencoes[0], proximas_intencoes:[2]};
  const futura = {id:2,chave:'consultar_pedidos',nome:'Consultar pedidos',
    descricao:'Próxima intenção ainda não implementada.',acao:'etapa_futura',ativo:false,
    frases:'mostrar pedidos'};
  const deps = {
    listarIntencoes:async()=>[comVinculo, futura],
    classificar:async frase=>{
      chamadasIA++;
      return frase.includes('localize')
        ? {intencao:comVinculo,argumento:'Maria'} : {intencao:null,argumento:''};
    },
    listarClientes:async()=>Array.from({length:6},(_,i)=>({
      favorecido:i+10,nome:'Maria '+(i+1),cidade:'Patos',uf:'PB',
      telefonePrincipal:'83999990000'
    })),
    enviar:async ({mensagem})=>enviados.push(mensagem)
  };
  const primeiro = await admin.processarMensagem({
    telefone,texto:'Sistema, localize cliente Maria',permitido:true
  },deps);
  assert.match(primeiro.resposta,/5\. \*Maria 5\*/);
  assert.doesNotMatch(primeiro.resposta,/6\. \*Maria 6\*/);
  assert.match(primeiro.resposta,/Responda com um número de 1 a 5/);
  const segundo = await admin.processarMensagem({telefone,texto:'quero o 3',permitido:true},deps);
  assert.equal(segundo.acao,'selecionar_cliente');
  assert.match(segundo.resposta,/Cliente selecionado: \*Maria 3\*/);
  assert.match(segundo.resposta,/nenhuma está ativa e implementada/);
  assert.equal(chamadasIA,1,'resposta numérica não chama o classificador');
  assert.equal(enviados.length,2);
  const cancelado = await admin.processarMensagem({telefone,texto:'cancelar',permitido:true},deps);
  assert.equal(cancelado.acao,'cancelar');
});

test('wizard valida número fora da lista e permite nova busca', async () => {
  const telefone = '5583988887766';
  const mensagens=[];
  const deps = {
    listarIntencoes:async()=>intencoes,
    classificar:async frase=>frase.startsWith('localize')
      ? {intencao:intencoes[0],argumento:'João'} : {intencao:null,argumento:''},
    listarClientes:async()=>[{favorecido:33,nome:'João da Silva',cidade:'Sousa',uf:'PB',
      telefonePrincipal:'83988887777'}],
    enviar:async({mensagem})=>mensagens.push(mensagem)
  };
  await admin.processarMensagem({telefone,texto:'localize cliente João',permitido:true},deps);
  const invalido = await admin.processarMensagem({telefone,texto:'5',permitido:true},deps);
  assert.match(invalido.resposta,/Opção inválida/);
  const selecionado = await admin.processarMensagem({telefone,texto:'1',permitido:true},deps);
  assert.match(selecionado.resposta,/João da Silva/);
  const recomecar = await admin.processarMensagem({telefone,texto:'localize cliente Maria',permitido:true},deps);
  assert.equal(recomecar.acao,'localizar_cliente');
  assert.match(recomecar.resposta,/Responda com um número/);
});


test('wizard consulta cinco últimos pedidos do cliente selecionado, por número ou frase', async () => {
  const telefone = '5583988776655';
  const enviados = []; const consultados = [];
  const origem = { ...intencoes[0], proximas_intencoes: [2] };
  const ultimos = { id:2, chave:'ultimos_pedidos_cliente', nome:'Localizar últimos pedidos',
    descricao:'Mostra os cinco pedidos mais recentes do cliente selecionado.',
    acao:'ultimos_pedidos_cliente', ativo:true, frases:'últimos pedidos\nconsultar pedidos' };
  const deps = {
    listarIntencoes:async()=>[origem,ultimos],
    classificar:async frase=>frase.startsWith('localize')
      ? {intencao:origem,argumento:'Maria'}
      : {intencao:ultimos,argumento:''},
    listarClientes:async()=>[{favorecido:77,nome:'Maria de Souza',cidade:'Sousa',uf:'PB',
      telefonePrincipal:'83999990000'}],
    listarPedidosPorCliente:async id=>{
      consultados.push(id);
      return {dados:[
        {numero:100,data:'2026-10-01',total:200},
        {numero:106,data:'2026-11-06',total:1500.5},
        {numero:105,data:'2026-11-05',total:55,cancelado:true},
        {numero:104,data:'2026-11-04',total:75},
        {numero:103,data:'2026-11-03',total:95},
        {numero:102,data:'2026-11-02',total:115}
      ]};
    },
    enviar:async({mensagem})=>enviados.push(mensagem)
  };
  await admin.processarMensagem({telefone,texto:'localize cliente Maria',permitido:true},deps);
  const selecionado = await admin.processarMensagem({telefone,texto:'1',permitido:true},deps);
  assert.match(selecionado.resposta,/1\. Localizar últimos pedidos/);
  const pedidos = await admin.processarMensagem({telefone,texto:'1',permitido:true},deps);
  assert.equal(pedidos.acao,'ultimos_pedidos_cliente');
  assert.deepEqual(consultados,[77]);
  assert.match(pedidos.resposta,/1\. \*Pedido 106\*\nData: 06\/11\/2026\nValor: R\$ 1\.500,50/);
  assert.match(pedidos.resposta,/Situação: Cancelado/);
  assert.doesNotMatch(pedidos.resposta,/Pedido 100/);
  assert.equal((pedidos.resposta.match(/\*Pedido/g)||[]).length,5);
  const porVoz = await admin.processarMensagem({
    telefone,texto:'Mostre os últimos pedidos desse cliente',permitido:true
  },deps);
  assert.equal(porVoz.acao,'ultimos_pedidos_cliente');
  assert.deepEqual(consultados,[77,77]);
  assert.equal(enviados.length,4);
});

test('não consulta pedidos sem cliente selecionado', async () => {
  const telefone='5583988776600';
  const ultimos = { id:2, chave:'ultimos_pedidos_cliente', nome:'Localizar últimos pedidos',
    descricao:'Consulta últimos pedidos do cliente selecionado.', acao:'ultimos_pedidos_cliente',
    ativo:true, frases:'últimos pedidos' };
  let consultou=false;
  const r = await admin.processarMensagem({
    telefone,texto:'últimos pedidos',permitido:true
  },{
    listarIntencoes:async()=>[intencoes[0],ultimos],
    classificar:async()=>({intencao:ultimos,argumento:''}),
    listarPedidosPorCliente:async()=>{consultou=true;return{dados:[]};},
    enviar:async()=>{}
  });
  assert.match(r.resposta,/Primeiro localize e selecione um cliente/);
  assert.equal(consultou,false);
});
