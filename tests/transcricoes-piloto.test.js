'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const piloto = require('../src/services/whatsapp/transcricoes-piloto.service');

const antigas = {
  numeros: process.env.WHATSAPP_TRANSCRICAO_NUMEROS,
  dominio: process.env.WHATSAPP_TRANSCRICAO_DOMINIOS,
  chave: process.env.OPENAI_API_KEY,
  modelo: process.env.WHATSAPP_TRANSCRICAO_MODELO,
  fetch: global.fetch
};
test.after(() => {
  for (const [chave, variavel] of Object.entries({
    numeros:'WHATSAPP_TRANSCRICAO_NUMEROS', dominio:'WHATSAPP_TRANSCRICAO_DOMINIOS',
    chave:'OPENAI_API_KEY', modelo:'WHATSAPP_TRANSCRICAO_MODELO'
  })) {
    if (antigas[chave] === undefined) delete process.env[variavel];
    else process.env[variavel] = antigas[chave];
  }
  global.fetch = antigas.fetch;
});
function evento(id, telefone = '5583999991234') {
  return {
    payload: { audio: { audioUrl: 'https://storage.z-api.io/teste.ogg', mimeType: 'audio/ogg; codecs=opus' } },
    dados: { telefone, instancia: 'INSTANCIA_TESTE', messageId: id, tipo: 'audio', direcao: 'ENTRADA' }
  };
}
test('ignora número não autorizado e mensagens de saída', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999991234';
  assert.equal(piloto.receber(evento('N1', '5511999998888')), false);
  assert.equal(piloto.receber({ ...evento('N2'), dados: { ...evento('N2').dados, direcao: 'SAIDA' } }), false);
  assert.equal(piloto.receber({ ...evento('N3'), payload: { isGroup: true, audio: {} } }), false);
});
test('aceita áudio enviado para o próprio número conectado sem aceitar saída para terceiros', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999991234';
  const propria = evento('AUTO_1');
  propria.payload.fromMe = true;
  propria.payload.connectedPhone = '5583999991234';
  propria.payload.audio = {}; // sem link: não precisa baixar no teste
  propria.dados.direcao = 'SAIDA';
  piloto.observarWebhook({ ...propria.payload, phone: propria.dados.telefone });
  assert.equal(piloto.listar().ultimo_audio_autorizado.tipo, 'enviado_para_si');
  assert.equal(piloto.receber(propria), true);
  assert.equal(piloto.receber(propria), false);

  const terceiro = evento('AUTO_2');
  terceiro.payload.fromMe = true;
  terceiro.payload.connectedPhone = '5583988885555';
  terceiro.dados.direcao = 'SAIDA';
  assert.equal(piloto.receber(terceiro), false);

  const enviadoApi = evento('AUTO_3');
  enviadoApi.payload.fromMe = true;
  enviadoApi.payload.fromApi = true;
  enviadoApi.payload.connectedPhone = '5583999991234';
  enviadoApi.dados.direcao = 'SAIDA';
  assert.equal(piloto.receber(enviadoApi), false);
});

test('aceita envio para si sem connectedPhone, e mantém bloqueio quando o conectado diverge', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999991234';
  const proprio = evento('AUTO_SEM_CONNECTED');
  proprio.payload.phone = '5583999991234';
  proprio.payload.fromMe = true;
  proprio.payload.audio = {};
  proprio.dados.direcao = 'SAIDA';
  assert.equal(piloto.receber(proprio), true);
  assert.equal(piloto.receber(proprio), false);
  const errado = evento('AUTO_CONNECTED_DIFERENTE');
  errado.payload.fromMe = true;
  errado.payload.connectedPhone = '5511888888888';
  errado.dados.direcao = 'SAIDA';
  assert.equal(piloto.receber(errado), false);
});

