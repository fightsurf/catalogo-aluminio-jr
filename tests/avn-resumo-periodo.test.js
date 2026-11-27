'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ler=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function carregar(document={}){
 const window={};
 new Function('window','document',ler('public/js/avn-resumo-periodo.js'))(window,document);
 return window.AVNResumoPeriodo;
}
test('sete dias inclusivos, fuso de Brasília e mudança de mês',()=>{
 const f=carregar();
 assert.deepEqual(f.periodo(7,'2026-11-27'),{inicio:'2026-11-21',fim:'2026-11-27'});
 assert.deepEqual(f.periodo(30,'2026-03-01'),{inicio:'2026-01-31',fim:'2026-03-01'});
 assert.equal(f.dia('2026-11-28T01:30:00Z'),'2026-11-27');
});
test('diferença final menos inicial, com unidades reais',()=>{
 const f=carregar(),p=f.periodo(7,'2026-11-27');
 const delta=(a,b)=>f.extremos([{data:p.inicio,value:a},{data:p.fim,value:b}],p.inicio,p.fim).variacao;
 assert.equal(f.formatar(delta(83,81),'kg',true),'−2 kg');
 assert.equal(f.formatar(delta(28,27),'%',true),'−1 p.p.');
 assert.equal(f.formatar(delta(3000,7000),'passos',true),'+4.000 passos');
 assert.equal(f.formatar(delta(6,8.5),'h',true),'+2h 30min');
 assert.equal(f.formatar(delta(8,7.5),'h',true),'−0h 30min');
 assert.equal(delta(0,0),0);
 assert.equal(delta(null,81),null);
 assert.equal(f.extremos([{data:p.fim,value:81}],p.inicio,p.fim).variacao,null);
});
test('usa a medição mais recente de cada dia, sem substituir datas ausentes',()=>{
 const f=carregar(),p=f.periodo(7,'2026-11-27');
 const rows=[{date:'2026-11-21T18:00:00-03:00',value:82},{date:'2026-11-21T12:00:00-03:00',value:83},{date:'2026-11-27T14:00:00-03:00',value:81}];
 assert.equal(f.extremos(rows,p.inicio,p.fim).variacao,-1);
 assert.equal(f.extremos([{data:'2026-11-22',value:83},rows[2]],p.inicio,p.fim).variacao,null);
});
test('modal mostra cada indicador e atualiza ao mudar a seleção',()=>{
 const document={byId:{},getElementById(id){return this.byId[id]},createElement(tag){return{tag,children:[],style:{},hidden:false,append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},setAttribute(k,v){this[k]=v}}}};
 const f=carregar(document),p=f.periodo(7,'2026-11-27');
 const area={id:'compare-chart',insertAdjacentElement(pos,el){assert.equal(pos,'afterend');document.byId[el.id]=el}};
 const serie=(nome,unidade,a,b)=>({nome,unidade,rows:[{data:p.inicio,value:a},{data:p.fim,value:b}]});
 const series=[serie('Peso','kg',83,81),serie('Gordura corporal','%',28,27),serie('Passos','passos',3000,7000)];
 f.desenhar(area,series,p);
 const panel=document.byId['compare-chart-resumo-periodo'];
 assert.deepEqual(panel.children.map(l=>l.children[1].children[2].children[1].textContent),['−2 kg','−1 p.p.','+4.000 passos']);
 f.desenhar(area,series.slice(0,2),p);assert.equal(panel.children.length,2);
 f.limpar(area);assert.equal(panel.hidden,true);assert.equal(panel.children.length,0);
});
test('o resumo é carregado antes dos scripts e integrado às três abas e ao modal',()=>{
 const html=ler('views/avn/indicador-graficos-corporais.html');
 const corporal=ler('public/js/avn-graficos-corporais.js');
 const nutricao=ler('public/js/avn-balanco-energetico.js');
 assert.ok(html.indexOf('avn-resumo-periodo.js')>=0&&html.indexOf('avn-resumo-periodo.js')<html.indexOf('avn-graficos-corporais.js'));
 assert.ok(corporal.includes('resumo.periodo(sleepState.days)'));
 assert.ok(corporal.includes("resumo.periodo($('dias').value)"));
 assert.ok(nutricao.includes('rows:pontosResumo(chave,dias)'));
 assert.ok(nutricao.includes("unidade:'g'}],resumo.periodo(periodo,fim)"));
 assert.ok(nutricao.includes('resumo.periodo(comparacao.period,comparacao.day)'));
 for(const script of [corporal,nutricao])assert.doesNotThrow(()=>new Function(script));
});
