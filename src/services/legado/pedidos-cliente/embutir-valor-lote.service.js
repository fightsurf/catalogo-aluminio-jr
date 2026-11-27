'use strict';

const { createHash } = require('node:crypto');
const pool = require('../../../../db/connection');
const rateio = require('../../../../public/js/pedido-valor-embutido');
const pedidos = require('../pedido/pedidosLegado.service');
const historico = require('../pedido/valor-embutido.service');

const emGravacao = new Set();
function exigir(condicao, mensagem) {
  if (!condicao) throw new Error(mensagem);
}
function id(valor, nome) {
  const n = Number(valor);
  exigir(Number.isSafeInteger(n) && n > 0, nome + ' inválido.');
  return n;
}
function centavos(valor) {
  const n = Math.round(Number(valor) * 100);
  exigir(Number.isSafeInteger(n) && n >= 0, 'Valor monetário inválido.');
  return n;
}
function dataVenda(valor) {
  const s = String(valor || '');
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const d = new Date(s);
  exigir(!Number.isNaN(d.getTime()), 'Data da venda inválida.');
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function idsSelecionados(lista) {
  exigir(Array.isArray(lista) && lista.length >= 1 && lista.length <= 30,
    'Selecione de 1 a 30 pedidos por operação.');
  const ids = lista.map(v => id(v, 'Pedido'));
  exigir(new Set(ids).size === ids.length, 'A seleção contém pedidos repetidos.');
  return ids.sort((a,b) => a-b);
}
function assinatura(obj) {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}
function lerPedido(pedido, pedidoId, clienteId) {
  const prefixo = 'Pedido ' + (pedido?.numero || pedidoId) + ': ';
  exigir(pedido && Number(pedido.idMestre ?? pedido.saida) === pedidoId, prefixo + 'não localizado.');
  exigir(Number(pedido.cliente?.favorecido) === clienteId, prefixo + 'não pertence ao cliente selecionado.');
  exigir(!['C','CANCELADO','CANCELADA'].includes(String(pedido.situacao || '').trim().toUpperCase()),
    prefixo + 'está cancelado.');
  exigir(!pedido.valorEmbutido && !pedido.avisoValorEmbutido,
    prefixo + 'já possui valor embutido ou salvamento pendente. Confira na edição individual antes de continuar.');
  exigir(Array.isArray(pedido.itens) && pedido.itens.length, prefixo + 'sem itens.');
  const itens = pedido.itens.map(i => {
    const quantidade = Number(i.quantidade), preco = Number(i.preco);
    exigir(Number.isSafeInteger(quantidade) && quantidade > 0, prefixo + 'quantidade inválida.');
    exigir(Number.isFinite(preco) && preco >= 0 && Math.abs(preco*100 - Math.round(preco*100)) < 0.000001,
      prefixo + 'os preços devem ter até duas casas decimais.');
    return { item:id(i.item, 'Item'), descricao:String(i.descricao || ''), quantidade, preco,
      saidaItem:i.saidaItem ?? null, sequencia:i.sequencia ?? null };
  });
  const total = itens.reduce((s,i) => s + centavos(i.preco)*i.quantidade, 0);
  exigir(Number.isSafeInteger(total) && total === centavos(pedido.total),
    prefixo + 'o total não corresponde à soma dos itens. Confira o pedido na edição individual.');
  return { id:pedidoId, numero:String(pedido.numero ?? pedidoId), data:dataVenda(pedido.data),
    vendedor:id(pedido.vendedor?.favorecido, 'Vendedor'), obs:String(pedido.obs || ''), itens, total };
}

// Cada pedido conserva seu próprio valor nominal e seu próprio histórico de retirada.
// Distribui o valor original quando possível, respeitando o intervalo de centavos
// que gera o mesmo acréscimo uniforme global em cada pedido.
function cotas(quantidades, valorCentavos, acrescimoCentavos) {
  const minimos = quantidades.map(q => (acrescimoCentavos-1)*q+1);
  const maximos = quantidades.map(q => acrescimoCentavos*q);
  let falta = Math.max(0, valorCentavos - minimos.reduce((s,v) => s+v,0));
  const capacidade = quantidades.reduce((s,q,i) => s+maximos[i]-minimos[i],0);
  const resultado = minimos.map((v,i) => v + (capacidade ? Math.floor(falta*(maximos[i]-v)/capacidade) : 0));
  let resto = falta - resultado.reduce((s,v,i) => s+v-minimos[i],0);
  for (let i=0; i<resultado.length && resto>0; i++) {
    const n = Math.min(resto, maximos[i]-resultado[i]);
    resultado[i] += n; resto -= n;
  }
  exigir(resto === 0, 'Não foi possível calcular as cotas.');
  return resultado;
}
async function preparar(cliente, selecao, produtoId) {
  const clienteId = id(cliente, 'Cliente'), ids = idsSelecionados(selecao);
  const { rows } = await pool.query(
    'SELECT id,nome,item_legado,preco FROM produtos WHERE id=$1 AND ativo=TRUE', [id(produtoId,'Produto')]);
  const p = rows[0];
  exigir(p && Number(p.preco)>0 && String(p.nome || '').trim(), 'Produto sem preço ativo.');
  const produto = { id:id(p.id,'Produto'), nome:String(p.nome), item_legado:p.item_legado, preco:centavos(p.preco)/100 };
  const originais = [];
  for (const pedidoId of ids) originais.push(lerPedido(await pedidos.buscarDetalhePedido(pedidoId), pedidoId, clienteId));
  const resumo = rateio.simular(originais.flatMap(p => p.itens), produto.preco);
  const quantidades = originais.map(p => p.itens.reduce((s,i) => s+i.quantidade,0));
  const quotas = cotas(quantidades, centavos(produto.preco), centavos(resumo.acrescimoUnitario));
  const planos = originais.map((p,i) => {
    const itens = p.itens.map(item => ({
      ...item,
      preco:(centavos(item.preco)+centavos(resumo.acrescimoUnitario))/100,
      __valorEmbutido:{precoBase:item.preco,acrescimoUnitario:resumo.acrescimoUnitario}
    }));
    const valorEmbutido = rateio.serializar(itens, {
      produto:{id:produto.id,itemLegado:Number(produto.item_legado)||null,nome:produto.nome}, valor:quotas[i]/100
    });
    const payload = {data:p.data,vendedor:p.vendedor,obs:p.obs,
      itens:itens.map(({item,descricao,quantidade,preco}) => ({item,descricao,quantidade,preco})),valorEmbutido};
    historico.normalizarValorEmbutido(valorEmbutido,payload.itens);
    const acrescimo = centavos(resumo.acrescimoUnitario)*quantidades[i];
    exigir(Number.isSafeInteger(p.total+acrescimo), 'Total do pedido acima do limite seguro.');
    return {original:p,payload,resumo:{id:p.id,numero:p.numero,quantidade:quantidades[i],
      totalAnterior:p.total/100,acrescimo:acrescimo/100,totalNovo:(p.total+acrescimo)/100}};
  });
  const previa = {produto:{id:produto.id,nome:produto.nome,preco:produto.preco}, ...resumo,
    pedidos:planos.map(p => p.resumo),
    valorNominalRegistrado:quotas.reduce((s,v)=>s+v,0)/100,
    token:assinatura({clienteId,produto,originais})};
  return {clienteId,ids,planos,previa};
}
async function previa(cliente, corpo = {}) {
  return (await preparar(cliente, corpo.pedidos, corpo.produtoId)).previa;
}
async function aplicar(cliente, corpo = {}) {
  const ids = idsSelecionados(corpo.pedidos);
  exigir(typeof corpo.token === 'string' && /^[0-9a-f]{64}$/.test(corpo.token),
    'Gere uma nova prévia antes de confirmar.');
  exigir(ids.every(i => !emGravacao.has(i)), 'Já existe uma gravação para um dos pedidos selecionados.');
  ids.forEach(i => emGravacao.add(i));
  try {
    const plano = await preparar(cliente, ids, corpo.produtoId);
    exigir(plano.previa.token === corpo.token, 'Os pedidos ou o preço do produto mudaram. Gere uma nova prévia.');
    const resultados = plano.planos.map(p => ({id:p.original.id,numero:p.original.numero,estado:'nao_processado'}));
    for (let i=0; i<plano.planos.length; i++) {
      const p = plano.planos[i], r = resultados[i];
      try {
        const atual = lerPedido(await pedidos.buscarDetalhePedido(p.original.id), p.original.id, plano.clienteId);
        exigir(assinatura(atual) === assinatura(p.original),'Pedido alterado após a prévia.');
      } catch (erro) {
        r.estado='nao_gravado'; r.mensagem=erro.message; break;
      }
      try {
        const resposta = await pedidos.atualizarPedido(p.original.id,p.payload);
        if (!resposta || resposta.salvamentoIncerto || resposta.avisoValorEmbutido ||
            Number(resposta.idMestre ?? resposta.saida) !== p.original.id ||
            !resposta.valorEmbutido || centavos(resposta.total) !== centavos(p.resumo.totalNovo)) {
          r.estado='incerto'; r.mensagem=resposta?.avisoValorEmbutido || resposta?.aviso ||
            'Não foi possível conferir a gravação. Reabra o pedido antes de repetir.';
          break;
        }
        r.estado='gravado';
      } catch (erro) {
        r.estado=erro.pedidoNaoGravado ? 'nao_gravado' : 'incerto';
        r.mensagem=erro.message; break;
      }
    }
    return {completo:resultados.every(r=>r.estado==='gravado'),resultados};
  } finally {
    ids.forEach(i => emGravacao.delete(i));
  }
}
module.exports = { previa, aplicar, cotas };
