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
