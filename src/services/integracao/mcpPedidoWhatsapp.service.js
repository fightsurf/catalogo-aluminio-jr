'use strict';

// Adaptador do MCP para as mesmas ações usadas nas telas de pedidos.
// A reserva atômica/confirmação pertence a mcpAcoesConfirmadas: este módulo nunca é uma rota pública.
const crypto = require('node:crypto');
const { setTimeout: aguardar } = require('node:timers/promises');
const pedidos = require('../legado/pedido/pedidosLegado.service');
const mensagens = require('../../../public/js/pedido-mensagem-whatsapp');
const { montarMensagemEntradaCarrada } = require('../legado/pedidos-insercao-v2/mensagem-entrada-carrada');
const envio = require('../whatsapp/envio-whatsapp.service');
const fotos = require('../whatsapp/relatorio-fotos-whatsapp.service');
const controle = require('../whatsapp/central-controle.service');
const pdf = require('../legado/pedido/pedidoPdf.service');
const resumoIA = require('../legado/pedido/resumo-pedido-ia.service');
const vozConfig = require('../legado/pedido/resumo-pedido-voz-config.service');
const eleven = require('../integracoes/elevenlabs-jr.service');

const TIPOS = ['texto', 'fotos', 'pdf', 'audio_ia', 'aviso_carrada'];
const MAX_BYTES = 5 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;
const FUNCOES = { texto: ['pedidos_texto'], aviso_carrada: ['pedidos_texto'], fotos: ['pedidos_fotos', 'pedidos_fotos_finalizacao'],
  pdf: ['pedidos_pdf'], audio_ia: ['envio_manual'] };

function falhar(mensagem) { const e = new Error(mensagem); e.isValidation = true; throw e; }
function texto(v) { return String(v ?? '').trim(); }
function hash(v) { return crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex'); }
function idPedido(valor) {
  if (!['number', 'string'].includes(typeof valor) || !/^\d+$/.test(String(valor))) falhar('Informe o id_mestre real do pedido.');
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id < 1) falhar('Informe o id_mestre real do pedido.');
  return id;
}
function telefonePedido(pedido) {
  let telefone = texto(pedido?.cliente?.telefonePrincipal || pedido?.cliente?.telefone1 || pedido?.cliente?.fone1)
    .replace(/\D/g, '');
  if (/^\d{10,11}$/.test(telefone)) telefone = '55' + telefone;
  if (!/^55[1-9]\d{9,10}$/.test(telefone)) falhar('O cliente do pedido não possui telefone brasileiro válido. Corrija o cadastro antes do envio.');
  return telefone;
}
function validarPedido(pedido, id) {
  if (!pedido || Number(pedido.idMestre ?? pedido.saida) !== id) falhar('Pedido não encontrado ou identificador divergente.');
  if (!texto(pedido.numero) || !texto(pedido.cliente?.nome) || !Number.isSafeInteger(Number(pedido.cliente?.favorecido)) || Number(pedido.cliente?.favorecido) < 1) {
    falhar('O pedido não identifica um único cliente cadastrado.');
  }
  if (['C', 'CANCELADO', 'CANCELADA'].includes(texto(pedido.situacao).toUpperCase()) || pedido.dataCancelamento) {
    falhar('Pedido cancelado não pode ser enviado pelo WhatsApp.');
  }
  if (!Array.isArray(pedido.itens) || !pedido.itens.length || pedido.itens.length > 100) falhar('O pedido deve conter de 1 a 100 itens para este envio.');
  if (!Number.isFinite(Number(pedido.total)) || Number(pedido.total) < 0) falhar('Total do pedido inválido.');
  return telefonePedido(pedido);
}
function retrato(pedido, telefone) {
  return { id_mestre: Number(pedido.idMestre ?? pedido.saida), numero: texto(pedido.numero),
    situacao: texto(pedido.situacao), data: pedido.data || null, total: Number(pedido.total),
    volumes: pedido.volumes, observacao: texto(pedido.obs), carrada: pedido.carradaAtual || null,
    cliente: pedido.cliente, vendedor: pedido.vendedor, telefone,
    itens: pedido.itens.map(i => ({ item: i.item, saidaItem: i.saidaItem, descricao: i.descricao,
      quantidade: Number(i.quantidade), preco: Number(i.preco), subtotal: Number(i.subtotal) })) };
}
async function carregar(id) {
  const pedido = await pedidos.buscarDetalhePedido(id);
  const telefone = validarPedido(pedido, id);
  return { pedido, telefone, assinatura: hash(retrato(pedido, telefone)) };
}
function carradaDoAviso(pedido) {
  const carrada = pedido.carradaAtual;
  if (!carrada || typeof carrada !== 'object' || Array.isArray(carrada) ||
      !['number', 'string'].includes(typeof carrada.codigo) || !/^\d+$/.test(String(carrada.codigo)) ||
      !Number.isSafeInteger(Number(carrada.codigo)) || Number(carrada.codigo) < 1) {
    falhar('O aviso exige um pedido já gravado com carrada válida vinculada.');
  }
  const dataOriginal = carrada.data;
  if (typeof dataOriginal !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(dataOriginal) ||
      !Number.isFinite(new Date(dataOriginal).getTime())) falhar('A carrada do pedido não possui uma data válida para o aviso.');
  const data = dataOriginal.slice(0, 10);
  const dataValidada = new Date(data + 'T00:00:00Z');
  if (!Number.isFinite(dataValidada.getTime()) || dataValidada.toISOString().slice(0, 10) !== data) {
    falhar('A carrada do pedido não possui uma data válida para o aviso.');
  }
  if (carrada.descricao !== undefined && carrada.descricao !== null && typeof carrada.descricao !== 'string') {
    falhar('A descrição da carrada do pedido é inválida.');
  }
  return { codigo: Number(carrada.codigo), data, descricao: texto(carrada.descricao) || '-' };
}
async function controles(tipo) {
  for (const funcionalidade of FUNCOES[tipo]) await controle.verificar(funcionalidade);
}
function planoFotos(analise) {
  if (analise?.prontoParaEnvio !== true || !Array.isArray(analise.itens) || !analise.itens.length) {
    const pendencias = (analise?.pendencias || []).slice(0, 10).map(i => `${texto(i.nome)}: ${texto(i.problema)}`).join('; ');
    falhar('Envio bloqueado: todos os itens precisam de produto e foto válidos.' + (pendencias ? ' ' + pendencias : ''));
  }
  return { total: analise.totalFinal, quantidadeProdutos: analise.itens.length,
    itens: analise.itens.map(i => ({ produtoId: i.produtoId, descricao: i.descricao, foto: i.foto,
      quantidade: i.quantidadeFinal, unitario: i.unitario, subtotal: i.subtotalFinal })) };
}
async function analisarFotos(pedido) {
  return planoFotos(await fotos.analisarRelatorio({ itensPedido: pedido.itens, totalPedido: pedido.total, multiplicador: 1 }));
}
function guardarBinario(bytes, nome) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) falhar(`${nome} vazio ou acima do limite de 5 MB.`);
  return { base64: bytes.toString('base64'), sha256: hash(bytes.toString('base64')), tamanho: bytes.length };
}
function lerBinario(arquivo, nome) {
  if (!arquivo || typeof arquivo.base64 !== 'string' || arquivo.base64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(arquivo.base64) || hash(arquivo.base64) !== arquivo.sha256) falhar(`${nome} da prévia inválido.`);
  const bytes = Buffer.from(arquivo.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.length !== arquivo.tamanho) falhar(`${nome} da prévia inválido.`);
  return bytes;
}

