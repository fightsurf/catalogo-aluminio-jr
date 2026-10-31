'use strict';
const clientes = require('../clientes/clientes.service');
const cache = new Map();
async function nomeCidade(telefone) {
  const n = String(telefone||'').replace(/\D/g,'');
  if(!/^\d{10,15}$/.test(n))return null;
  const atual=cache.get(n);
  if(atual && atual.expira>Date.now())return atual.dados;
  let dados=null;
  try {
    const encontrados=await clientes.listarClientes({telefone:n,limite:2,status:'todos'});
    if(encontrados.length===1) {
      const c=encontrados[0];
      dados={nome:c.nome||c.razao||'',cidade:c.cidade||'',uf:c.uf||''};
    }
  } catch(e) {
    console.error('[Bot Admin] Nao foi possivel consultar cadastro do cliente:',e.message);
  }
  cache.set(n,{dados,expira:Date.now()+300000});
  return dados;
}
async function enriquecer(lista) {
  // Nao bloquear a lista inteira se o Firebird estiver indisponivel.
  const saida=[];
  for(let i=0;i<lista.length;i+=4){
    const lote=await Promise.all(lista.slice(i,i+4).map(async c=>{
      const cliente=await nomeCidade(c.telefone);
      return {...c,cliente_nome:cliente?.nome||null,cliente_cidade:cliente?.cidade||null,cliente_uf:cliente?.uf||null};
    }));
    saida.push(...lote);
  }
  return saida;
}
module.exports={enriquecer};
