'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

// Testes offline: nenhum pedido real e nenhuma mensagem enviada pela Z-API.
const caminhoService = path.resolve(__dirname, '../src/services/whatsapp/whatsapp-comandos-formatos.service.js');
const originalLoad = Module._load;
let retornoFrete;
let responder;

try {
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === caminhoService) {
      if (request === '../logistica/logisticaService') {
        return { buscarTransportadorasPorNomeCidade: async () => retornoFrete };
      }
      if ([
        '../produto/produto.service',
        '../volume/volume.service',
        '../ofertas/ofertas.service'
      ].includes(request)) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  ({ responder } = require(caminhoService));
} finally {
  Module._load = originalLoad;
}

const destino = '5583999999999';
const urlFoto = 'https://pub-51cb4ace3dfb43a4ac45a4b7c399904d.r2.dev/comum/caixapanela.jpeg';

function simularZapi(falhaFoto = false) {
  const chamadas = [];
  const zapi = {
    async postZapi(endpoint, payload) {
      chamadas.push({ endpoint, payload });
      if (falhaFoto && endpoint === '/send-image') throw new Error('Erro simulado de envio');
      return { success: true };
    }
  };
  return { zapi, chamadas };
}

test('@frete: imagem ANTES da lista quando ha transportadoras', async () => {
  retornoFrete = {
    tipo: 'resultado',
    dados: [
      { nome: 'Transportadora A', telefone: '84999999999', cidade_nome: 'Mossoró', estado: 'RN' },
      { nome: 'Transportadora B', telefone: '84988888888', cidade_nome: 'Mossoró', estado: 'RN' }
    ]
  };
  const { zapi, chamadas } = simularZapi();
  await responder('@frete', 'Mossoró - RN', destino, zapi);
  assert.deepEqual(chamadas.map(c => c.endpoint), ['/send-image', '/send-text']);
  assert.equal(chamadas[0].payload.phone, destino);
  assert.equal(chamadas[0].payload.image, urlFoto);
  assert.equal(chamadas[0].payload.caption, 'Medidas da caixa do Alumínio JR');
  assert.equal(chamadas[0].payload.viewOnce, false);
  assert.equal(chamadas[1].payload.phone, destino);
  assert.match(chamadas[1].payload.message, /Frete para Mossoró - RN/);
  assert.match(chamadas[1].payload.message, /Transportadora A/);
  assert.match(chamadas[1].payload.message, /Transportadora B/);
});

test('@frete: cidade sem transportadora retorna SOMENTE texto', async () => {
  retornoFrete = { tipo: 'sem_frete', cidade: 'Cruz', estado: 'CE' };
  const { zapi, chamadas } = simularZapi();
  await responder('@frete', 'Cruz - CE', destino, zapi);
  assert.deepEqual(chamadas.map(c => c.endpoint), ['/send-text']);
  assert.match(chamadas[0].payload.message, /Não há frete disponível para essa cidade/);
});

test('@frete: sugestoes de cidades nao recebem foto', async () => {
  retornoFrete = { tipo: 'sugestao', cidades: [{ nome: 'Cruz', estado: 'CE' }] };
  const { zapi, chamadas } = simularZapi();
  await responder('@frete', 'Cru', destino, zapi);
  assert.deepEqual(chamadas.map(c => c.endpoint), ['/send-text']);
  assert.match(chamadas[0].payload.message, /Encontrei várias cidades parecidas/);
});

test('@frete: cidade inexistente nao recebe foto', async () => {
  retornoFrete = { tipo: 'vazio' };
  const { zapi, chamadas } = simularZapi();
  await responder('@frete', 'CidadeInexistente', destino, zapi);
  assert.deepEqual(chamadas.map(c => c.endpoint), ['/send-text']);
  assert.match(chamadas[0].payload.message, /Nenhuma cidade encontrada/);
});

test('@frete: resultado sem lista nao dispara foto', async () => {
  retornoFrete = { tipo: 'resultado', dados: [] };
  const { zapi, chamadas } = simularZapi();
  await responder('@frete', 'Vazia', destino, zapi);
  assert.deepEqual(chamadas.map(c => c.endpoint), ['/send-text']);
});

test('@frete: falha ao enviar imagem nao impede resposta com lista', async () => {
  retornoFrete = {
    tipo: 'resultado',
    dados: [{ nome: 'Transportadora A', telefone: '84999999999', cidade_nome: 'Mossoró', estado: 'RN' }]
  };
  const { zapi, chamadas } = simularZapi(true);
  const originalError = console.error;
  console.error = () => {};
  try {
    await responder('@frete', 'Mossoró - RN', destino, zapi);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(chamadas.map(c => c.endpoint), ['/send-image', '/send-text']);
});
