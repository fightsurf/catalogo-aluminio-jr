'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../public/js/avn-analise-integrada.js'),'utf8');
const route=fs.readFileSync(path.resolve(__dirname,'../src/routes/avn/avn-analise-integrada.routes.js'),'utf8');
const sistema=fs.readFileSync(path.resolve(__dirname,'../src/routes/avn/avn-sistema.routes.js'),'utf8');
function exportsDeRelatorio(){
 const body=source.replace("(()=>{'use strict';","'use strict';")
  .replace(/\}\)\(\);\s*$/,'')
  .replace(/iniciar\(\);\s*$/,'return {montarRelatorio, extrairTotal, diasDoPeriodo};');
 return new Function(body)();
}
test('frontend, backend e montagem das rotas são sintaticamente válidos',()=>{
 assert.doesNotThrow(()=>new Function(source));
 assert.doesNotThrow(()=>new Function('require','module',route));
 assert.match(sistema,/router\.use\('\/api\/analise-integrada', requireAuth, avnAnaliseRoutes\)/);
 assert.match(sistema,/router\.get\('\/analise-integrada', requireAuth/);
});
test('somente o Diário real entra no cálculo de alimentos e micronutrientes',()=>{
 assert.match(route,/FROM public\.avn_diario_alimentar/);
 assert.doesNotMatch(route,/FROM public\.avn_dieta_itens/);
 const {extrairTotal}=exportsDeRelatorio();
 const itens=[{quantidade_g:100,composicao_100g:{kcal:150,micros:{magnesio_mg:20}}},
  {quantidade_g:50,composicao_100g:{kcal:200,micros:{}}}];
 assert.equal(extrairTotal(itens,'kcal').valor,250);
 const m=extrairTotal(itens,'magnesio_mg',true);
 assert.equal(m.valor,null);
 assert.equal(m.conhecido,20);
 assert.equal(m.ausentes,1);
 assert.equal(extrairTotal([],'kcal').valor,null);
});
test('o relatório inclui 30 dias, receitas proporcionais e instruções finais sem chamar IA',()=>{
 const {montarRelatorio,diasDoPeriodo}=exportsDeRelatorio();
 const data={gerado_em:'2026-11-14T09:00:00Z',
  periodo:{inicio:'2026-10-16',fim:'2026-11-14',anterior_inicio:'2026-09-16',anterior_fim:'2026-10-15'},
  usuario:{nome:'Pessoa teste'},perfil_treinamento:null,metas_atuais:{},nutrientes:[],
  diario:[{data:'2026-11-13',alimento_id:1,alimento_nome:'Torta',quantidade_g:200,refeicao:'almoco',composicao_100g:{kcal:150}},
   {data:'2026-11-13',alimento_id:1,alimento_nome:'Torta',quantidade_g:100,refeicao:'jantar',composicao_100g:{kcal:150}}],
  receitas:[{receita_id:3,alimento_id:1,nome:'Torta',rendimento_g:600,ingrediente_id:5,ingrediente_alimento_id:2,ingrediente_nome:'Frango',ingrediente_quantidade_g:300}],
  agua:[],sono:[],medicoes:[],treinos:[],atividades:[],exames:[],avisos:[]};
 const r=montarRelatorio(data,{dias:[]},null);
 assert.equal(diasDoPeriodo(data.periodo.inicio,data.periodo.fim).length,30);
 assert.match(r.texto,/Torta: 300 g \(0,3 kg\)/);
 assert.match(r.texto,/Frango: 150 g/);
 assert.match(r.texto,/13\/11\/2026/);
 assert.doesNotMatch(r.texto,/INSTRUÇÕES FINAIS PARA A INTELIGÊNCIA ARTIFICIAL/);
 assert.match(r.instrucoes,/INSTRUÇÕES FIXAS PARA INTELIGÊNCIA ARTIFICIAL/);
 assert.match(r.instrucoes,/Não modifique registros ou metas do AVN/);
 assert.match(r.texto,/Gordura visceral: valor do Zepp é um ÍNDICE/);
 assert.equal(r.cobertura,1);
 assert.doesNotMatch(source,/openai\.com\/v1|generativelanguage\.googleapis\.com/);
});

test('o relatório usa as duas listas do histórico recente e apenas execuções finalizadas',()=>{
 assert.match(route,/FROM public\.avn_treino_execucoes x/);
 assert.match(route,/x\.status='finalizada'/);
 assert.match(route,/SERIE_CONCLUIDA/);
 const {montarRelatorio}=exportsDeRelatorio();
 const data={gerado_em:'2026-11-14T09:00:00Z',
  periodo:{inicio:'2026-10-16',fim:'2026-11-14',anterior_inicio:'2026-09-16',anterior_fim:'2026-10-15'},
  usuario:{nome:'Teste'},perfil_treinamento:null,metas_atuais:{},nutrientes:[],
  diario:[],receitas:[],agua:[],sono:[],medicoes:[],atividades:[],exames:[],avisos:[],
  treinos:[{sessao_id:11,realizado_em:'2026-11-12T12:00:00Z',plano_nome:'Manual',
   item_id:2,exercicio:'Leg press',grupo_muscular:'Pernas',series_realizadas:3,repeticoes_realizadas:'10',carga_kg:80}],
  execucoes:[
   {sessao_id:'abc',realizado_em:'2026-11-13T12:00:00Z',plano_nome:'Android',item_id:'a1',
    exercicio:'Supino',grupo_muscular:'Peito',numero_serie:1,repeticoes:10,carga_kg:40},
   {sessao_id:'abc',realizado_em:'2026-11-13T12:00:00Z',plano_nome:'Android',item_id:'a2',
    exercicio:'Supino',grupo_muscular:'Peito',numero_serie:2,repeticoes:9,carga_kg:42}
  ]};
 const r=montarRelatorio(data,{dias:[]},null);
 assert.equal(r.treinos,2);
 assert.match(r.texto,/Sessões realizadas: 2 nos últimos 30 dias/);
 assert.match(r.texto,/Peito 2/);
 assert.match(r.texto,/registro manual Web/);
 assert.match(r.texto,/execução finalizada Web\/Android/);
 assert.match(r.instrucoes,/QUADRO DE ALERTAS/);
 assert.doesNotMatch(r.texto,/INSTRUÇÕES FIXAS PARA INTELIGÊNCIA ARTIFICIAL/);
});
test('painéis independentes com botão de copiar tudo',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../views/avn/analise-integrada.html'),'utf8');
 assert.match(html,/id="relatorio"/);
 assert.match(html,/id="instrucoes"/);
 assert.match(html,/id="copiar"/);
 assert.match(html,/id="copiar-dados"/);
 assert.match(html,/id="copiar-instrucoes"/);
});

