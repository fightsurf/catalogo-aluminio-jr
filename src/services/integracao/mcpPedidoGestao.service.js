'use strict';

// Adaptadores: as gravações continuam nas mesmas rotinas da tela de pedidos
// e da tela Progresso. A prévia apenas lê e descreve seus efeitos.
const crypto = require('crypto');
const pedidos = require('../legado/pedido/pedidosLegado.service');
const vendedores = require('../legado/vendedores/vendedores.service');
const produtos = require('../produto/produto.service');
const carradas = require('../legado/carradas/carradas.service');
const progresso = require('../legado/carradas-progresso/carradas-progresso.service');
const controleWhatsapp = require('../whatsapp/central-controle.service');
const pagamentos = require('../legado/pagamentos/pagamentos.service');

function falhar(mensagem) { const e = new Error(mensagem); e.isValidation = true; throw e; }
function texto(v) { return String(v ?? '').trim(); }
function inteiro(v, nome) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) falhar(`Informe ${nome} como código inteiro real.`);
  return v;
}
function decimal(v, nome, minimo = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < minimo || v > 10000000) falhar(`Valor inválido: ${nome}.`);
  return v;
}
function dataCivil(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) falhar('Data inválida. Use AAAA-MM-DD.');
  const d = new Date(v + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v) falhar('Data inválida.');
  return v;
}
function dataBR(v) { const s = dataCivil(v); return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`; }
function resumoPedido(p) {
  return {
    id_mestre: Number(p.idMestre), numero: texto(p.numero), cliente: p.cliente,
    vendedor: p.vendedor, data: p.data, situacao: p.situacao,
    observacao: texto(p.obs), total: Number(p.total),
    total_pago: p.financeiroVerificado ? Number(p.totalPago) : null,
    financeiro_verificado: p.financeiroVerificado === true, carrada: p.carradaAtual || null,
    itens: (p.itens || []).map(i => ({ item_legado: Number(i.item), descricao: i.descricao,
      quantidade: Number(i.quantidade), preco: Number(i.preco), subtotal: Number(i.subtotal) }))
  };
}
function assinatura(p) {
  return crypto.createHash('sha256').update(JSON.stringify({
    ...resumoPedido(p), total_pago: Number(p.totalPago || 0),
    data_expedicao: p.dataExpedicao, data_cancelamento: p.dataCancelamento
  })).digest('hex');
}
function avisoSeguro(aviso) {
  if (!aviso) return null;
  const aceito = aviso.success === true || aviso.enviado === true;
  return {
    success: aceito, enviado: aceito,
    status: aceito ? 'aceito_pelo_provedor' : 'envio_nao_confirmado',
    motivo: aceito ? null : aviso.motivo === 'sem_telefone' ? 'sem_telefone' : 'conferir_aviso_sem_repetir',
    idMensagem: typeof aviso.idMensagem === 'string' ? aviso.idMensagem : null,
    entrega_confirmada: false
  };
}
function notificacoesSeguras(lista) {
  return (Array.isArray(lista) ? lista : []).map(n => ({
    tipo: ['entrada', 'saida'].includes(n.tipo) ? n.tipo : 'aviso', resultado: avisoSeguro(n.resultado)
  }));
}
async function carregarPedido(id, verificarFinanceiro = false) {
  inteiro(id, 'id_mestre');
  const p = await pedidos.buscarDetalhePedido(id);
  if (!p || Number(p.idMestre) !== id || !texto(p.numero)) falhar('Pedido não encontrado. Consulte o id_mestre antes da ação.');
  if (['C', 'CANCELADO', 'CANCELADA'].includes(texto(p.situacao).toUpperCase()) || p.dataCancelamento) falhar('O pedido está cancelado.');
  const pedido = { ...p, idMestre: id };
  if (verificarFinanceiro) {
    // Usa a mesma consulta financeira da tela, incluindo baixas/créditos.
    // Campo omitido ou erro de leitura nunca é interpretado como pagamento zero.
    let rows;
    try { rows = await pagamentos.listarPedidosPorNumero(texto(p.numero)); }
    catch (_) { falhar('Não foi possível verificar os pagamentos. Nenhuma alteração foi preparada.'); }
    const exatos = (Array.isArray(rows) ? rows : []).filter(r =>
      Number(r.saida ?? r.SAIDA ?? r.idMestre ?? r.IDMESTRE) === id
      && texto(r.numero ?? r.NUMERO) === texto(p.numero));
    if (exatos.length !== 1) falhar('Não foi possível verificar os pagamentos deste pedido. Confira a tela de pagamentos antes da alteração.');
    if (exatos[0].baixadoParaCredito === true || texto(exatos[0].statusFinanceiro).toUpperCase() === 'BAIXA_PARA_CREDITO') {
      falhar('Pedido com baixa para crédito não pode ser alterado ou cancelado pelo MCP. Revise o vínculo financeiro no sistema.');
    }
    const bruto = exatos[0].totalPago ?? exatos[0].total_pago ?? exatos[0].TOTAL_PAGO;
    if (bruto === undefined || bruto === null || texto(bruto) === '' ||
        !Number.isFinite(Number(bruto)) || Number(bruto) < 0) falhar('O resumo financeiro não informou um valor pago válido.');
    pedido.totalPago = Number(bruto);
    pedido.financeiroVerificado = true;
  }
  return pedido;
}
async function revalidar(payload) {
  const p = await carregarPedido(payload.id_mestre, payload.financeiro === true);
  if (assinatura(p) !== payload.assinatura) falhar('O pedido mudou depois da prévia. Prepare uma nova ação e confirme o novo resumo.');
  return p;
}

async function montarItens(entradas) {
  if (!Array.isArray(entradas) || !entradas.length || entradas.length > 100) falhar('Informe de 1 a 100 itens na lista completa do pedido.');
  const vistos = new Set();
  const itens = [];
  const referencias = [];
  for (const entrada of entradas) {
    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
        Object.keys(entrada).some(k => !['produto_id', 'quantidade', 'preco'].includes(k))) falhar('Item de alteração inválido.');
    const id = inteiro(entrada.produto_id, 'produto_id');
    if (vistos.has(id)) falhar('Agrupe produtos repetidos em uma única linha.');
    vistos.add(id);
    const quantidade = decimal(entrada.quantidade, 'quantidade', 0.000001);
    const produto = await produtos.buscar(id);
    if (!produto || produto.ativo === false || !produto.item_legado) falhar('Produto inativo, inexistente ou sem vínculo com o legado.');
    const referencia = Number(produto.preco);
    if (!Number.isFinite(referencia) || referencia <= 0) falhar('Produto sem preço de referência válido.');
    const preco = entrada.preco === undefined ? referencia : decimal(entrada.preco, 'preco');
    if (Math.abs(preco * 100 - Math.round(preco * 100)) > 0.000001) falhar('Informe preço com até duas casas decimais.');
    itens.push({ item: Number(produto.item_legado), descricao: texto(produto.nome), quantidade, preco });
    referencias.push({ produto_id: id, item_legado: Number(produto.item_legado), preco });
  }
  return { itens, referencias };
}

async function prepararAlteracao(args = {}) {
  const p = await carregarPedido(args.id_mestre, true);
  const campos = ['data', 'vendedor', 'observacao', 'itens', 'carrada_codigo'];
  if (!campos.some(k => Object.prototype.hasOwnProperty.call(args, k))) falhar('Informe ao menos uma alteração.');
  const payload = { id_mestre: p.idMestre, financeiro: true, assinatura: assinatura(p), referencias: [] };
  const gravar = {
    vendedor: Number(p.vendedor?.favorecido), obs: texto(p.obs),
    itens: (p.itens || []).map(i => ({ item: Number(i.item), descricao: texto(i.descricao),
      quantidade: Number(i.quantidade), preco: Number(i.preco) }))
  };
  if (args.data !== undefined) gravar.data = dataCivil(args.data);
  if (args.vendedor !== undefined) {
    const id = inteiro(args.vendedor, 'vendedor');
    const vendedor = await vendedores.buscarVendedor(id);
    if (!vendedor) falhar('Vendedor não encontrado.');
    gravar.vendedor = id;
    payload.vendedor_nome = texto(vendedor.nome || vendedor.razao_social);
  }
  if (!Number.isSafeInteger(gravar.vendedor) || gravar.vendedor < 1) falhar('O pedido não informa o vendedor. Consulte e informe um código de vendedor.');
  if (args.observacao !== undefined) {
    if (typeof args.observacao !== 'string' || args.observacao.length > 1000) falhar('Observação inválida (máximo 1000 caracteres).');
    gravar.obs = args.observacao.trim();
  }
  if (args.itens !== undefined) {
    const novo = await montarItens(args.itens);
    gravar.itens = novo.itens;
    payload.referencias = novo.referencias;
  }
  if (!gravar.itens.length || gravar.itens.some(i => !Number.isSafeInteger(i.item) || i.item < 1 ||
      !Number.isFinite(i.quantidade) || i.quantidade <= 0 || !Number.isFinite(i.preco) || i.preco < 0)) falhar('O pedido contém itens sem dados válidos para edição.');
  const total = Math.round(gravar.itens.reduce((s, i) => s + i.quantidade * i.preco, 0) * 100) / 100;
  if (!Number.isFinite(total) || total > 10000000) falhar('Total da alteração fora do limite.');
  if (Number(p.totalPago) > total) falhar('O novo total ficaria abaixo do valor já pago. Revise o pedido no sistema.');
  if (Object.prototype.hasOwnProperty.call(args, 'carrada_codigo')) {
    const codigo = args.carrada_codigo === null ? null : inteiro(args.carrada_codigo, 'carrada_codigo');
    if (String(codigo || '') !== String(p.carradaAtual?.codigo || '')) {
      const disponiveis = await pedidos.listarCarradasDisponiveis(p.idMestre);
      const destino = codigo === null ? null : (disponiveis.carradas || []).find(c => Number(c.codigo) === codigo);
      if (codigo !== null && !destino) falhar('Carrada indisponível para este pedido.');
      payload.alterar_carrada = true;
      payload.carrada_codigo = codigo;
      payload.carrada_destino = destino;
    }
  }
  payload.gravar = gravar;
  return { payload, resumo: {
    acao: 'alterar_pedido', pedido_atual: resumoPedido(p),
    proposto: { data: gravar.data || p.data, vendedor: gravar.vendedor,
      vendedor_nome: payload.vendedor_nome || p.vendedor?.nome, observacao: gravar.obs,
      itens: gravar.itens, total,
      carrada: payload.alterar_carrada ? payload.carrada_destino : p.carradaAtual || null },
    lista_de_itens_substituida: args.itens !== undefined,
    aviso_whatsapp: payload.alterar_carrada
      ? 'A mudança de carrada também usa os avisos automáticos de saída/entrada da tela de pedidos.' : null,
    regra: 'A gravação usa a rotina existente de edição e preserva seus bloqueios.'
  }};
}

async function executarAlteracao(payload, { registrarProgresso }) {
  await revalidar(payload);
  for (const r of payload.referencias) {
    const produto = await produtos.buscar(r.produto_id);
    if (!produto || produto.ativo === false || Number(produto.item_legado) !== r.item_legado ||
        !Number.isFinite(Number(produto.preco)) || Number(produto.preco) > r.preco) falhar('Produto ou preço mudou depois da prévia. Refaça a alteração.');
  }
  if (payload.alterar_carrada && payload.carrada_codigo !== null) {
    const atuais = await pedidos.listarCarradasDisponiveis(payload.id_mestre);
    if (!(atuais.carradas || []).some(c => Number(c.codigo) === payload.carrada_codigo)) falhar('A carrada deixou de estar disponível.');
  }
  await registrarProgresso({ etapa: 'alterar_pedido', estado: 'iniciando' });
  const atualizado = await pedidos.atualizarPedido(payload.id_mestre, payload.gravar);
  if (!atualizado || Number(atualizado.idMestre) !== payload.id_mestre) throw new Error('Alteração sem retorno identificável.');
  await registrarProgresso({ etapa: 'alterar_pedido', estado: 'confirmado', numero: atualizado.numero });
  let carrada = null;
  if (payload.alterar_carrada) {
    await registrarProgresso({ etapa: 'alterar_carrada_e_avisos', estado: 'iniciando' });
    carrada = await pedidos.alterarCarradaPedido(payload.id_mestre, payload.carrada_codigo);
    if (String(carrada?.carradaAtual?.codigo || '') !== String(payload.carrada_codigo || '')) throw new Error('Vínculo de carrada não confirmado.');
    carrada.notificacoes = notificacoesSeguras(carrada.notificacoes);
    await registrarProgresso({ etapa: 'alterar_carrada_e_avisos', estado: 'confirmado', notificacoes: carrada.notificacoes });
  }
  const avisosFalharam = (carrada?.notificacoes || []).some(n => n.resultado?.success !== true);
  return { status: avisosFalharam ? 'parcial' : 'alterado', pedido_alterado: true,
    pedido: resumoPedido({ ...atualizado,
    carradaAtual: carrada ? carrada.carradaAtual : atualizado.carradaAtual }),
    notificacoes: carrada?.notificacoes || [], entrega_whatsapp_confirmada: false };
}

async function prepararCancelamento(args = {}) {
  const p = await carregarPedido(args.id_mestre, true);
  if (typeof args.motivo !== 'string' || !args.motivo.trim() || args.motivo.length > 250) falhar('Informe o motivo do cancelamento (até 250 caracteres).');
  return { payload: { id_mestre: p.idMestre, financeiro: true, assinatura: assinatura(p), motivo: args.motivo.trim() },
    resumo: { acao: 'cancelar_pedido', pedido: resumoPedido(p), motivo: args.motivo.trim(),
      efeito: 'Cancelar este pedido usando a mesma rotina do sistema. Os bloqueios do legado continuam aplicados.' } };
}
async function executarCancelamento(payload, { registrarProgresso }) {
  await revalidar(payload);
  await registrarProgresso({ etapa: 'cancelar_pedido', estado: 'iniciando' });
  const p = await pedidos.cancelarPedido(payload.id_mestre, { motivo: payload.motivo });
  if (!p || Number(p.idMestre) !== payload.id_mestre ||
      !['C', 'CANCELADO', 'CANCELADA'].includes(texto(p.situacao).toUpperCase())) throw new Error('Cancelamento sem estado final confirmado.');
  await registrarProgresso({ etapa: 'cancelar_pedido', estado: 'confirmado', numero: p.numero });
  return { status: 'cancelado', pedido: resumoPedido(p), motivo: payload.motivo };
}

async function carregarExpedicao(p, codigo) {
  const c = await carradas.buscarResumoCarrada(codigo);
  if (!c) falhar('Carrada não encontrada.');
  const encontrados = (c.pedidos || []).filter(i => String(i.numero) === String(p.numero));
  if (encontrados.length !== 1) falhar('O número do pedido está ausente ou ambíguo na carrada. Confira os identificadores na tela Progresso.');
  const encontrado = encontrados[0];
  const saida = encontrado.saida ?? encontrado.idMestre ?? encontrado.id_mestre;
  if (saida != null && Number(saida) !== Number(p.idMestre)) falhar('Os identificadores do pedido e da carrada não conferem.');
  if (!Object.prototype.hasOwnProperty.call(encontrado, 'dataExpedicao') || encontrado.dataExpedicao === undefined || encontrado.dataExpedicaoDisponivel === false) falhar('O legado não informou a data atual de expedição. Confira a tela Progresso.');
  return { data_atual: texto(encontrado.dataExpedicao), carrada: { codigo, data: c.data, descricao: c.descricao } };
}
async function prepararExpedicao(args = {}) {
  const p = await carregarPedido(args.id_mestre);
  const codigo = args.carrada_codigo === undefined ? Number(p.carradaAtual?.codigo) : inteiro(args.carrada_codigo, 'carrada_codigo');
  if (!Number.isSafeInteger(codigo) || codigo < 1) falhar('O pedido precisa estar vinculado a uma carrada.');
  if (p.carradaAtual?.codigo && Number(p.carradaAtual.codigo) !== codigo) falhar('A carrada informada difere da carrada do pedido.');
  const atual = await carregarExpedicao(p, codigo);
  const proposta = dataBR(args.data_expedicao);
  if (atual.data_atual === proposta) falhar('Essa data já está registrada. A mesma ação não será preparada para reenviar avisos.');
  return { payload: { id_mestre: p.idMestre, numero: p.numero, assinatura: assinatura(p),
      carrada_codigo: codigo, data_atual: atual.data_atual, data_expedicao: proposta },
    resumo: { acao: 'expedicao_pedido', pedido: resumoPedido(p), carrada: atual.carrada,
      data_atual: atual.data_atual || null, data_proposta: proposta,
      aviso_whatsapp: 'A confirmação executa a ação completa da tela Progresso: registra a data e tenta enviar a notificação e o áudio automáticos conforme a configuração existente.',
      envio_em_lote: false } };
}
async function executarExpedicao(payload, { registrarProgresso }) {
  const p = await revalidar(payload);
  const atual = await carregarExpedicao(p, payload.carrada_codigo);
  if (atual.data_atual !== payload.data_atual) falhar('A data de expedição mudou depois da prévia. Prepare uma nova ação.');
  await registrarProgresso({ etapa: 'registrar_expedicao_e_aviso', estado: 'iniciando' });
  const resultado = await controleWhatsapp.comFuncionalidade('progresso_producao', () => progresso.salvarDataExpedicao({
    codigoCarrada: payload.carrada_codigo, numeroPedido: payload.numero,
    dataExpedicao: payload.data_expedicao, silencioso: false
  }));
  if (resultado?.dataExpedicao !== payload.data_expedicao || !resultado.concluido) throw new Error('Data de expedição não confirmada pelo legado.');
  const seguro = { numeroPedido: payload.numero, concluido: true, dataExpedicao: resultado.dataExpedicao,
    notificacao: avisoSeguro(resultado.notificacao), audio: avisoSeguro(resultado.audio) };
  const avisoFalhou = [seguro.notificacao, seguro.audio].some(a => a && a.success !== true);
  await registrarProgresso({ etapa: 'registrar_expedicao_e_aviso', estado: 'confirmado', resultado: seguro });
  return { status: avisoFalhou ? 'parcial' : 'expedicao_registrada', data_registrada: true,
    id_mestre: payload.id_mestre, numero: payload.numero, carrada_codigo: payload.carrada_codigo, ...seguro,
    entrega_whatsapp_confirmada: false,
    observacao: avisoFalhou
      ? 'A data foi registrada, mas há aviso sem envio confirmado. Não repetir a ação; conferir notificacao/audio.'
      : 'A data foi registrada. Consulte notificacao/audio para o resultado dos avisos; aceitação não comprova entrega.' };

}

module.exports = { prepararAlteracao, executarAlteracao, prepararCancelamento, executarCancelamento,
  prepararExpedicao, executarExpedicao };
