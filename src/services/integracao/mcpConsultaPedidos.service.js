'use strict';

// Interface somente leitura sobre as consultas existentes do sistema web.
const legado = require('../legado/pedido/pedidosLegado.service');
const clientes = require('../legado/clientes/clientes.service');
const historico = require('../legado/pedidos-cliente/pedidos-cliente.service');
const carradas = require('../legado/carradas/carradas.service');

function validar(condicao, mensagem) {
  if (!condicao) { const e = new Error(mensagem); e.isValidation = true; throw e; }
}
function texto(v) { return String(v ?? '').trim(); }
function normalizar(v) {
  return texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
}
function numeroOpcional(v) {
  if (v === undefined || v === null || texto(v) === '') return null;
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
async function buscarCarradas({ data, descricao = '', pagina = 1, limite = 30 } = {}) {
  validar(typeof data === 'string', 'Informe a data da carrada em AAAA-MM-DD.');
  const dia = dataIso(data);
  validar(typeof descricao === 'string' && descricao.length <= 120, 'Descrição de carrada inválida.');
  validar(Number.isInteger(pagina) && pagina >= 1 && pagina <= 100000, 'Página inválida.');
  validar(Number.isInteger(limite) && limite >= 1 && limite <= 30, 'Limite permitido: de 1 a 30 carradas.');
  // Mesma consulta do select da Inserção V2, sem calcular o resumo de produção.
  // Consulta novamente a cada chamada; não reutiliza códigos de pedidos anteriores.
  const rows = await carradas.listarCarradas({ incluirResumoProducao: false });
  validar(Array.isArray(rows), 'A consulta de carradas retornou formato inesperado.');
  const encontradas = rows.filter(c =>
    // A data do legado é civil: preservar o prefixo ISO, como faz a tela.
    texto(c?.data).slice(0, 10) === dia &&
    (!texto(descricao) || normalizar(c?.descricao).includes(normalizar(descricao)))
  ).map(c => {
    const codigo = Number(c.codigo);
    validar(Number.isSafeInteger(codigo) && codigo > 0, 'A carrada encontrada não retornou um código válido.');
    return { codigo, data: dia, descricao: texto(c.descricao), vendas_bloqueadas: Boolean(c.vendasBloqueadas) };
  }).sort((a, b) => a.codigo - b.codigo);
  const total = encontradas.length;
  const inicio = (pagina - 1) * limite;
  const selecionadas = encontradas.slice(inicio, inicio + limite);
  const temMais = inicio + selecionadas.length < total;
  return {
    filtros: { data: dia, descricao: texto(descricao) },
    total_encontrado: total, exibindo: selecionadas.length, pagina, limite,
    tem_mais: temMais, proxima_pagina: temMais ? pagina + 1 : null,
    necessita_escolha_carrada: total > 1,
    carradas: selecionadas, somente_leitura: true,
    instrucao: total === 0
      ? 'Nenhuma carrada corresponde à data e descrição consultadas. Confira a data com o usuário; não invente código nem prepare o pedido sem a carrada solicitada.'
      : total > 1
        ? 'Há mais de uma carrada correspondente. Mostre data e descrição e pergunte qual o usuário deseja; consulte as próximas páginas quando houver. Não escolha a primeira automaticamente.'
        : 'Use o código retornado em carrada_codigo ao preparar este pedido e apresente a data e descrição da carrada na prévia. Não peça ao usuário para informar o código.'
  };
}
function situacaoCancelada(p) {
  return p?.cancelado === true || ['C', 'CANCELADO', 'CANCELADA'].includes(texto(p?.situacao).toUpperCase());
}
function idPedido(p) { return p?.idMestre ?? p?.saida ?? null; }
function ordemCadastro(p) {
  const id = texto(idPedido(p));
  return /^\d+$/.test(id) ? BigInt(id) : null;
}
function maisRecentes(a, b) {
  const idA = ordemCadastro(a);
  const idB = ordemCadastro(b);
  if (idA === idB) return texto(b?.numero).localeCompare(texto(a?.numero), 'pt-BR', { numeric: true });
  if (idA === null) return 1;
  if (idB === null) return -1;
  return idA > idB ? -1 : 1;
}
function expedicao(p) {
  const campos = ['dataExpedicao', 'DATA_EXPEDICAO', 'data_expedicao', 'CAMPO01', 'campo01'];
  const campo = campos.find(k => Object.prototype.hasOwnProperty.call(p || {}, k) && p[k] !== undefined);
  const disponivel = p?.dataExpedicaoDisponivel !== false && campo !== undefined;
  return { disponivel, data: disponivel ? texto(p[campo]) || null : null };
}
function cabecalho(p) {
  const c = p?.cliente || {};
  const v = p?.vendedor || {};
  const exp = expedicao(p);
  return {
    id_mestre: idPedido(p), numero: texto(p?.numero), data: p?.data || null,
    data_expedicao: exp.data, data_expedicao_disponivel: exp.disponivel,
    sem_data_expedicao: exp.disponivel ? exp.data === null : null,
    cliente: { favorecido: c.favorecido ?? null, nome: texto(c.nome), cidade: texto(c.cidade), uf: texto(c.uf) },
    vendedor: { favorecido: v.favorecido ?? null, nome: texto(v.nome) },
    situacao: texto(p?.situacao) || null, cancelado: situacaoCancelada(p),
    total: numeroOpcional(p?.total), total_pago: numeroOpcional(p?.totalPago),
    saldo_restante: numeroOpcional(p?.saldoRestante), volumes: numeroOpcional(p?.volumes),
    carrada: p?.carradaAtual ? {
      codigo: p.carradaAtual.codigo ?? null, data: p.carradaAtual.data ?? null,
      descricao: texto(p.carradaAtual.descricao)
    } : null
  };
}
function resumirCliente(c) {
  return {
    favorecido: c?.favorecido ?? c?.codigo ?? null,
    nome: texto(c?.nome || c?.razao_social || c?.fantasia),
    cidade: texto(c?.cidade), uf: texto(c?.uf || c?.estado)
  };
}
async function resolverCliente({ cliente, favorecido }) {
  if (favorecido !== undefined) {
    validar(Number.isSafeInteger(favorecido) && favorecido > 0, 'Informe o código inteiro real do cliente.');
    const registro = await clientes.buscarCliente(favorecido);
    if (!registro) return { encontrado: false };
    const escolhido = { ...resumirCliente(registro), favorecido };
    validar(!cliente || normalizar(escolhido.nome).includes(normalizar(cliente)),
      'O nome informado não corresponde ao código do cliente.');
    return { encontrado: true, cliente: escolhido };
  }
  const rows = await clientes.listarClientes({ nome: cliente });
  validar(Array.isArray(rows), 'A busca de clientes retornou formato inesperado.');
  const correspondencias = rows.map(resumirCliente).filter(c => normalizar(c.nome).includes(normalizar(cliente)));
  const exatos = correspondencias.filter(c => normalizar(c.nome) === normalizar(cliente));
  const candidatos = exatos.length ? exatos : correspondencias;
  const distintos = [...new Map(candidatos.map(c => [String(c.favorecido) + ':' + c.nome, c])).values()];
  if (!distintos.length) return { encontrado: false };
  if (distintos.length !== 1) return {
    encontrado: true, necessita_escolha_cliente: true,
    total_clientes: distintos.length, clientes: distintos.slice(0, 30)
  };
  const escolhido = distintos[0];
  validar(Number.isSafeInteger(Number(escolhido.favorecido)) && Number(escolhido.favorecido) > 0,
    'O cadastro não retornou código válido do cliente.');
  return { encontrado: true, cliente: { ...escolhido, favorecido: Number(escolhido.favorecido) } };
}
function adaptarHistorico(p, cliente) {
  return {
    ...p, idMestre: p?.idMestre ?? p?.saida ?? null,
    cliente: {
      ...cliente, ...p?.cliente,
      favorecido: p?.cliente?.favorecido ?? p?.favorecido ?? cliente.favorecido,
      nome: texto(p?.cliente?.nome || p?.clienteNome) || cliente.nome
    },
    vendedor: p?.vendedor || { nome: texto(p?.VendedorNome || p?.vendedorNome) },
    carradaAtual: p?.carradaAtual || (p?.carradaCodigo ? {
      codigo: p.carradaCodigo, data: p.carradaData ?? null, descricao: texto(p.carradaDescricao)
    } : null)
  };
}
async function mapearLimitado(itens, worker) {
  const resultado = new Array(itens.length);
  let indice = 0;
  await Promise.all(Array.from({ length: Math.min(4, itens.length) }, async () => {
    while (indice < itens.length) {
      const atual = indice++;
      resultado[atual] = await worker(itens[atual]);
    }
  }));
  return resultado;
}
function criarEnriquecedor() {
  const cacheCarradas = new Map();
  async function pelaCarrada(p) {
    const codigo = Number(p?.carradaAtual?.codigo);
    if (!Number.isSafeInteger(codigo) || codigo <= 0) return p;
    if (!cacheCarradas.has(codigo)) {
      cacheCarradas.set(codigo, carradas.buscarResumoCarrada(codigo).catch(() => null));
    }
    const carrada = await cacheCarradas.get(codigo);
    const rows = Array.isArray(carrada?.pedidos) ? carrada.pedidos : [];
    const id = texto(idPedido(p));
    const porId = id ? rows.filter(item => texto(idPedido(item)) === id) : [];
    const porNumero = rows.filter(item => texto(item?.numero) === texto(p.numero)
      && (!id || !texto(idPedido(item))));
    // O id interno prevalece; nunca escolher arbitrariamente um número duplicado.
    const encontrados = porId.length ? porId : porNumero;
    if (encontrados.length !== 1) return p;
    const exp = expedicao(encontrados[0]);
    return exp.disponivel ? { ...p, dataExpedicao: exp.data, dataExpedicaoDisponivel: true } : p;
  }
  return async (p, consultarDetalhe = true) => {
    if (expedicao(p).disponivel) return p;
    let atual = await pelaCarrada(p);
    if (expedicao(atual).disponivel) return atual;
    if (!consultarDetalhe) return atual;
    const id = Number(idPedido(p));
    if (!Number.isSafeInteger(id) || id <= 0) return atual;
    try {
      const detalhe = await legado.buscarDetalhePedido(id);
      if (!detalhe || (idPedido(detalhe) != null && texto(idPedido(detalhe)) !== texto(idPedido(p)))) return atual;
      const exp = expedicao(detalhe);
      atual = {
        ...atual, carradaAtual: detalhe.carradaAtual || atual.carradaAtual,
        ...(exp.disponivel ? { dataExpedicao: exp.data, dataExpedicaoDisponivel: true } : {})
      };
      return exp.disponivel ? atual : pelaCarrada(atual);
    } catch (_) {
      // Falha de leitura não é prova de que o pedido ainda não foi expedido.
      return atual;
    }
  };
}

async function consultarPedidos({
  numero, cliente, favorecido, data, limite = 15, pagina = 1,
  incluir_cancelados = true, ultimo = false, sem_data_expedicao = false
} = {}) {
  for (const [nome, valor] of Object.entries({ numero, cliente, data })) {
    validar(valor === undefined || typeof valor === 'string', 'Filtro inválido: ' + nome + '.');
  }
  const filtros = { numero: texto(numero), cliente: texto(cliente), data: texto(data) };
  validar(filtros.numero || filtros.cliente || filtros.data || favorecido !== undefined,
    'Informe o número, o cliente ou a data para consultar pedidos.');
  validar(filtros.numero.length <= 40 && filtros.cliente.length <= 120, 'Filtro de consulta muito longo.');
  validar(!filtros.cliente || filtros.cliente.length >= 3, 'Informe pelo menos três caracteres do cliente.');
  if (filtros.data) filtros.data = dataIso(filtros.data);
  validar(Number.isInteger(limite) && limite >= 1 && limite <= 30, 'Limite permitido: de 1 a 30 pedidos.');
  validar(Number.isInteger(pagina) && pagina >= 1 && pagina <= 100000, 'Página inválida.');
  validar(typeof incluir_cancelados === 'boolean', 'incluir_cancelados deve ser booleano.');
  validar(typeof ultimo === 'boolean', 'ultimo deve ser booleano.');
  validar(typeof sem_data_expedicao === 'boolean', 'sem_data_expedicao deve ser booleano.');
  validar(!ultimo || pagina === 1, 'A consulta do último pedido usa somente a página 1.');

  let encontrados;
  let clienteResolvido = null;
  let origemIncompleta = false;
  let totalOrigem = null;
  if (filtros.cliente || favorecido !== undefined) {
    const resolucao = await resolverCliente({ cliente: filtros.cliente, favorecido });
    if (!resolucao.encontrado || resolucao.necessita_escolha_cliente) return {
      filtros, cliente_encontrado: resolucao.encontrado,
      necessita_escolha_cliente: Boolean(resolucao.necessita_escolha_cliente),
      ...(resolucao.necessita_escolha_cliente ? {
        total_clientes: resolucao.total_clientes, clientes: resolucao.clientes,
        instrucao: 'Escolha o código favorecido do cliente; não misture pedidos de pessoas diferentes.'
      } : {}),
      encontrados: 0, exibindo: 0, pedidos: [], somente_leitura: true
    };
    clienteResolvido = resolucao.cliente;
    filtros.favorecido = clienteResolvido.favorecido;
    const resposta = await historico.listarPedidosPorCliente(clienteResolvido.favorecido);
    validar(Array.isArray(resposta?.dados), 'O histórico do cliente retornou formato inesperado.');
    const codigoResposta = resposta?.cliente?.favorecido;
    validar(codigoResposta == null || Number(codigoResposta) === clienteResolvido.favorecido,
      'A origem retornou histórico de outro cliente. A consulta foi interrompida.');
    validar(resposta.dados.every(p => {
      const codigo = p?.cliente?.favorecido ?? p?.favorecido;
      return codigo == null || Number(codigo) === clienteResolvido.favorecido;
    }), 'A origem misturou pedidos de clientes diferentes. A consulta foi interrompida.');
    encontrados = resposta.dados.map(p => adaptarHistorico(p, clienteResolvido));
    origemIncompleta = resposta.consultaIncompleta === true;
    totalOrigem = resposta.totalOrigem ?? null;
  } else {
    encontrados = await legado.pesquisarPedidos(filtros);
    validar(Array.isArray(encontrados), 'A consulta de pedidos retornou formato inesperado.');
  }
  let filtrados = encontrados.filter(p =>
    (!filtros.numero || texto(p?.numero).toUpperCase().startsWith(filtros.numero.toUpperCase())) &&
    (!filtros.data || texto(p?.data).slice(0, 10) === filtros.data) &&
    (incluir_cancelados || !situacaoCancelada(p))
  ).sort(maisRecentes);
  const semOrdemCadastro = filtrados.filter(p => ordemCadastro(p) === null).length;
  const enriquecer = criarEnriquecedor();
  let expedicaoNaoVerificada = 0;
  if (sem_data_expedicao) {
    filtrados = await mapearLimitado(filtrados, enriquecer);
    expedicaoNaoVerificada = filtrados.filter(p => !expedicao(p).disponivel).length;
    filtrados = filtrados.filter(p => {
      const exp = expedicao(p);
      return exp.disponivel && exp.data === null;
    });
  }
  const total = filtrados.length;
  const inicio = ultimo ? 0 : (pagina - 1) * limite;
  const tamanho = ultimo ? 1 : limite;
  let selecionados = filtrados.slice(inicio, inicio + tamanho);
  if (!sem_data_expedicao) selecionados = await mapearLimitado(selecionados, enriquecer);
  const completo = !origemIncompleta && expedicaoNaoVerificada === 0 && (!ultimo || semOrdemCadastro === 0);
  const temMais = !ultimo && inicio + selecionados.length < total;
  const avisos = [];
  if (origemIncompleta) avisos.push('A origem indicou histórico incompleto. Não afirmar que estes são todos os pedidos nem garantir o último cadastro.');
  if (expedicaoNaoVerificada) avisos.push('Há pedidos cuja data de expedição não pôde ser verificada. Eles não foram classificados como sem data.');
  if (ultimo && semOrdemCadastro) avisos.push('A origem omitiu a chave de cadastro de alguns pedidos; não é possível garantir qual é o último.');
  return {
    filtros: { ...filtros, incluir_cancelados, ultimo, sem_data_expedicao },
    ...(clienteResolvido ? { cliente: clienteResolvido } : {}),
    fonte: clienteResolvido ? 'historico_por_cliente' : 'pesquisa_pedidos',
    ordenacao: 'id_mestre_decrescente_ordem_de_cadastro',
    encontrados: total, total_origem: totalOrigem,
    exibindo: selecionados.length, pagina, limite: tamanho,
    tem_mais: temMais, proxima_pagina: temMais ? pagina + 1 : null,
    resultado_completo: completo,
    ultimo_pedido_confirmado: ultimo ? completo && selecionados.length === 1 : null,
    expedicao_nao_verificada: expedicaoNaoVerificada,
    avisos, pedidos: selecionados.map(cabecalho), somente_leitura: true
  };
}

async function detalharPedido({ id_mestre } = {}) {
  validar(Number.isSafeInteger(id_mestre) && id_mestre > 0, 'Informe o ID real do pedido, como número inteiro.');
  const p = await legado.buscarDetalhePedido(id_mestre);
  if (!p) return { encontrado: false, id_mestre, pedido: null, somente_leitura: true };
  const enriquecido = await criarEnriquecedor()(p, false);
  return {
    encontrado: true,
    pedido: {
      ...cabecalho(enriquecido), observacao: texto(p.obs) || null,
      itens: (Array.isArray(p.itens) ? p.itens : []).map(i => ({
        codigo: i.item ?? null, descricao: texto(i.descricao),
        quantidade: numeroOpcional(i.quantidade), preco_unitario: numeroOpcional(i.preco),
        subtotal: numeroOpcional(i.subtotal)
      }))
    },
    somente_leitura: true
  };
}
module.exports = { buscarCarradas, consultarPedidos, detalharPedido };

