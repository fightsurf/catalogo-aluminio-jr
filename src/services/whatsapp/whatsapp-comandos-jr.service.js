'use strict';
const zapi = require('../integracoes/zapi.service');
const { instanciaAtual, ehLid } = require('./zapi-lid-vinculos.service');
const formatar = require('./whatsapp-comandos-formatos.service');
const usados = new Map();
const TODOS = new Set(['@preco','@frete','@cidades','@volume','@kits-hoje','@kits-ontem']);
function parsear(mensagem) {
 const texto = String(mensagem || '').trim();
 const m = texto.match(/^(@[a-z-]+)(?:\s+([\s\S]*))?$/i);
 return m && TODOS.has(m[1].toLowerCase()) ? { comando:m[1].toLowerCase(), argumento:(m[2]||'').trim() } : null;
}
function podeExecutar(payload, dados) {
 const destino = String(payload?.phone || '');
 return payload?.fromMe === true && dados?.direcao === 'SAIDA'
   && dados?.tipo === 'texto' && payload?.instanceId === instanciaAtual()
   && !payload?.isGroup && !payload?.isNewsletter
   && (/^\d{10,15}$/.test(destino) || ehLid(destino));
}
async function executar(payload,dados) {
 const c = parsear(dados?.mensagem);
 if (!c || !podeExecutar(payload,dados)) return false;
 const id = String(payload.instanceId)+':'+String(payload.messageId);
 if (usados.has(id)) return true;
 usados.set(id,Date.now());
 for(const [k,v] of usados) if(Date.now()-v>3600000) usados.delete(k);
 try {
   await formatar.responder(c.comando,c.argumento,String(payload.phone),zapi);
 } catch(e) { console.error('[WhatsApp comandos JR]',c.comando,e.message); }
 return true;
}
module.exports = { parsear,podeExecutar,executar };