test('dia em andamento fica nos detalhes mas fora das medias e do saldo acumulado',()=>{
 const {montarRelatorio}=exportsDeRelatorio();
 const info={gerado_em:'2026-11-14T19:00:00Z',
  periodo:{inicio:'2026-10-16',fim:'2026-11-14',anterior_inicio:'2026-09-16',anterior_fim:'2026-10-15'},
  usuario:{nome:'Teste'},perfil_treinamento:null,metas_atuais:{},nutrientes:[],receitas:[],
  diario:[
   {data:'2026-11-13',alimento_id:1,alimento_nome:'Alimento',quantidade_g:100,composicao_100g:{kcal:1000}},
   {data:'2026-11-14',alimento_id:1,alimento_nome:'Alimento',quantidade_g:100,composicao_100g:{kcal:100}}
  ],
  agua:[{data:'2026-11-13',quantidade_ml:2000},{data:'2026-11-14',quantidade_ml:500}],
  sono:[],medicoes:[],treinos:[],execucoes:[],atividades:[],exames:[],avisos:[]};
 const saldo={dias:[
  {data:'2026-11-13',saldo:{saldo_kcal:-500}},
  {data:'2026-11-14',saldo:{saldo_kcal:1000}}
 ]};
 const parcial=montarRelatorio(info,saldo,null);
 assert.equal(parcial.diaParcial,'2026-11-14');
 assert.ok(parcial.texto.includes('Calorias: média 1.000 kcal/dia; soma dos dias válidos: 1.000 kcal; cobertura 1/29 dias'));
 assert.ok(parcial.texto.includes('Média atual: média 2.000 ml/dia; soma dos dias válidos: 2.000 ml; cobertura 1/29 dias'));
 assert.ok(parcial.texto.includes('Período atual: soma dos 1 dias calculáveis -500 kcal; média -500 kcal/dia'));
 assert.ok(parcial.texto.includes('14/11/2026 [DIA PARCIAL]'));
 assert.ok(parcial.texto.includes('PROVISÓRIO; fora da soma e da média'));
 assert.equal(parcial.cobertura,2);
 const historico=montarRelatorio({...info,gerado_em:'2026-11-15T19:00:00Z'},saldo,null);
 assert.equal(historico.diaParcial,null);
 assert.ok(historico.texto.includes('Calorias: média 550 kcal/dia; soma dos dias válidos: 1.100 kcal; cobertura 2/30 dias'));
 assert.ok(historico.texto.includes('Período atual: soma dos 2 dias calculáveis 500 kcal; média 250 kcal/dia'));
});

