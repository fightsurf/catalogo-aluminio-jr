'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ler=p=>fs.readFileSync(path.join(root,p),'utf8');
const schema=ler('db/sql/20261115_avn_receitas_versionamento.sql');
const migrador=ler('src/services/avn/avn-migration.service.js');
const receitas=ler('src/routes/avn/avn-receitas.routes.js');
const nutricao=ler('src/routes/avn/avn-nutricao.routes.js');
const analise=ler('src/routes/avn/avn-analise-integrada.routes.js');
const frontend=ler('public/js/avn-analise-integrada.js');
const frontendReceitas=ler('public/js/avn-receitas.js');

test('SQL e rotina de migração preservam versões sem inventar o passado',()=>{
 assert.match(migrador,/20261115_avn_receitas_versionamento\.sql/);
 assert.match(schema,/CREATE TABLE IF NOT EXISTS public\.avn_receita_versoes/);
 assert.match(schema,/UNIQUE\(receita_id,numero\)/);
 assert.match(schema,/receita_versao_id BIGINT REFERENCES public\.avn_receita_versoes/);
 assert.match(schema,/WHERE NOT EXISTS\(SELECT 1 FROM public\.avn_receita_versoes/);
 assert.match(schema,/Versões de receitas são imutáveis/);
 assert.match(schema,/BEFORE INSERT OR UPDATE ON public\.avn_diario_alimentar/);
 assert.doesNotMatch(schema,/UPDATE public\.avn_diario_alimentar SET receita_versao_id/);
});
test('salvar nova composição cria versão e recalcula receitas que dela dependem',()=>{
 assert.doesNotThrow(()=>new Function('require','module',receitas));
 assert.match(receitas,/async function registrarVersao/);
 assert.match(receitas,/FROM public\.avn_receita_versoes WHERE receita_id=\$1 ORDER BY numero DESC LIMIT 1 FOR UPDATE/);
 assert.match(receitas,/const versao=await registrarVersao\(db,receita,data\.itens,c,data\.micros\)/);
 assert.match(receitas,/await registrarVersao\(db,rr\.rows\[0\]/);
 assert.match(receitas,/SELECT kcal_100g,proteinas_g_100g,carboidratos_g_100g,gorduras_g_100g,fibras_g_100g,micronutrientes_100g/);
 assert.match(receitas,/versoes:historico\.rows/);
 assert.match(frontendReceitas,/Histórico de versões/);
});
test('copiar diário conserva vínculo e a análise usa a versão salva',()=>{
 assert.match(nutricao,/receita_versao_id\)\s*VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7::jsonb,NULL,\$8\)/);
 assert.match(analise,/composicao_100g,receita_versao_id/);
 assert.match(analise,/consulta\.versoes/);
 assert.doesNotThrow(()=>new Function(frontend));
});
function montar(){
 const corpo=frontend.replace("(()=>{'use strict';","'use strict';")
  .replace(/\}\)\(\);\s*$/,'')
  .replace(/iniciar\(\);\s*$/,'return {montarRelatorio};');
 return new Function(corpo)().montarRelatorio;
}
test('mesmo ID e nutrientes podem pertencer a ingredientes históricos diferentes',()=>{
 const info={
  gerado_em:'2026-11-15T09:00:00Z',
  periodo:{inicio:'2026-10-17',fim:'2026-11-15',anterior_inicio:'2026-09-17',anterior_fim:'2026-10-16'},
  usuario:{nome:'Teste'},metas_atuais:{},nutrientes:[],
  diario:[
   {data:'2026-11-09',alimento_id:1,alimento_nome:'Escondidinho',quantidade_g:350,composicao_100g:{kcal:150},receita_versao_id:7},
   {data:'2026-11-10',alimento_id:1,alimento_nome:'Escondidinho',quantidade_g:350,composicao_100g:{kcal:150},receita_versao_id:8}
  ],
  receitas:[],
  versoes:[
   {id:7,receita_id:2,alimento_id:1,numero:1,nome:'Escondidinho',rendimento_g:350,ingredientes:[{nome_snapshot:'Coxão mole',quantidade_g:150}]},
   {id:8,receita_id:2,alimento_id:1,numero:2,nome:'Escondidinho',rendimento_g:350,ingredientes:[{nome_snapshot:'Patinho',quantidade_g:180}]}
  ],
  agua:[],sono:[],medicoes:[],treinos:[],execucoes:[],atividades:[],exames:[],avisos:[]
 };
 const rel=montar()(info,{dias:[]},null).texto;
 assert.match(rel,/composição registrada 1\/2/);
 assert.match(rel,/composição registrada 2\/2/);
 assert.match(rel,/Receita versão 1/);
 assert.match(rel,/Receita versão 2/);
 assert.match(rel,/Coxão mole: 150 g/);
 assert.match(rel,/Patinho: 180 g/);
 assert.doesNotMatch(rel,/Escondidinho: 700 g/);
});
