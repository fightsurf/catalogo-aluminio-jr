'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const js=read('public/js/avn-balanco-energetico.js');
const html=read('views/avn/indicador-graficos-corporais.html');
function simular(width,period,keys=['peso','saldo']){
 const nodes={};
 class El{
  constructor(tag){this.tag=tag;this.attrs={};this.children=[];this.style={};this.events={};this.dataset={};this.clientWidth=width;this.clientLeft=1;this.offsetWidth=110;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  addEventListener(k,fn){this.events[k]=fn;}
  getBoundingClientRect(){return {left:this.tag==='svg'?11:0,width:this.tag==='svg'?width-20:width};}
 }
 for(const id of ['compare-chart','compare-status','compare-legend'])nodes[id]=new El('div');
 const doc={getElementById:id=>nodes[id],querySelectorAll:()=>keys.map(key=>({dataset:{compare:key}})),createElement:tag=>new El(tag),createElementNS:(_ns,tag)=>new El(tag)};
 const win={getComputedStyle:()=>({paddingLeft:'10px',paddingRight:'10px'})};
 const code=js.slice(0,js.indexOf("window.addEventListener('resize',"))+'return data=>{comparacao=data;desenharComparacao();};})();';
 const run=new Function('document','window', 'return '+code)(doc,win);
 const day='2026-11-28';
 const dates=Array.from({length:period},(_,i)=>new Date(Date.parse(day+'T12:00:00Z')-(period-i-1)*86400000).toISOString().slice(0,10));
 const series=Object.fromEntries(keys.map((key,j)=>[key,dates.map((data,i)=>({data,value:j===0?80+i/10:-300+i}))]));
 run({period,day,series});
 return {area:nodes['compare-chart'],status:nodes['compare-status'],dates};
}
test('comparador cabe na largura útil e preserva todos os pontos em todos os períodos',()=>{
 for(const width of [300,375,650,1000,1250])for(const period of [7,15,30,60,90,120]){
  const {area}=simular(width,period);
  const root=area.children[0];
  const [,,w,h]=root.attrs.viewBox.split(' ').map(Number);
  assert.equal(w,width-20);
  assert.ok(h>0);
  assert.equal(root.style.width,'100%');
  assert.equal(root.style.minWidth,'0');
  assert.equal(root.children.filter(n=>n.tag==='circle').length,period*2);
  assert.equal(root.children.filter(n=>n.tag==='polyline').length,2);
  const overlay=root.children.find(n=>n.tag==='rect'&&n.events.pointerdown);
  assert.ok(Number(overlay.attrs.width)>0);
  overlay.events.pointerdown({clientX:11+w-52});
  assert.equal(area.children[1].hidden,false);
  assert.match(area.children[1].textContent,/Peso:/);
  assert.match(area.children[1].textContent,/Balanço energético:/);
 }
});
test('rótulos densos cedem espaço ao toque, sem remover dados',()=>{
 const {area,status}=simular(320,30);
 const root=area.children[0];
 assert.equal(root.children.filter(n=>n.attrs['paint-order']==='stroke').length,0);
 assert.match(status.textContent,/Toque no gráfico/);
 const amplo=simular(1000,7,['peso']);
 assert.ok(amplo.area.children[0].children.some(n=>n.attrs['paint-order']==='stroke'));
});
test('CSS restringe o SVG e empilha o comparador em telas estreitas',()=>{
 assert.match(html,/\.compare-display \.compare-chart svg\{[^}]*max-width:100%;min-width:0/);
 assert.match(html,/@media\(max-width:700px\)\{\s*body\[data-section="corporal"\] \.compare-layout\{grid-template-columns:minmax\(0,1fr\)/);
 assert.doesNotMatch(js,/comparacao\.period\*82/);
 assert.doesNotMatch(js,/root\.style\.width=W\+'px'/);
});
