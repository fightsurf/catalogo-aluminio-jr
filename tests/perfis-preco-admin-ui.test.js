'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const pagina=fs.readFileSync(path.join(__dirname,'../views/perfis-preco/admin.html'),'utf8');
const codigo=pagina.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace(/carregarPerfis\(\);carregarHistorico\(\);\s*$/, '');

function contexto(){
  const textos=[];const requisicoes=[];const modais=[];
  const elementos={novo:{addEventListener(){}},perfis:{},historico:{}};
  const document={
    getElementById(id){return elementos[id]||{textContent:''};},
    createElement(tag){return {tagName:tag,style:{},setAttribute(){},select(){},remove(){}};},
    body:{appendChild(){}},execCommand(){return true;}
  };
  const sandbox={
    document,location:{origin:'https://catalogo-aluminio-jr.onrender.com',pathname:'/admin-perfis-precos'},
    navigator:{clipboard:{writeText:async s=>{textos.push(s);}}},
    window:{isSecureContext:true},
    setTimeout(fn){fn();},
    confirm(msg){modais.push(msg);return true;},alert(msg){modais.push(msg);},
    fetch:async(url,options={})=>{requisicoes.push([url,options.method||'GET']);return {ok:true,status:200,json:async()=>({success:true,data:[]})};},
    URL,URLSearchParams,FormData
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo,sandbox);
  vm.runInContext("perfis=[{id:5,nome:'George Perfil 10%',token:'AbC_0123456789',ativo:true}]",sandbox);
  return {...sandbox,textos,requisicoes,modais};
}

test('admin cria os dois botões para cada perfil',()=>{
  assert.match(pagina,/Copiar os 3 links/);
  assert.match(pagina,/Excluir perfil/);
  assert.match(pagina,/onclick="copiarTres\(\$\{i\},this\)"/);
  assert.match(pagina,/onclick="excluirPerfil\(\$\{i\},this\)"/);
});

test('copiar três links gera exatamente o texto solicitado',async()=>{
  const ctx=contexto();
  const btn={disabled:false,textContent:'Copiar os 3 links',isConnected:false};
  await ctx.copiarTres(0,btn);
  assert.equal(ctx.textos[0],[
    'ALUMINIO JR PB',
    '',
    'Se for urgente, ligue.',
    '',
    'Catálogo: https://catalogo-aluminio-jr.onrender.com/catalogo-celular?perfil_venda=AbC_0123456789',
    '',
    'Forme seu kit feirinha: https://catalogo-aluminio-jr.onrender.com/kits-feirinha?perfil_venda=AbC_0123456789',
    '',
    'Monte seu pedido: https://catalogo-aluminio-jr.onrender.com/orcamento?perfil_venda=AbC_0123456789'
  ].join('\n'));
  assert.equal(btn.disabled,false);
});

test('excluir pede confirmação, faz DELETE e recarrega a lista sem apagar histórico',async()=>{
  const ctx=contexto();
  const btn={disabled:false};
  await ctx.excluirPerfil(0,btn);
  assert.equal(ctx.requisicoes[0][0],'/api/perfis-preco/admin/5');
  assert.equal(ctx.requisicoes[0][1],'DELETE');
  assert.ok(ctx.requisicoes.some(x=>x[0]==='/api/perfis-preco/admin/envios'));
  assert.match(ctx.modais[0],/links deixarão de funcionar/);
});
