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
