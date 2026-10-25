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