async function prepararEnvio(args = {}, contexto = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(k => !['id_mestre', 'tipo', 'mensagem'].includes(k))) falhar('Parâmetros de envio inválidos.');
  const id = idPedido(args.id_mestre);
  const tipo = args.tipo;
  if (!TIPOS.includes(tipo)) falhar('Tipo de envio inválido: use texto, fotos, pdf, audio_ia ou aviso_carrada.');
  if (args.mensagem !== undefined && tipo !== 'texto') falhar('Mensagem personalizada só se aplica ao envio de texto.');
  if (args.mensagem !== undefined && typeof args.mensagem !== 'string') falhar('Mensagem deve ser texto.');
  const { pedido, telefone, assinatura } = await carregar(id);
  await controles(tipo);
  const payload = { versao: 1, id_mestre: id, tipo, telefone, assinatura,
    expira_em: new Date(Date.now() + TTL_MS).toISOString() };
  const resumo = { acao: 'enviar_whatsapp_pedido', tipo, pedido: { id_mestre: id, numero: texto(pedido.numero), total: Number(pedido.total) },
    cliente: { favorecido: pedido.cliente.favorecido, nome: pedido.cliente.nome },
    destinatario: { telefone, final: telefone.slice(-4) },
    expira_em: payload.expira_em, confirmacao_obrigatoria: true,
    aviso: 'A confirmação enviará apenas ao cliente deste pedido. Aceitação do provedor não comprova entrega.' };

  if (tipo === 'aviso_carrada') {
    payload.carrada = carradaDoAviso(pedido);
    payload.mensagem = montarMensagemEntradaCarrada({ cliente: pedido.cliente, numeroPedido: texto(pedido.numero), carrada: payload.carrada });
    if (payload.mensagem.length > 16000) falhar('O aviso da carrada excede o limite de 16000 caracteres.');
    resumo.carrada = payload.carrada;
    resumo.mensagem = payload.mensagem;
  } else if (tipo === 'texto') {
    payload.mensagem = args.mensagem === undefined ? mensagens.montarMensagem(pedido) : texto(args.mensagem);
    if (!payload.mensagem || payload.mensagem.length > 16000) falhar('O texto deve conter entre 1 e 16000 caracteres.');
    resumo.mensagem = payload.mensagem;
  } else if (tipo === 'fotos') {
    payload.fotos = await analisarFotos(pedido);
    resumo.fotos = payload.fotos;
    resumo.resumo_final = { produtos: payload.fotos.quantidadeProdutos, multiplicador: 1, total: payload.fotos.total };
  } else if (tipo === 'pdf') {
    payload.documento = guardarBinario(pdf.gerarPdfPedido(pedido), 'PDF');
    payload.nome_arquivo = `Pedido_${texto(pedido.numero).replace(/[^a-zA-Z0-9_-]+/g, '_')}_Aluminio_JR.pdf`;
    payload.legenda = `Pedido Alumínio JR ${texto(pedido.numero)}`;
    resumo.documento = { nome: payload.nome_arquivo, bytes: payload.documento.tamanho, legenda: payload.legenda,
      itens: retrato(pedido, telefone).itens, observacao: texto(pedido.obs) || null };
  } else {
    const gerado = await resumoIA.gerarResumo(id, 'automatico');
    // A IA faz sua própria leitura. A prévia não pode combinar duas versões do pedido.
    const atual = await carregar(id);
    if (atual.assinatura !== assinatura) falhar('O pedido mudou durante a preparação. Prepare uma nova prévia.');
    const config = await vozConfig.obter();
    if (!config?.voz || !config?.modelo) falhar('Configure a voz e o modelo do áudio na tela de pedidos.');
    const audio = await eleven.gerarAudio({ texto: gerado.texto, voz: config.voz, modelo: config.modelo });
    payload.audio = { ...guardarBinario(audio.bytes, 'Áudio'), voz: audio.voz, modelo: audio.modelo,
      texto: audio.texto, caracteres: audio.caracteres, formato: 'audio/mpeg' };
    const usuario = texto(contexto.usuario);
    const referencia = usuario && typeof eleven.salvarPreview === 'function' ? eleven.salvarPreview(audio, usuario) : null;
    resumo.audio = { texto: audio.texto, voz: audio.voz, modelo: audio.modelo, caracteres: audio.caracteres,
      bytes: audio.bytes.length, referencia_previa: referencia,
      observacao: 'Este envio contém apenas o áudio apresentado. O envio de fotos é uma ação separada e exige confirmação.' };
  }
  return { payload, resumo };
}

