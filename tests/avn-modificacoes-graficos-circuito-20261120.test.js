'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ler=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('scripts de gráficos, treino e rotas continuam sintaticamente válidos',()=>{
 for(const file of [
  'public/js/avn-balanco-energetico.js','public/js/avn-circuito.js',
  'public/js/avn-treinos.js','src/routes/avn/avn-treinos.routes.js'
 ])assert.doesNotThrow(()=>new vm.Script(ler(file),{filename:file}));
});

test('balanço por ponto mostra a decomposição numérica correta',()=>{
 const js=ler('public/js/avn-balanco-energetico.js');
 const codigo=js.slice(js.indexOf('function calculoDetalhadoSaldo('),js.indexOf('function graficoDiario('));
 const fmt=(n,dec=0)=>Number(n).toLocaleString('pt-BR',{maximumFractionDigits:dec});
 const has=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
 const calculo=new Function('fmt','has',codigo+';return calculoDetalhadoSaldo')(fmt,has);
 const texto=calculo({ingestao:{valor:1900},tmb:{valor:1700},
  calorias_passos:{valor:320},calorias_ativas:{valor:161}});
 for(const s of ['Consumidas: 1.900','TMB: 1.700','Passos estimados: 320','Treinamento: 161','= -281 kcal'])
  assert.ok(texto.includes(s),s);
});

test('sono é exibido no gráfico em horas e minutos',()=>{
 const js=ler('public/js/avn-balanco-energetico.js');
 const codigo=js.slice(js.indexOf('function formatarDuracao('),js.indexOf('const formatarIndicador='));
 const formatar=new Function(codigo+';return formatarDuracao')();
 assert.equal(formatar(6.5),'06:30');
 assert.equal(formatar(7.23),'07:14');
 assert.equal(formatar(6.98),'06:59');
});

test('abas de nutrição e período do cruzamento são independentes',()=>{
 const html=ler('views/avn/indicador-graficos-corporais.html');
 const js=ler('public/js/avn-balanco-energetico.js');
 const keys=['ingestao','proteinas','carboidratos','gorduras'];
 for(const key of keys){
  for(const id of ['macro-tab-'+key,'macro-painel-'+key,'grafico-'+key])
   assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.doesNotMatch(html,/id="saldo"/);
 for(const period of [7,15,30,60,90,120])
  assert.match(html,new RegExp('<option value="'+period+'"(?: selected)?>'+period+' dias'));
 assert.match(js,/periodoComparacao\(\)/);
 assert.match(js,/if\(!escolhidas.length\)/);
 assert.doesNotMatch(js,/Marque pelo menos dois indicadores/);
});

test('registro do circuito usa caminho único de histórico e não recadastra plano todo',()=>{
 const client=ler('public/js/avn-circuito.js');
 const registrar=ler('public/js/avn-treinos.js');
 const backend=ler('src/routes/avn/avn-treinos.routes.js');
 assert.match(client,/Tempo de preparo inicial/);
 assert.match(client,/s\.phase === 'initial'/);
 assert.match(client,/modalidade:'circuito'/);
 assert.match(client,/avnCircuitoFinalizar/);
 assert.match(client,/\/dias\/['"]?\s*\+?encodeURIComponent\(s\.day\)/);
 assert.match(registrar,/data-montador-inserir/);
 assert.match(registrar,/method:'POST',body:JSON\.stringify\(\{usuario_id:Number\(state\.usuarioId\),exercicio_id:id,posicao\}\)/);
 assert.match(backend,/router\.post\('\/planos\/:id\/dias\/:dia\/exercicios'/);
 assert.match(backend,/req\.body\?\.modalidade==='circuito'/);
 assert.match(registrar,/Circuito cronometrado/);
});

test('gráfico de calorias mostra a meta em kcal, com faixa de ±5%',()=>{
 const html=ler('views/avn/indicador-graficos-corporais.html');
 const js=ler('public/js/avn-balanco-energetico.js');
 assert.match(html,/id="nota-ingestao"/);
 assert.match(html,/id="grafico-ingestao"[^>]*meta hachurada/);
 for(const fragment of ["const alvoKcal=metasAtuais?.kcal","const meta=chave==='ingestao'?metaCalorias:null",
  "meta*.95,meta,meta*1.05","hatch-ingestao","'Meta: '+fmt(meta,1)+' kcal'",
  "graficoDiario('ingestao',resultadoAtual.dias,selecionado)"])
  assert.ok(js.includes(fragment),fragment);
});