test('diagnóstico registra metadados sem expor números, URLs ou conteúdos', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999991234';
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  piloto.observarWebhook({
    type: 'ReceivedCallback', instanceId: 'INSTANCIA_TESTE',
    phone: '5511888888888', messageId: 'ID_PRIVADO',
    fromMe: false, text: { message: 'mensagem confidencial' }
  });
  piloto.observarWebhook({
    type: 'ReceivedCallback', instanceId: 'INSTANCIA_TESTE',
    phone: '5583999991234', messageId: 'AUDIO_PRIVADO',
    fromMe: true, audio: { audioUrl: 'https://storage.z-api.io/segredo.ogg' }
  });
  const eventos = piloto.listar().ultimos_webhooks;
  assert.equal(eventos[0].possui_audio, true);
  assert.equal(eventos[0].numero_autorizado, true);
  assert.equal(eventos[0].conectado_informado, false);
  assert.equal(eventos[0].conectado_autorizado, false);
  assert.equal(eventos[0].instancia_confere, true);
  assert.equal(eventos[1].numero_autorizado, false);
  const texto = JSON.stringify(eventos);
  for (const segredo of ['ID_PRIVADO', 'AUDIO_PRIVADO', '5511888888888',
    'segredo.ogg', 'mensagem confidencial']) assert.equal(texto.includes(segredo), false);
});

test('confirma LID do próprio número autorizado antes de aceitar áudio', async () => {
  const tel = '5583999991234';
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = tel;
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  const proprio = evento('SELF_LID_VALIDO');
  proprio.payload.phone = '992233445566@lid';
  proprio.payload.instanceId = 'INSTANCIA_TESTE';
  proprio.payload.connectedPhone = tel;
  proprio.payload.fromMe = true;
  proprio.payload.audio = {}; // Simula arquivo sem link, sem chamadas reais à IA
  proprio.dados.telefone = proprio.payload.phone;
  proprio.dados.direcao = 'SAIDA';
  piloto.observarWebhook(proprio.payload);
  let consultas = 0;
  const confirmar = async telefone => {
    consultas++;
    assert.equal(telefone, tel);
    return { telefone, lid: '992233445566@lid', vinculado: true };
  };
  assert.equal(await piloto.receberVerificandoLid(proprio, confirmar), true);
  assert.equal(await piloto.receberVerificandoLid(proprio, confirmar), false);
  assert.equal(piloto.listar().ultimos_webhooks[0].verificacao_lid, 'confirmado');
  assert.equal(piloto.listar().ultimos_webhooks[0].numero_autorizado, true);
  assert.equal(piloto.listar().ultimos_webhooks[0].conectado_autorizado, true);
  assert.equal(piloto.listar().registros[0].telefone, tel);
  assert.equal(consultas, 2); // A deduplicação da transcrição continua ativa
});

test('não atribui LID de outro contato ao número conectado', async () => {
  const tel = '5583999991234';
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = tel;
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  const terceiro = evento('SELF_LID_TERCEIRO');
  terceiro.payload.phone = '112233445566@lid';
  terceiro.payload.connectedPhone = tel;
  terceiro.payload.instanceId = 'INSTANCIA_TESTE';
  terceiro.payload.fromMe = true;
  terceiro.payload.audio = {};
  terceiro.dados.telefone = terceiro.payload.phone;
  terceiro.dados.direcao = 'SAIDA';
  piloto.observarWebhook(terceiro.payload);
  assert.equal(await piloto.receberVerificandoLid(terceiro,
    async telefone => ({ telefone, lid:'99999999999@lid', vinculado:true })), false);
  assert.equal(piloto.listar().ultimos_webhooks[0].verificacao_lid, 'lid_nao_confirmado');
  assert.equal(piloto.listar().ultimos_webhooks[0].numero_autorizado, false);

  const semConta = evento('SELF_LID_SEM_CONTA');
  semConta.payload.phone = '112233445566@lid';
  semConta.payload.fromMe = true;
  semConta.payload.audio = {};
  semConta.dados.telefone = semConta.payload.phone;
  semConta.dados.direcao = 'SAIDA';
  let chamado = false;
  assert.equal(await piloto.receberVerificandoLid(semConta, async () => {
    chamado = true;
    return { telefone: tel, lid: semConta.payload.phone, vinculado:true };
  }), false);
  assert.equal(chamado, false);
});

