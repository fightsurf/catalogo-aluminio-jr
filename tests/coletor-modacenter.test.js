'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairPagina, urlPermitida, modeloPagina2, coletarExcursoes } =
  require('../src/services/logistica/coletorModaCenter.service');

function card(nome, origem, telefone, rota) {
  return '<article class="excursao"><h3>' + nome + '</h3>' +
    '<p>Origem: ' + origem + '</p><p>Destino: Moda Center - Vaga 33 - Setor Laranja</p>' +
    '<span>' + telefone + '</span><button>Conferir rota</button>' +
    '<div class="rota"><h4>Conferir rota</h4><p>' + rota + '</p><div>Compartilhar</div></div>' +
    '</article>';
}

function pagina(lista, total = 3) {
  return '<!doctype html><html><body><h1>Excursões e transportadoras</h1>' +
    '<p>Encontramos ' + total + ' resultados</p>' +
    '<section class="listagem">' + lista.join('') + '</section>' +
    '<nav><a href="?page=2">2</a></nav></body></html>';
}

test('extrai campos e rota sem inserir dados falsos', () => {
  const html = pagina([
    card('Abdon Turismo', 'Ilheus - BA', '(73) 99104-1424',
      'Ilhéus - BA / Itabuna - BA / Canavieiras - BA')
  ], 1);
  const r = extrairPagina(html);
  assert.equal(r.total, 1);
  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].nome, 'Abdon Turismo');
  assert.equal(r.registros[0].origem, 'Ilheus - BA');
  assert.equal(r.registros[0].destino, 'Moda Center - Vaga 33 - Setor Laranja');
  assert.equal(r.registros[0].telefones, '(73) 99104-1424');
  assert.match(r.registros[0].rota, /Itabuna - BA/);
});
test('paginacao extraida e dominio restrito', () => {
  const html = pagina([card('Empresa 1', 'Natal - RN', '(84) 99998-1000', 'Natal - RN')], 11);
  assert.equal(new URL(modeloPagina2(html)).searchParams.get('page'), '2');
  assert.equal(urlPermitida('https://omodacenter.com.br/c/excursoes?page=2'), true);
  assert.equal(urlPermitida('http://omodacenter.com.br/c/excursoes'), false);
  assert.equal(urlPermitida('https://evil.example/c/excursoes'), false);
  assert.equal(urlPermitida('https://omodacenter.com.br/admin'), false);
});
test('coleta duas paginas e identifica total sem duplicacao', async () => {
  const primeira = pagina([
    card('Turismo A', 'Ilhéus - BA', '(73) 99104-1424', 'Ilhéus - BA'),
    card('Turismo B', 'Natal - RN', '(84) 99928-6541', 'Natal - RN')
  ]);
  const segunda = pagina([
    card('Turismo C', 'João Pessoa - PB', '(83) 98660-7996', 'João Pessoa - PB')
  ]);
  const chamadas = [];
  const resposta = async url => {
    chamadas.push(url);
    return {
      ok: true, status: 200,
      headers: { get: nome => nome === 'content-type' ? 'text/html' : null },
      text: async () => new URL(url).searchParams.get('page') === '2' ? segunda : primeira
    };
  };
  const resultado = await coletarExcursoes(resposta);
  assert.equal(resultado.coleta_completa, true);
  assert.equal(resultado.total_informado, 3);
  assert.deepEqual(resultado.paginas_visitadas, [1, 2]);
  assert.equal(resultado.rows.length, 3);
  assert.equal(chamadas.length, 2);
});
