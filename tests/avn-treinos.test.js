const test=require('node:test');
const assert=require('node:assert/strict');
const v=require('../src/services/avn/avn-treinos-validacao');

test('aceita URLs HTTPS públicas e rejeita URLs inseguras',()=>{
 assert.equal(v.midiaUrl('https://example.org/animacao.gif'),'https://example.org/animacao.gif');
 for(const u of ['http://example.org/x.gif','javascript:alert(1)','data:image/svg+xml,foo','https://user:pass@example.com/x'])
  assert.throws(()=>v.midiaUrl(u));
 assert.equal(v.midiaUrl(''),null);
});
test('valida semana, dias sem repetição e itens ordenados',()=>{
 const x=v.plano({usuario_id:'7',nome:'Treino',dias:[{dia_semana:0,exercicios:[{exercicio_id:2,series:4,repeticoes:'8-12',descanso_seg:90,carga_kg:35},{exercicio_id:4,series:3,repeticoes:'10',descanso_seg:60,carga_kg:''}]}]});
 assert.equal(x.dias[0].itens[1].posicao,1);assert.equal(x.dias[0].itens[1].carga_kg,null);
 assert.throws(()=>v.plano({usuario_id:7,nome:'Duplicado',dias:[{dia_semana:0,exercicios:[]},{dia_semana:0,exercicios:[]}]}));
});
test('rejeita carga, séries e descansos fora dos limites',()=>{
 for(const value of [-1,2001,'nan'])assert.throws(()=>v.carga(value));
 assert.throws(()=>v.plano({usuario_id:1,nome:'A',dias:[{dia_semana:1,exercicios:[{exercicio_id:1,series:40,repeticoes:'10',descanso_seg:60}]}]}));
 assert.throws(()=>v.plano({usuario_id:1,nome:'A',dias:[{dia_semana:1,exercicios:[{exercicio_id:1,series:3,repeticoes:'10',descanso_seg:3800}]}]}));
});
test('registra só sessões com IDs válidos',()=>{
 const s=v.sessao({usuario_id:2,plano_id:3,dia_semana:6,realizados:[{exercicio_id:4,series_realizadas:0,repeticoes_realizadas:'0',carga_kg:0}]});
 assert.equal(s.realizados[0].posicao,0);
 assert.throws(()=>v.sessao({usuario_id:0,plano_id:3,dia_semana:6,realizados:[]}));
});

test('aceita imagem local instalada no AVN e bloqueia caminhos arbitrários',()=>{
 assert.equal(v.midiaUrl('/avn/sistema/midias/bench-press/frame-1.svg'),'/avn/sistema/midias/bench-press/frame-1.svg');
 for(const u of ['/avn/sistema/midias/../../segredo','/avn/sistema/midias/bench-press/arquivo.js','/avn/sistema/midias/bench-press/frame-9.svg'])assert.throws(()=>v.midiaUrl(u));
});

test('placas são unidades independentes de quilogramas',()=>{
 const x=v.plano({usuario_id:2,nome:'Teste',dias:[{dia_semana:0,exercicios:[{exercicio_id:10,series:4,repeticoes:'12',descanso_seg:60,carga_unidade:'placas',carga_placas:5}]}]});
 assert.equal(x.dias[0].itens[0].carga_kg,null);assert.equal(x.dias[0].itens[0].carga_placas,5);
 const s=v.sessao({usuario_id:2,plano_id:3,dia_semana:0,realizados:[{exercicio_id:10,series_realizadas:4,repeticoes_realizadas:'12',carga_unidade:'placas',carga_placas:6}]});
 assert.equal(s.realizados[0].carga_placas,6);
 for(const placas of [-1,201,2.5,'abc'])assert.throws(()=>v.plano({usuario_id:2,nome:'A',dias:[{dia_semana:0,exercicios:[{exercicio_id:10,series:3,repeticoes:'10',descanso_seg:60,carga_unidade:'placas',carga_placas:placas}]}]}));
});
