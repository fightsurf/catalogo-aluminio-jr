'use strict';
const produtos = require('../produto/produto.service');
const logistica = require('../logistica/logisticaService');
const volume = require('../volume/volume.service');
const ofertas = require('../ofertas/ofertas.service');
async function texto(zapi, destino, mensagem) {
  return zapi.postZapi('/send-text', {phone:destino,message:mensagem});
}
async function imagem(zapi,destino,url,legenda) {
  return zapi.postZapi('/send-image',{phone:destino,image:url,caption:legenda});
}
async function responder(comando,arg,destino,zapi) {
  if (comando === '@preco') {
    if (!arg) return;
    const lista = await produtos.listar({busca:arg,apenasAtivos:true});
    lista.sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR',{sensitivity:'base'}));
    if (!lista.length) return texto(zapi,destino,'❌ Nenhum produto encontrado.');
    for (const p of lista) {
      const descricao = `${p.nome} - R$ ${Number(p.preco).toFixed(2)}`;
      const foto = p.foto || p.fotos?.find(Boolean);
      if (foto) await imagem(zapi,destino,foto,descricao);
      else await texto(zapi,destino,descricao);
    }
  } else if (comando === '@frete') {
    if (!arg) return;
    const r = await logistica.buscarTransportadorasPorNomeCidade(arg);
    let mensagem;
    if (r.tipo === 'resultado' && Array.isArray(r.dados) && r.dados.length > 0) {
      const lista = r.dados.map((t,i)=>`${i+1}. ${t.nome}\n📞 ${t.telefone||'Sem telefone'}`).join('\n\n');
      mensagem = `🚚 Frete para ${r.dados[0].cidade_nome} - ${r.dados[0].estado}\n\n${lista}`;
      // Foto apenas quando há transportadoras. Primeiro a imagem, depois a lista.
      // Se a foto falhar, a lista ainda deve chegar ao cliente.
      try {
        await zapi.postZapi('/send-image', {
          phone: destino,
          image: 'https://pub-51cb4ace3dfb43a4ac45a4b7c399904d.r2.dev/comum/caixapanela.jpeg',
          caption: 'Medidas da caixa do Alumínio JR',
          viewOnce: false
        });
      } catch (erro) {
        console.error('[WhatsApp @frete] Foto da caixa não enviada:', erro.message);
      }
    } else if (r.tipo === 'sugestao') {
      const lista = r.cidades.map((c,i)=>`${i+1}. ${c.nome} - ${c.estado}`).join('\n');
      mensagem = `🔎 Encontrei várias cidades parecidas:\n\n${lista}\n\nDigite novamente assim:\n@frete NomeDaCidade - UF\n\nExemplo:\n@frete Cruz - CE`;
    } else if (r.tipo === 'sem_frete') {
      mensagem = `🚚 ${r.cidade} - ${r.estado}\n\n❌ Não há frete disponível para essa cidade.`;
    } else mensagem = '❌ Nenhuma cidade encontrada.';
    await texto(zapi,destino,mensagem);
  } else if (comando === '@cidades') {
    const uf = arg.toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) return;
    const todas = await logistica.listarSomenteCidadesPorEstado(uf);
    const lista = [...new Set(todas.map(x=>String(x).trim()))].filter(Boolean)
      .sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:'base'}));
    const mensagem = lista.length
      ? `📍 CIDADES ATENDIDAS - ${uf}\n\n${lista.map(c=>`• ${c}`).join('\n')}`
      : `❌ Nenhuma cidade encontrada para a UF ${uf}.`;
    await texto(zapi,destino,mensagem);
  } else if (comando === '@volume') {
    const m = arg.match(/^(\d+)\s+([\s\S]+)$/);
    if (!arg) return texto(zapi,destino,'Use o formato:\n\n@volume qtde [relatório]');
    if (!m || Number(m[1])<=0) return texto(zapi,destino,'Informe a quantidade após o comando.\n\nExemplo:\n@volume 50 [relatório]');
    if (!m[2].includes('| QTD:')) return texto(zapi,destino,'Relatório inválido. Verifique o formato.');
    const data = await volume.calcular({texto:m[2],multiplicador:Number(m[1])});
    let mensagem = '📦 *Cálculo de Volumes*\n\n';
    for (const i of data.itens) mensagem += i.capacidade_caixa===0
      ? `• ${i.produto} → ignorado\n`
      : `• ${i.produto} → ${Number(i.volumes).toFixed(1)}\n`;
    mensagem += `\n🔢 *Total estimado:* ${Number(data.total_volumes).toFixed(1)} volume(s)`;
    await texto(zapi,destino,mensagem);
  } else if (comando === '@kits-hoje'||comando === '@kits-ontem') {
    await ofertas.enviarKitsPorPeriodo(
      comando==='@kits-ontem'?'ontem':'hoje',
      destino,
      process.env.PUBLIC_BASE_URL || 'https://catalogo-aluminio-jr.onrender.com'
    );
  }
}
module.exports = { responder };