test('diagnóstico permite registrar bloqueios do webhook sem dados pessoais', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999991234';
  const evt = { instanceId:'INSTANCIA_TESTE', messageId:'ID_INTERNO',
    phone:'111222333@lid', connectedPhone:'5583999991234',
    fromMe:true, audio:{ audioUrl:'https://storage.z-api.io/teste.ogg' } };
  piloto.observarWebhook(evt);
  piloto.marcarLid(evt,'evento_ignorado');
  const item = piloto.listar().ultimos_webhooks[0];
  assert.equal(item.verificacao_lid, 'evento_ignorado');
  assert.equal(item.conectado_autorizado, true);
  assert.equal(item.numero_autorizado, false);
  assert.equal(Object.hasOwn(item,'_id'),false);
  assert.equal(JSON.stringify(item).includes('111222333'),false);
});

test('falha segura quando Z-API não confirma LID', async () => {
  const tel = '5583999991234';
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = tel;
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  const entrada = evento('SELF_LID_OFFLINE');
  entrada.payload.phone = '111122223333@lid';
  entrada.payload.connectedPhone = tel;
  entrada.payload.instanceId = 'INSTANCIA_TESTE';
  entrada.payload.fromMe = true;
  entrada.payload.audio = {};
  entrada.dados.telefone = entrada.payload.phone;
  entrada.dados.direcao = 'SAIDA';
  piloto.observarWebhook(entrada.payload);
  assert.equal(await piloto.receberVerificandoLid(entrada, async () => { throw new Error('offline'); }), false);
  assert.equal(piloto.listar().ultimos_webhooks[0].verificacao_lid, 'consulta_falhou');
});

test('distingue telefone conectado de LID e exibe somente final e tamanho', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999792085';
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  assert.equal(piloto.podeReceber('5583999792085@lid'), false);
  assert.equal(piloto.podeReceber('+55 (83) 99979-2085'), true);
  piloto.observarWebhook({
    type: 'ReceivedCallback', instanceId:'INSTANCIA_TESTE',
    messageId:'MASCARADO_TESTE', phone:'1122334455@lid',
    connectedPhone:'5583999792085', fromMe:true, audio:{ audioUrl:'https://storage.z-api.io/audio.ogg' }
  });
  const a = piloto.listar().ultimos_webhooks[0];
  assert.equal(a.conectado_formato, 'telefone');
  assert.equal(a.conectado_digitos, 13);
  assert.equal(a.conectado_final, '2085');
  assert.equal(a.conectado_autorizado, true);
  assert.deepEqual(piloto.listar().numeros_permitidos_resumo, [{digitos:13,final:'2085'}]);
  piloto.observarWebhook({
    type:'ReceivedCallback', instanceId:'INSTANCIA_TESTE',
    messageId:'MASCARADO_2', phone:'1122334455@lid',
    connectedPhone:'558399792085', fromMe:true, audio:{ audioUrl:'https://storage.z-api.io/audio.ogg' }
  });
  const b = piloto.listar().ultimos_webhooks[0];
  assert.equal(b.conectado_formato, 'telefone');
  assert.equal(b.conectado_digitos, 12);
  assert.equal(b.conectado_final, '2085');
  assert.equal(b.conectado_autorizado, true);
  assert.equal(b.conectado_equivalencia_sem_nono, true);
  piloto.observarWebhook({
    type:'ReceivedCallback', instanceId:'INSTANCIA_TESTE',
    messageId:'MASCARADO_3', phone:'1122334455@lid',
    connectedPhone:'123456789123@lid', fromMe:true, audio:{ audioUrl:'https://storage.z-api.io/audio.ogg' }
  });
  const d = piloto.listar().ultimos_webhooks[0];
  assert.equal(d.conectado_formato, 'lid');
  assert.equal(d.conectado_autorizado, false);
  assert.equal(d.conectado_final, null);
  const diagnostico = JSON.stringify(piloto.listar().ultimos_webhooks);
  assert.equal(diagnostico.includes('5583999792085'), false);
  assert.equal(diagnostico.includes('MASCARADO_TESTE'), false);
  assert.equal(diagnostico.includes('storage.z-api.io'), false);
});

