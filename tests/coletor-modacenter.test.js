'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extrairPagina, urlPermitida, modeloPagina2, extrairDadosIncorporados, coletarExcursoes } =
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

test('extrai todos os registros de payload Next.js Flight sem executar scripts', () => {
  const dados = [
    {id:'a',name:'Abdon Turismo',city:'Ilheus',state:'BA',
      address:'Moda Center - Vaga 33',route:['Ilhéus - BA','Itabuna - BA'],
      phones:[{phone:'(73) 99104-1424'},{phone:'(73) 99137-1325'}]},
    {id:'b',name:'Outra Turismo',city:'Natal',state:'RN',
      address:'Moda Center',route:['Natal - RN'],
      phones:[{phone:'(84) 99928-6541'}]}
  ];
  const flight='20:'+JSON.stringify({children:[{props:{excursions:dados}}]})+'\n';
  const html='<html><script>self.__next_f.push([1,'+JSON.stringify(flight)+'])</script></html>';
  const extraidos=extrairDadosIncorporados(html);
  assert.equal(extraidos.length,2);
  assert.equal(extraidos[0].nome,'Abdon Turismo');
  assert.equal(extraidos[0].origem,'Ilheus - BA');
  assert.equal(extraidos[0].telefones,'(73) 99104-1424 / (73) 99137-1325');
  assert.equal(extraidos[0].rota,'Ilhéus - BA / Itabuna - BA');
});
test('prioriza dados incorporados quando a lista virtual e completa', async () => {
  const dados = Array.from({length:12}, (_,i)=>({
    name:'Excursao '+(i+1), city:'Natal',state:'RN',address:'Moda Center',
    route:['Natal - RN'],phones:[{phone:'(84) 99928-6541'}]
  }));
  const flight='20:'+JSON.stringify({props:{excursions:dados}})+'\n';
  const html=pagina([card('Excursao 1','Natal - RN','(84) 99928-6541','Natal - RN')],12)
    .replace('</body>','<script>self.__next_f.push([1,'+JSON.stringify(flight)+'])</script></body>');
  const r=await coletarExcursoes(async()=>({
    ok:true,status:200,headers:{get:()=> 'text/html'},text:async()=>html
  }));
  assert.equal(r.rows.length,12);
  assert.equal(r.coleta_completa,true);
  assert.equal(r.metodo,'dados_incorporados_nextjs');
  assert.equal(r.paginas_virtuais,2);
});

test('mantem excursao sem telefone para revisao manual', () => {
  const dados=[{name:'Turismo sem contato',city:'Natal',state:'RN',address:'Moda Center',route:['Natal - RN'],phones:[]}];
  const flight='20:'+JSON.stringify({props:{excursions:dados}})+'\n';
  const html='<script>self.__next_f.push([1,'+JSON.stringify(flight)+'])</script>';
  const result=extrairDadosIncorporados(html);
  assert.equal(result.length,1);
  assert.equal(result[0].telefones,'');
  assert.equal(result[0].rota,'Natal - RN');
});
