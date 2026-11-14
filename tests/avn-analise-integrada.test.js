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
 assert.match(r.texto,/INSTRUÇÕES FINAIS PARA A INTELIGÊNCIA ARTIFICIAL/);
 assert.match(r.texto,/NÃO altere automaticamente/);
 assert.match(r.texto,/Gordura visceral: valor do Zepp é um ÍNDICE/);
 assert.equal(r.cobertura,1);
 assert.doesNotMatch(source,/openai\.com\/v1|generativelanguage\.googleapis\.com/);
});
