'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../public/js/perfis-preco.js'), 'utf8');

function simularUI({json={success:true,data:{id:17,concluido:true}}, status=200, itens=[{id:'1'}], userAgent='Mozilla/5.0 (Linux; Android 14; Mobile)'}={}) {
  const botao = {disabled:false,dataset:{},textContent:'Enviar Orçamento'};
  const painel = {appendChild(el) { this.aviso=el; }};
  let chamadas=0, ultimoPayload;
  const eventos=[];
  const document = {
    querySelectorAll: () => itens.map(i=>({dataset:i})),
    querySelector: sel => {
      if (sel === '.painel') return painel;
      if (sel === '.painel button') return botao;
      if (sel.startsWith('.qtd[')) return {value:'2'};
      return null;
    },
    getElementById: id => id==='feedback-envio-perfil' ? painel.aviso : null,
    createElement: tag=>({tagName:tag, style:{}, setAttribute(){},appendChild(el){(this.children ||= []).push(el)}})
  };
  const window = {navigator:{userAgent}, location:{search:'?perfil_venda=token-opaco',assign:(url)=>eventos.push(['abrir',url])},alert:(mensagem)=>eventos.push(['alert',mensagem])};
  const sandbox={window,document,URLSearchParams,crypto:{randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'},
    fetch:async (url,opts)=>{
      chamadas++;
      ultimoPayload=JSON.parse(opts.body);
      return {ok:status>=200&&status<300,status,json:async()=>json};
    },
    alert:()=>eventos.push(['alert-global']),confirm:()=>eventos.push(['confirm'])
  };
  vm.runInNewContext(script,sandbox);
  return {window,painel,botao,resultado:()=>({chamadas,eventos,ultimoPayload})};
}

test('no sucesso: mostra somente PEDIDO ENVIADO e abre WhatsApp do usuário após o OK', async()=>{
  const ui=simularUI();
  await ui.window.PrecosVendedor.enviar('orcamento');
  assert.deepEqual(ui.resultado().eventos,[['alert','PEDIDO ENVIADO'],['abrir','whatsapp://app']]);
  assert.equal(ui.resultado().chamadas,1);
  assert.equal(ui.resultado().ultimoPayload.modulo,'orcamento');
  assert.equal(ui.botao.disabled,false);
  assert.equal(ui.botao.textContent,'Enviar Orçamento');
  assert.match(ui.painel.aviso.textContent,/mensagens aceitas pela Z-API/);
  assert.equal(ui.painel.aviso.children[0].textContent,'Abrir WhatsApp');
  assert.equal(ui.painel.aviso.children[0].href,'whatsapp://app');
});

test('falha não exibe PEDIDO ENVIADO nem abre WhatsApp; preserva chave', async()=>{
  const ui=simularUI({json:{success:false,message:'Envio parcial. Consulte a administração.'},status:207});
  await ui.window.PrecosVendedor.enviar('kit-feirinha');
  const chave=ui.resultado().ultimoPayload.chave;
  assert.equal(ui.resultado().eventos.length,0);
  assert.match(ui.painel.aviso.textContent,/Envio parcial/);
  await ui.window.PrecosVendedor.enviar('kit-feirinha');
  assert.equal(ui.resultado().ultimoPayload.chave,chave);
  assert.equal(ui.resultado().eventos.length,0);
});

test('itens vazios apresentam erro na página sem caixa de diálogo', async()=>{
  const ui=simularUI({itens:[]});
  await ui.window.PrecosVendedor.enviar('orcamento');
  assert.equal(ui.resultado().chamadas,0);
  assert.equal(ui.resultado().eventos.length,0);
  assert.match(ui.painel.aviso.textContent,/Selecione ao menos um produto/);
});

test('no computador abre WhatsApp Web, depois do aviso', async()=>{
  const ui=simularUI({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'});
  await ui.window.PrecosVendedor.enviar('kit-feirinha');
  assert.deepEqual(ui.resultado().eventos,[['alert','PEDIDO ENVIADO'],['abrir','https://web.whatsapp.com/']]);
  assert.equal(ui.painel.aviso.children[0].href,'https://web.whatsapp.com/');
});

test('resposta parcial sem erro HTTP não mostra PEDIDO ENVIADO', async()=>{
  const ui=simularUI({json:{success:true,data:{id:33,concluido:false}},status:200});
  await ui.window.PrecosVendedor.enviar('orcamento');
  assert.equal(ui.resultado().eventos.length,0);
  assert.match(ui.painel.aviso.textContent,/envio não foi concluído/);
});