function idMensagem(resultado) {
  const zapi = resultado?.zapi || resultado;
  return zapi?.messageId || zapi?.id || resultado?.idMensagem || null;
}
function motivoSeguro(error) {
  if (error?.codigo === 'WHATSAPP_ENVIO_DESATIVADO') return 'Envio bloqueado pela Central de Controle do WhatsApp.';
  if (error?.isValidation) return error.message;
  return 'A operação falhou ou não teve confirmação do provedor. Confira o status antes de qualquer nova tentativa.';
}

async function executarEnvio(payload, contexto = {}) {
  if (typeof contexto.registrarProgresso !== 'function') falhar('O envio exige registro persistente do progresso da tentativa confirmada.');
  if (payload?.versao !== 1 || !TIPOS.includes(payload.tipo)) falhar('Prévia de envio inválida.');
  if (!payload.expira_em || new Date(payload.expira_em).getTime() <= Date.now() || !Number.isFinite(new Date(payload.expira_em).getTime())) falhar('Prévia expirada. Prepare novamente antes de confirmar.');
  const id = idPedido(payload.id_mestre);
  const atual = await carregar(id);
  if (atual.telefone !== payload.telefone || atual.assinatura !== payload.assinatura) falhar('Pedido ou destinatário mudou desde a prévia. Nada foi enviado; prepare novamente.');
  await controles(payload.tipo);
  if (payload.tipo === 'aviso_carrada') {
    const carrada = carradaDoAviso(atual.pedido);
    const mensagem = montarMensagemEntradaCarrada({ cliente: atual.pedido.cliente, numeroPedido: texto(atual.pedido.numero), carrada });
    if (!payload.carrada || hash(carrada) !== hash(payload.carrada) || mensagem !== payload.mensagem) {
      falhar('A carrada ou o texto do aviso diverge da prévia. Nada foi enviado; prepare novamente.');
    }
  }
  if (payload.tipo === 'fotos' && hash(await analisarFotos(atual.pedido)) !== hash(payload.fotos)) {
    falhar('As fotos ou os produtos mudaram desde a prévia. Nada foi enviado; prepare novamente.');
  }
  let audio;
  if (payload.tipo === 'audio_ia') audio = { ...payload.audio, bytes: lerBinario(payload.audio, 'Áudio') };
  if (payload.tipo === 'pdf') lerBinario(payload.documento, 'PDF');
  const etapas = [];
  const adicionar = (tipo, funcionalidade, enviar, produtoId) => etapas.push({ tipo, funcionalidade, enviar, produtoId });
  if (payload.tipo === 'texto' || payload.tipo === 'aviso_carrada') {
    adicionar(payload.tipo, 'pedidos_texto', () => envio.enviarMensagem({ telefone: payload.telefone, mensagem: payload.mensagem }));
  } else if (payload.tipo === 'pdf') {
    adicionar('pdf', 'pedidos_pdf', () => envio.enviarDocumentoPdf({ telefone: payload.telefone,
      documentoBase64: payload.documento.base64, nomeArquivo: payload.nome_arquivo, legenda: payload.legenda }));
  } else if (payload.tipo === 'audio_ia') {
    adicionar('audio_ia', 'envio_manual', () => eleven.enviarAudio(audio, payload.telefone));
  } else {
    payload.fotos.itens.forEach((item, i) => adicionar('foto', 'pedidos_fotos', () => fotos.enviarItem({
      telefone: payload.telefone, produtoId: item.produtoId, quantidade: item.quantidade,
      unitario: item.unitario, subtotal: item.subtotal, indice: i + 1, totalItens: payload.fotos.itens.length
    }, { produtoEsperado: { nome: item.descricao, foto: item.foto } }), item.produtoId));
    adicionar('resumo_fotos', 'pedidos_fotos_finalizacao', () => fotos.finalizarEnvio({
      telefone: payload.telefone, total: payload.fotos.total, quantidadeProdutos: payload.fotos.quantidadeProdutos, multiplicador: 1
    }));
  }
  const resultados = [];
  let aceitos = 0;
  for (const [indice, etapa] of etapas.entries()) {
    const progresso = { ordem: indice + 1, total: etapas.length, tipo: etapa.tipo,
      produto_id: etapa.produtoId || null, status: 'em_processamento' };
    // Se o registro durável falhar, nenhum envio desta etapa deve acontecer.
    await contexto.registrarProgresso(progresso);
    try {
      const resultado = await controle.comFuncionalidade(etapa.funcionalidade, etapa.enviar);
      if (resultado?.success === false || resultado?.aceitoPelaZapi === false) throw new Error('Resposta de envio não aceita.');
      progresso.status = 'aceito_pelo_provedor';
      progresso.id_mensagem = idMensagem(resultado);
      aceitos += 1;
      resultados.push({ ...progresso });
      await contexto.registrarProgresso(progresso);
      // Mesmo intervalo entre fotos usado na tela de consulta de pedidos.
      if (etapa.tipo === 'foto' && etapas[indice + 1]?.tipo === 'foto') await aguardar(900);
    } catch (error) {
      const aceitoSemRegistro = progresso.status === 'aceito_pelo_provedor';
      const naoEnviado = !aceitoSemRegistro && (error?.codigo === 'WHATSAPP_ENVIO_DESATIVADO' || error?.isValidation);
      if (!aceitoSemRegistro) {
        progresso.status = naoEnviado ? 'nao_enviado' : 'resultado_incerto';
        progresso.motivo = motivoSeguro(error);
        resultados.push({ ...progresso });
        await contexto.registrarProgresso(progresso);
      }
      return { status: aceitos > 0 ? 'parcial' : (naoEnviado ? 'nao_enviado' : 'resultado_incerto'),
        pedido_numero: atual.pedido.numero, telefone_final: payload.telefone.slice(-4),
        aceitos, total: etapas.length, resultados, entrega_confirmada: false, revisao_manual_necessaria: true,
        mensagem: 'O envio foi interrompido. Não reenviar automaticamente; conferir as etapas aceitas e a tentativa incerta.' };
    }
  }
  return { status: 'aceito_pelo_provedor', pedido_numero: atual.pedido.numero,
    telefone_final: payload.telefone.slice(-4), aceitos, total: etapas.length, resultados,
    entrega_confirmada: false, mensagem: 'Solicitações aceitas pelo provedor. A entrega ainda depende do WhatsApp.' };
}

module.exports = { prepararEnvio, executarEnvio, TIPOS };
