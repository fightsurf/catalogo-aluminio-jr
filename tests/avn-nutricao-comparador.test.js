'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const mod=require('../public/js/avn-nutricao-comparador.js');
const root=path.resolve(__dirname,'..');

test('planilha alinha 5 macros e todos os micronutrientes do catálogo na mesma ordem',()=>{
 const macros=[['kcal','Energia','kcal'],['proteinas_g','Proteínas','g'],['carboidratos_g','Carboidratos','g'],['gorduras_g','Gorduras','g'],['fibras_g','Fibras','g']];
 const micros=[['vitamina_c_mg','Vitamina C','mg','Vitaminas'],['ferro_mg','Ferro','mg','Minerais'],['colesterol_mg','Colesterol','mg','Outros']];
 const rows=mod.linhas(macros,micros);
 assert.deepEqual(rows.map(x=>x.grupo||x.codigo),['Macronutrientes','kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g','Vitaminas','vitamina_c_mg','Minerais','ferro_mg','Outros componentes','colesterol_mg']);
 assert.equal(rows.filter(x=>x.codigo).length,macros.length+micros.length);
});
test('desconhecido não vira zero e zero verdadeiro permanece zero',()=>{
 assert.deepEqual(mod.celula(null,'mg'),{texto:'—',desconhecido:true});
 assert.deepEqual(mod.celula(undefined,'g'),{texto:'—',desconhecido:true});
 assert.deepEqual(mod.celula('', 'µg'),{texto:'—',desconhecido:true});
 assert.deepEqual(mod.celula(0,'mg'),{texto:'0 mg',desconhecido:false});
 assert.deepEqual(mod.celula(0.75,'g'),{texto:'0,75 g',desconhecido:false});
});
test('HTML apresenta três pesquisas e uma única tabela com quatro colunas',()=>{
 const html=fs.readFileSync(path.join(root,'views/avn/nutricao-alimentos.html'),'utf8');
 for(const source of ['TACO','USDA','IA'])for(const prefix of ['usar','selecao'])assert.ok(html.includes('id="'+prefix+source+'"'));
 for(const id of ['resultadosTACO','resultadosUSDA','carregarIA','nutrientesComparacao'])assert.ok(html.includes('id="'+id+'"'));
 assert.equal((html.match(/id="nutrientesComparacao"/g)||[]).length,1);
 assert.ok(!html.includes('id="fonteIA"'), 'não há mais seletor de fonte única');
});
test('JS faz TACO e USDA em paralelo e a IA somente sob demanda',()=>{
 const js=fs.readFileSync(path.join(root,'public/js/avn-nutricao-comparador.js'),'utf8');
 assert.ok(js.includes("Promise.all([pesquisarFonte('taco',termo,r),pesquisarFonte('usda',termo,r)])"));
 assert.ok(js.includes("addEventListener('click',carregarIA)"));
 assert.ok(js.includes("source==='taco'?'/consulta-ia/taco/'"));
 assert.ok(js.includes('aplicar(d,{taco:'));
});

function formularioDeImportacaoParaTeste(){
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(root,'public/js/avn-nutricao.js'),'utf8');
 // Evita rede e DOM completo: executa as funcoes reais, sem iniciar a pagina.
 const modified=source.replace(/\ninit\(\);\s*\}\)\(\);\s*$/, '\nwindow.__testeImportacao={configurarIA,fillFood,state};\n})();\n');
 assert.notEqual(modified,source,'nao foi possivel isolar as funcoes de teste');
 const nodes=new Map();
 const field=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,reset(){},scrollIntoView(){}});
  return nodes.get(id);
 };
 let aplicar;
 const context={
  document:{body:{dataset:{nutricaoPagina:'alimentos'}},getElementById:field},
  window:{AVNComparadorAlimentos:{iniciar(options){aplicar=options.aplicar;}}},
  setTimeout(){return 1;},clearTimeout(){}
 };
 vm.runInNewContext(modified,context,{filename:'avn-nutricao.js'});
 const {configurarIA,fillFood}=context.window.__testeImportacao;
 configurarIA();
 assert.equal(typeof aplicar,'function');
 return {field,fillFood,aplicar,source};
}

test('importacao da IA preserva ID de alimento em edicao, evitando POST duplicado',()=>{
 const {field,fillFood,aplicar,source}=formularioDeImportacaoParaTeste();
 fillFood({id:42,nome:'Aveia em flocos',marca:'Marca atual',preparo:'cru',
  porcao_nome:'2 colheres',porcao_gramas:30,kcal_100g:390,
  proteinas_g_100g:15,carboidratos_g_100g:65,gorduras_g_100g:7,fibras_g_100g:9});
 aplicar({nome:'Aveia (fonte IA)',marca:'Marca IA',preparo:'outro',
  macros:{kcal:385,proteinas_g:14,carboidratos_g:61,gorduras_g:8,fibras_g:9},
  micros:{},fontes:[{url:'https://example.org/aveia'}]},'ia_pesquisa');
 assert.equal(field('alimentoId').value,42,'a importacao nao pode apagar o ID original');
 assert.equal(field('tituloAlimento').textContent,'Editar alimento');
 assert.equal(field('alimentoNome').value,'Aveia em flocos');
 assert.equal(field('alimentoMarca').value,'Marca atual');
 assert.equal(field('alimentoPreparo').value,'cru');
 assert.equal(field('porcaoNome').value,'2 colheres');
 assert.equal(field('porcaoGramas').value,30);
 assert.equal(field('alim_kcal').value,385);
 assert.equal(field('alim_proteinas_g').value,14);
 assert.equal(field('alim_carboidratos_g').value,61);
 assert.equal(field('alim_gorduras_g').value,8);
 // O envio do formulario deve atualizar /alimentos/42 via PUT.
 assert.ok(source.includes("id?'PUT':'POST'"));
});

test('importacao da IA em novo alimento continua sem ID e preenche o nome',()=>{
 const {field,fillFood,aplicar}=formularioDeImportacaoParaTeste();
 fillFood(null);
 aplicar({nome:'Alimento novo',marca:'Exemplo',preparo:'cozido',
  macros:{kcal:120,proteinas_g:5,carboidratos_g:20,gorduras_g:1,fibras_g:2},
  micros:{}},'ia_pesquisa');
 assert.equal(field('alimentoId').value,'');
 assert.equal(field('tituloAlimento').textContent,'Novo alimento');
 assert.equal(field('alimentoNome').value,'Alimento novo');
 assert.equal(field('alimentoMarca').value,'Exemplo');
 assert.equal(field('alim_kcal').value,120);
});
