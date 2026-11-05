'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('setas reordenam as ações e salvam a sequência integral no servidor',()=>{
 const html=read('views/bot-admin/bot-intencoes.html');
 const routes=read('src/routes/bot/botFluxo.routes.js');
 const controller=read('src/controllers/bot/botFluxo.controllers.js');
 const service=read('src/services/bot/botFluxo.services.js');
 assert.match(html,/\['↑', -1, 'Subir ação'\]/);
 assert.match(html,/\['↓', 1, 'Descer ação'\]/);
 assert.match(html,/moverAcao\(a\.id, deslocamento\)/);
 assert.match(html,/\/bot\/fluxo\/admin\/acoes\/reordenar/);
 assert.match(html,/ids:acoesDaIntencao\.map\(a => Number\(a\.id\)\)/);
 assert.match(html,/id="acao-ordem" required readonly/);
 assert.match(routes,/router\.put\('\/admin\/acoes\/reordenar', controller\.reordenarAcoes\)/);
 assert.match(controller,/botFluxoService\.reordenarAcoes\(req\.body/);
 assert.match(service,/async function reordenarAcoes\(/);
 assert.match(service,/new Set\(sequencia\)\.size !== sequencia\.length/);
 assert.match(service,/FOR UPDATE/);
 assert.match(service,/WITH ORDINALITY/);
 assert.match(service,/client\.query\('COMMIT'\)/);
 assert.match(service,/client\.query\('ROLLBACK'\)/);
 assert.match(service,/ORDER BY ordem ASC, id ASC/);
 for(const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1])){
  assert.doesNotThrow(()=>new Function(script));
 }
 assert.doesNotThrow(()=>new Function(service));
 assert.doesNotThrow(()=>new Function(controller));
 assert.doesNotThrow(()=>new Function(routes));
});

test('prévia mostra conversa montada à direita das ações mesmo sem editar',()=>{
 const html=read('views/bot-admin/bot-intencoes.html');
 assert.match(html,/\.acoes-layout \{ display:grid; grid-template-columns:/);
 assert.match(html,/\.acoes-previa-completa \{ position:sticky/);
 assert.match(html,/@media\(max-width:620px\)/);
 for(const id of ['acao-form','acao-tipo','acao-conteudo','wa-conversa','wa-resumo'])
  assert.ok(html.includes('id="'+id+'"'),id+' deve existir');
 const inicioFormulario=html.indexOf('<form id="acao-form"');
 const fimFormulario=html.indexOf('</form>',inicioFormulario);
 const painel=html.indexOf('<aside class="acoes-previa-completa"');
 assert.ok(inicioFormulario>0 && fimFormulario>inicioFormulario && painel>fimFormulario,
  'Prévia deve permanecer fora do formulário, visível quando o usuário não está editando');
 assert.match(html,/Todas as mensagens ativas, na sequência em que serão enviadas/);
 assert.match(html,/function atualizarPreviaAcao\(/);
 assert.match(html,/function preencherBolhaWhatsApp\(/);
 assert.match(html,/function formatarMensagemWhatsApp\(/);
 assert.match(html,/lista = acoesDaIntencao\.map\(a => \(\{\.\.\.a\}\)\)/);
 assert.match(html,/for \(let indice = 0; indice < lista\.length; indice\+\+\)/);
 assert.match(html,/if \(!acao\.ativo\) continue/);
 assert.match(html,/Mensagem ' \+ \(indice \+ 1\)/);
 assert.match(html,/wa-preview-item-rascunho/);
 assert.match(html,/foto\.onerror/);
 assert.match(html,/addEventListener\('input', atualizarPreviaAcao\)/);
 assert.match(html,/addEventListener\('change', atualizarPreviaAcao\)/);
 for(const tipo of ['SEND_TEXT','SEND_IMAGE','SEND_VIDEO','SEND_AUDIO','SEND_DOCUMENT','SEND_LINK','SEND_LOCATION'])
  assert.ok(html.includes("'"+tipo+"'"),'Tipo não suportado: '+tipo);
 const inicio=html.indexOf('function preencherBolhaWhatsApp(');
 const fim=html.indexOf('function validarConteudoAcao(',inicio);
 const previa=html.slice(inicio,fim);
 assert.ok(inicio>0 && fim>inicio);
 assert.doesNotMatch(previa,/fetch\s*\(|enviarAcao|executarFluxo/);
 assert.match(previa,/replaceChildren\(\)/);
 assert.match(previa,/formatarMensagemWhatsApp/);
 assert.match(previa,/Simulação · não enviado/);
});

test('prévia compacta ocupa aproximadamente metade e modal não exige scroll externo',()=>{
 const html=read('views/bot-admin/bot-intencoes.html');
 assert.match(html,/\.modal-acoes \{[\s\S]*?height:min\(670px,calc\(100dvh - 20px\)\)/);
 assert.match(html,/\.acoes-layout \{ grid-template-columns:minmax\(0,1fr\) 245px/);
 assert.match(html,/\.acoes-previa-completa \.wa-chat \{ height:255px; min-height:0; flex:0 0 255px/);
 assert.match(html,/\.acoes-coluna-editor \{ min-height:0; overflow-y:auto/);
 assert.match(html,/\.acoes-previa-completa \.wa-fundo \{ min-height:0; max-height:none/);
 assert.match(html,/@media\(max-width:620px\)/);
 assert.match(html,/\.acoes-previa-completa \.wa-chat \{ height:167px; flex:0 0 167px/);
 assert.match(html,/\.overlay-acoes \.modal-acoes \{ margin:0; max-height:calc\(100dvh - 20px\); overflow:hidden/);
});
