'use strict';

// Consulta somente leitura dos pedidos já gravados, reutilizando a mesma
// pesquisa e detalhamento usados pela tela /legado/pedidos.
const legado = require('../legado/pedido/pedidosLegado.service');

function validar(condicao, mensagem) {
  if (!condicao) { const e = new Error(mensagem); e.isValidation = true; throw e; }
}
function texto(v) { return String(v ?? '').trim(); }
function numeroOpcional(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function dataIso(v) {
  const s = texto(v);
  validar(/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s,
  'Data inválida. Use AAAA-MM-DD.');
  return s;
}
function situacaoCancelada(s) {
  return ['C', 'CANCELADO', 'CANCELADA'].includes(texto(s).toUpperCase());
}
function cabecalho(p) {
  const c = p?.cliente || {};
  const v = p?.vendedor || {};
  return {
    id_mestre: p?.idMestre ?? p?.saida ?? null,
    numero: texto(p?.numero),
    data: p?.data || null,
    cliente: { favorecido: c.favorecido ?? null, nome: texto(c.nome), cidade: texto(c.cidade), uf: texto(c.uf) },
    vendedor: { favorecido: v.favorecido ?? null, nome: texto(v.nome) },
    situacao: texto(p?.situacao) || null,
    cancelado: situacaoCancelada(p?.situacao),
    total: numeroOpcional(p?.total),
    total_pago: numeroOpcional(p?.totalPago),
    saldo_restante: numeroOpcional(p?.saldoRestante),
    volumes: numeroOpcional(p?.volumes),
    carrada: p?.carradaAtual ? {
      codigo: p.carradaAtual.codigo ?? null,
      data: p.carradaAtual.data ?? null,
      descricao: texto(p.carradaAtual.descricao)
    } : null
  };
}

async function consultarPedidos({ numero, cliente, data, limite = 15, incluir_cancelados = true } = {}) {
  const filtros = { numero: texto(numero), cliente: texto(cliente), data: texto(data) };
  validar(filtros.numero || filtros.cliente || filtros.data,
    'Informe o número, o cliente ou a data para consultar pedidos.');
  validar(filtros.numero.length <= 40 && filtros.cliente.length <= 120,
    'Filtro de consulta muito longo.');
  if (filtros.data) filtros.data = dataIso(filtros.data);
  validar(Number.isInteger(limite) && limite >= 1 && limite <= 30,
    'Limite permitido: de 1 a 30 pedidos.');
  validar(typeof incluir_cancelados === 'boolean', 'incluir_cancelados deve ser booleano.');
  const encontrados = await legado.pesquisarPedidos(filtros);
  validar(Array.isArray(encontrados), 'A consulta de pedidos retornou formato inesperado.');
  const filtrados = incluir_cancelados ? encontrados :
    encontrados.filter(p => !situacaoCancelada(p?.situacao));
  return {
    filtros,
    encontrados: filtrados.length,
    exibindo: Math.min(filtrados.length, limite),
    pedidos: filtrados.slice(0, limite).map(cabecalho),
    somente_leitura: true
  };
}

async function detalharPedido({ id_mestre } = {}) {
  const id = Number(id_mestre);
  validar(Number.isSafeInteger(id) && id > 0, 'Informe o ID real do pedido.');
  const p = await legado.buscarDetalhePedido(id);
  if (!p) return { encontrado: false, id_mestre: id, pedido: null };
  return {
    encontrado: true,
    pedido: {
      ...cabecalho(p),
      observacao: texto(p.obs) || null,
      itens: (Array.isArray(p.itens) ? p.itens : []).map(i => ({
        codigo: i.item ?? null,
        descricao: texto(i.descricao),
        quantidade: numeroOpcional(i.quantidade),
        preco_unitario: numeroOpcional(i.preco),
        subtotal: numeroOpcional(i.subtotal)
      }))
    },
    somente_leitura: true
  };
}
module.exports = { consultarPedidos, detalharPedido };