test('acumulado separa versões históricas sem aplicar ingredientes da receita atual',()=>{
 const {montarRelatorio}=exportsDeRelatorio();
 const info={gerado_em:'2026-11-15T10:00:00Z',
  periodo:{inicio:'2026-10-17',fim:'2026-11-15',anterior_inicio:'2026-09-17',anterior_fim:'2026-10-16'},
  usuario:{nome:'Teste'},perfil_treinamento:null,metas_atuais:{},nutrientes:[],
  diario:[
   {data:'2026-11-09',alimento_id:1,alimento_nome:'Escondidinho coxão mole',quantidade_g:350,composicao_100g:{kcal:200,proteinas_g:17}},
   {data:'2026-11-10',alimento_id:1,alimento_nome:'Escondidinho patinho',quantidade_g:350,composicao_100g:{kcal:180,proteinas_g:24}},
   {data:'2026-11-11',alimento_id:1,alimento_nome:'Escondidinho patinho',quantidade_g:350,composicao_100g:{kcal:180,proteinas_g:24}}
  ],
  receitas:[{receita_id:3,alimento_id:1,nome:'Escondidinho patinho',rendimento_g:350,ingrediente_id:5,ingrediente_alimento_id:2,ingrediente_nome:'Patinho atual',ingrediente_quantidade_g:200}],
  agua:[],sono:[],medicoes:[],treinos:[],execucoes:[],atividades:[],exames:[],avisos:[]};
 const rel=montarRelatorio(info,{dias:[]},null).texto;
 assert.match(rel,/Escondidinho coxão mole: 350 g/);
 assert.match(rel,/Escondidinho patinho: 700 g/);
 assert.doesNotMatch(rel,/Escondidinho coxão mole: 1\.050 g/);
 assert.doesNotMatch(rel,/Patinho atual: 600 g/);
 assert.match(rel,/Ingredientes históricos indisponíveis para esta versão/);
 const mesmaComNomeRepetido={...info,diario:info.diario.map(i=>({...i,alimento_nome:'Escondidinho'}))};
 const rel2=montarRelatorio(mesmaComNomeRepetido,{dias:[]},null).texto;
 assert.match(rel2,/Escondidinho \[composição registrada 1\/2\]: 350 g/);
 assert.match(rel2,/Escondidinho \[composição registrada 2\/2\]: 700 g/);
});