test('equivalência de nono dígito exige coincidência integral, não apenas final', () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999792085';
  assert.equal(piloto.podeReceber('558399792085'), true);
  assert.equal(piloto.podeReceber('558398792085'), false); // Mesmo final, DDD/miolo diferente.
  assert.equal(piloto.podeReceber('558399872085'), false);
  assert.equal(piloto.podeReceber('558399792085@lid'), false);
  assert.equal(piloto.podeReceber('5583999792085@s.whatsapp.net'), false);
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5511988872085';
  assert.equal(piloto.podeReceber('551188872085'), true); // Outro DDD, com nona posição 9.
  assert.equal(piloto.podeReceber('558388872085'), false);
});

test('LID da conversa consigo mesmo aceita variante brasileira somente após confirmação', async () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999792085';
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  const entrada = evento('LID_LEGADO_SEM_NONO', '777777777777@lid');
  entrada.payload = {
    type:'ReceivedCallback', phone: '777777777777@lid',
    connectedPhone: '558399792085', instanceId: 'INSTANCIA_TESTE',
    messageId:'LID_LEGADO_SEM_NONO', fromMe: true,
    audio: {} // Sem download, exige apenas autorização / identificação
  };
  entrada.dados.direcao = 'SAIDA';
  piloto.observarWebhook(entrada.payload);
  const consultas = [];
  const falsoPrimeiro = async numero => {
    consultas.push(numero);
    if (numero === '5583999792085') return {telefone:numero, lid:null,vinculado:false};
    return {telefone:numero, lid:'777777777777@lid',vinculado:true};
  };
  assert.equal(await piloto.receberVerificandoLid(entrada,falsoPrimeiro), true);
  assert.deepEqual(consultas,['5583999792085','558399792085']);
  assert.equal(piloto.listar().registros[0].telefone,'5583999792085');
  const estado = piloto.listar().ultimos_webhooks[0];
  assert.equal(estado.conectado_autorizado,true);
  assert.equal(estado.conectado_equivalencia_sem_nono,true);
  assert.equal(estado.verificacao_lid,'confirmado');
});

test('LID divergente não autoriza mesmo com telefone brasileiro legado correto', async () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999792085';
  process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
  const entrada = evento('LID_LEGADO_DIVERGENTE','123456789123@lid');
  entrada.payload = {
    phone:'123456789123@lid',connectedPhone:'558399792085',
    instanceId:'INSTANCIA_TESTE',messageId:'LID_LEGADO_DIVERGENTE',
    fromMe:true,audio:{}
  };
  entrada.dados.direcao='SAIDA';
  const consultas = [];
  assert.equal(await piloto.receberVerificandoLid(entrada,async numero=>{
    consultas.push(numero);
    return {telefone:numero,lid:'999888777666@lid',vinculado:true};
  }),false);
  assert.deepEqual(consultas,['5583999792085','558399792085']);
  assert.equal(piloto.listar().registros.some(x=>x.id.endsWith('LID_LEGADO_DIVERGENTE')),false);
  entrada.payload.connectedPhone='558398792085';
  entrada.payload.messageId='LID_LEGADO_OUTRA_CONTA';
  entrada.dados.messageId='LID_LEGADO_OUTRA_CONTA';
  let chamada=false;
  assert.equal(await piloto.receberVerificandoLid(entrada,async()=>{chamada=true;return null;}),false);
  assert.equal(chamada,false);
});

