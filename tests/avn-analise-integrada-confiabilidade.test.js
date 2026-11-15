'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../public/js/avn-analise-integrada.js'),'utf8');
function montar(info) {
 const body=source.replace("(()=>{'use strict';","'use strict';")
  .replace(/\}\)\(\);\s*$/,'')
  .replace(/iniciar\(\);\s*$/,'return {montarRelatorio};');
 return new Function(body)().montarRelatorio(info,{dias:[]},null).texto;
}
function base(){
 return {gerado_em:'2026-11-15T12:00:00Z',
 periodo:{inicio:'2026-10-17',fim:'2026-11-15',anterior_inicio:'2026-09-17',anterior_fim:'2026-10-16'},
 usuario:{nome:'Teste'},perfil_treinamento:null,metas_atuais:{},nutrientes:[],
 diario:[],receitas:[],versoes:[],agua:[],sono:[],medicoes:[],treinos:[],execucoes:[],atividades:[],exames:[],avisos:[]};
}
test('fases de sono não importadas não são estimadas como zero',()=>{
 const b=base();
 b.sono=[{id:1,inicio:'2026-11-13T00:00:00Z',fim:'2026-11-13T08:00:00Z',
 duracao_min:480,pontuacao:80,fase_tipo:'LIGHT',fase_inicio:'2026-11-13T00:00:00Z',fase_fim:'2026-11-13T03:00:00Z'}];
 const texto=montar(b);
 assert.match(texto,/profundo sem dado, REM sem dado, acordado sem dado/);
 assert.match(texto,/tempo real dormido sem dado/);
 assert.match(texto,/Tempo real dormido médio por sessão.*sem dado/);
});
test('estimativa de gordura não combina medidas separadas por horas',()=>{
 const b=base();
 b.medicoes=[
  {codigo:'peso',valor:85,data_medicao:'2026-11-13T08:00:00Z',origem:'manual'},
  {codigo:'gordura_corporal',valor:30,data_medicao:'2026-11-13T18:00:00Z',origem:'relogio'}
 ];
 const texto=montar(b);
 assert.match(texto,/cálculo omitido/);
 assert.doesNotMatch(texto,/25,5 kg, estimados/);
 b.medicoes[1].data_medicao='2026-11-13T08:05:00Z';
 assert.match(montar(b),/25,5 kg, estimados/);
});
test('não converte cargas em placas para quilos na progressão',()=>{
 const b=base();
 b.execucoes=[
  {sessao_id:'abc',item_id:'i1',realizado_em:'2026-11-13T15:00:00Z',plano_nome:'Teste',exercicio:'Remada',grupo_muscular:'Costas',numero_serie:1,repeticoes:10,carga_kg:null,carga_unidade:'placas',carga_placas:4},
  {sessao_id:'abc',item_id:'i2',realizado_em:'2026-11-13T15:00:00Z',plano_nome:'Teste',exercicio:'Remada',grupo_muscular:'Costas',numero_serie:2,repeticoes:10,carga_kg:null,carga_unidade:'placas',carga_placas:5}
 ];
 const texto=montar(b);
 assert.match(texto,/Progressão Remada: primeira carga 4 placas, última 5 placas/);
 assert.doesNotMatch(texto,/Progressão Remada: primeira carga 4 kg/);
});