test('mídia no Google Cloud Storage é aceita e diagnóstico mostra só domínio', () => {
  const anterior = process.env.WHATSAPP_TRANSCRICAO_DOMINIOS;
  try {
    delete process.env.WHATSAPP_TRANSCRICAO_DOMINIOS;
    const url = 'https://storage.googleapis.com/testes/audio.ogg?assinatura=SENSIVEL';
    assert.equal(piloto.urlSegura(url), url);
    assert.throws(() => piloto.urlSegura('https://storage.googleapis.com.malicioso.net/audio.ogg'));
    assert.throws(() => piloto.urlSegura('http://storage.googleapis.com/audio.ogg'));
    process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999792085';
    process.env.ZAPI_WEBHOOK_INSTANCE_ID = 'INSTANCIA_TESTE';
    piloto.observarWebhook({
      type:'ReceivedCallback',instanceId:'INSTANCIA_TESTE',messageId:'HOST_GCS',
      fromMe:true,phone:'113355779900@lid',connectedPhone:'558399792085',
      audio:{ audioUrl:url }
    });
    const evento = piloto.listar().ultimos_webhooks[0];
    assert.equal(evento.dominio_midia, 'storage.googleapis.com');
    assert.equal(evento.dominio_midia_na_lista, true);
    assert.equal(JSON.stringify(evento).includes('assinatura=SENSIVEL'), false);
    piloto.observarWebhook({
      type:'ReceivedCallback',instanceId:'INSTANCIA_TESTE',messageId:'HOST_NOVO',
      fromMe:true,phone:'113355779900@lid',connectedPhone:'558399792085',
      audio:{audioUrl:'https://outro.exemplo.org/segredo.ogg?token=nao-mostrar'}
    });
    const novo = piloto.listar().ultimos_webhooks[0];
    assert.equal(novo.dominio_midia, 'outro.exemplo.org');
    assert.equal(novo.dominio_midia_na_lista, false);
    assert.equal(JSON.stringify(novo).includes('segredo.ogg'), false);
  } finally {
    if (anterior === undefined) delete process.env.WHATSAPP_TRANSCRICAO_DOMINIOS;
    else process.env.WHATSAPP_TRANSCRICAO_DOMINIOS = anterior;
  }
});

test('aceita apenas links HTTPS de domínios autorizados', () => {
  process.env.WHATSAPP_TRANSCRICAO_DOMINIOS = 'z-api.io';
  assert.throws(() => piloto.urlSegura('http://storage.z-api.io/a.ogg'));
  assert.throws(() => piloto.urlSegura('https://127.0.0.1/a.ogg'));
  assert.throws(() => piloto.urlSegura('https://outro.example.com/a.ogg'));
  assert.equal(piloto.urlSegura('https://storage.z-api.io/a.ogg'), 'https://storage.z-api.io/a.ogg');
});
test('baixa e transcreve uma vez, sem enviar WhatsApp', async () => {
  process.env.WHATSAPP_TRANSCRICAO_NUMEROS = '5583999991234';
  process.env.WHATSAPP_TRANSCRICAO_DOMINIOS = 'z-api.io';
  process.env.OPENAI_API_KEY = 'CHAVE_DE_TESTE';
  let downloads = 0, chamadasIA = 0;
  global.fetch = async (url, opcoes) => {
    if (String(url).includes('storage.z-api.io')) {
      downloads++;
      return new Response(Buffer.from('audio de teste'), { status: 200, headers: { 'Content-Length':'14' } });
    }
    if (String(url) === 'https://api.openai.com/v1/audio/transcriptions') {
      chamadasIA++;
      assert.equal(opcoes.method, 'POST');
      assert.equal(opcoes.body.get('model'), 'gpt-transcribe');
      assert.equal(opcoes.body.get('file').name, 'whatsapp.ogg');
      return new Response(JSON.stringify({ text:'Quanto vendemos hoje?' }), {
        status: 200, headers:{ 'Content-Type':'application/json' }
      });
    }
    throw new Error('URL inesperada');
  };
  const entrada = evento('TRANSCRICAO_TESTE');
  assert.equal(piloto.receber(entrada), true);
  assert.equal(piloto.receber(entrada), false);
  for (let i = 0; i < 50; i++) {
    const item = piloto.listar().registros.find(r => r.id.endsWith(':TRANSCRICAO_TESTE'));
    if (item?.status === 'concluida' || item?.status === 'erro') break;
    await new Promise(ok => setTimeout(ok, 10));
  }
  const r = piloto.listar().registros.find(x => x.id.endsWith(':TRANSCRICAO_TESTE'));
  assert.equal(r.status, 'concluida', r.erro);
  assert.equal(r.texto, 'Quanto vendemos hoje?');
  assert.equal(downloads, 1);
  assert.equal(chamadasIA, 1);
});
