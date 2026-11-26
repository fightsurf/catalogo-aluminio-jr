'use strict';

const prestacoes = require('../prestacao_contas/prestacao_contas.service');
const controle = require('../whatsapp/central-controle.service');

function falhar(mensagem) { const erro = new Error(mensagem); erro.isValidation = true; throw erro; }
function id(v) { const n = Number(v); if (!Number.isSafeInteger(n) || n <= 0) falhar('Código inválido. Consulte as prestações abertas.'); return n; }
function norm(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase(); }
function dataCivil(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) falhar('Informe a data no formato AAAA-MM-DD.');
  const d = new Date(v + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== v || v.slice(0,4) === '0000') falhar('Data de pagamento inválida.');
  return v;
}
function dataRef(v) { return v instanceof Date ? v.toISOString().slice(0,10) : String(v || '').slice(0,10); }
function centavos(v) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) falhar('Valor financeiro não verificado.');
  const n = Math.round(Number(v)*100);
  if (!Number.isSafeInteger(n)) falhar('Valor financeiro fora do limite.');
  return n;
}
function resumoPrestacao(p) {
  return { prestacao_id: id(p.id), fornecedor_id: id(p.fornecedor_id),
    fornecedor: String(p.fornecedor_nome || ''), titulo: String(p.titulo || ''), data_referencia: dataRef(p.data_referencia),
    total_material: centavos(p.total_material)/100, total_pago: centavos(p.total_pago)/100,
    saldo_restante: centavos(p.saldo_restante)/100 };
}
function assinatura(p) {
  return JSON.stringify([Number(p.id), Number(p.fornecedor_id), String(p.titulo || ''), dataRef(p.data_referencia),
    centavos(p.total_material), centavos(p.total_pago), centavos(p.saldo_restante)]);
}
async function buscarAbertas(args = {}) {
  const nome = norm(args.fornecedor);
  if (args.fornecedor !== undefined && nome.length < 2) falhar('Informe pelo menos dois caracteres do nome do fornecedor.');
  const fornecedorId = args.fornecedor_id === undefined ? null : id(args.fornecedor_id);
  const pagina = args.pagina === undefined ? 1 : id(args.pagina);
  const limite = args.limite === undefined ? 20 : id(args.limite);
  if (limite > 50) falhar('Limite máximo: 50.');
  const abertas = await prestacoes.listar('ABERTA');
  const lista = abertas.filter(p => p.fornecedor_id != null &&
    (!nome || norm(p.fornecedor_nome).includes(nome)) &&
    (!fornecedorId || Number(p.fornecedor_id) === fornecedorId));
  const offset = (pagina - 1)*limite;
  const registros = lista.slice(offset, offset + limite).map(resumoPrestacao);
  return { total_encontrado: lista.length, pagina, limite, exibindo: registros.length,
    proxima_pagina: offset + limite < lista.length ? pagina+1 : null, prestacoes: registros,
    aviso: 'Somente prestações abertas. Havendo mais de um fornecedor ou prestação, apresente as opções e aguarde a escolha. Não escolha automaticamente.' };
}
async function aberta(args) {
  const p = await prestacoes.buscarPorId(id(args.prestacao_id));
  if (!p || prestacoes._statusPrestacao(p) !== 'ABERTA') falhar('Prestação inexistente ou concluída. Consulte novamente as prestações abertas.');
  if (Number(p.fornecedor_id) !== id(args.fornecedor_id)) falhar('Esta prestação não pertence ao fornecedor escolhido.');
  return p;
}
function validarPagamento(args) {
  const data = dataCivil(args.data);
  const valor = args.valor;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0 ||
      Math.abs(valor*100-Math.round(valor*100)) > 0.000001 || !Number.isSafeInteger(Math.round(valor*100))) falhar('Informe um valor positivo com até duas casas decimais.');
  if (typeof args.observacao !== 'string' || args.observacao.length > 1000) falhar('Informe a observação (pode ser vazia, até 1000 caracteres).');
  return { data, valor, observacao: args.observacao };
}
async function prepararPagamento(args) {
  const pagamento = validarPagamento(args);
  const p = await aberta(args);
  const atual = resumoPrestacao(p);
  const saldo = (centavos(p.saldo_restante)-centavos(pagamento.valor))/100;
  const expira_em = new Date(Date.now()+10*60000).toISOString();
  return { payload: { versao:1, expira_em, prestacao_id:atual.prestacao_id, fornecedor_id:atual.fornecedor_id,
      assinatura: assinatura(p), fornecedor: atual.fornecedor, pagamento },
    resumo: { acao:'cadastrar_pagamento_fornecedor', prestacao:atual, pagamento,
      saldo_previsto:saldo, total_pago_previsto:(centavos(p.total_pago)+centavos(pagamento.valor))/100,
      confirmacao_obrigatoria:true, aviso:'Nenhum pagamento gravado e nenhum WhatsApp enviado. Mostre fornecedor, prestação, data, valor, observação e saldo previsto; aguarde confirmação. Saldo negativo indica crédito.' } };
}
function validarPayload(payload) {
  if (!payload || payload.versao !== 1 || !Number.isFinite(Date.parse(payload.expira_em)) || Date.parse(payload.expira_em) <= Date.now()) falhar('Prévia inválida ou expirada. Prepare novamente.');
}
function progresso(contexto) {
  if (typeof contexto.registrarProgresso !== 'function') falhar('A ação exige registro persistente da tentativa.');
  return contexto.registrarProgresso;
}
async function executarPagamento(payload, contexto = {}) {
  validarPayload(payload);
  const registrar = progresso(contexto);
  const pagamento = validarPagamento(payload.pagamento);
  const p = await aberta(payload);
  if (assinatura(p) !== payload.assinatura || String(p.fornecedor_nome || '') !== payload.fornecedor) falhar('A prestação mudou após a prévia. Prepare novamente.');
  await registrar({ etapa:'gravar_pagamento_fornecedor', estado:'em_processamento', prestacao_id:payload.prestacao_id });
  const gravado = await prestacoes.criarPagamento(payload.prestacao_id, pagamento, { validarPrestacao: atual => {
    if (assinatura(atual) !== payload.assinatura) falhar('A prestação mudou após a prévia. Prepare novamente.');
  } });
  if (!gravado?.id) throw new Error('Pagamento não confirmado pela rotina original.');
  await registrar({ etapa:'gravar_pagamento_fornecedor', estado:'gravado', pagamento_id:gravado.id });
  const atual = await prestacoes.buscarPorId(payload.prestacao_id);
  return { status:'gravado', pagamento:gravado, prestacao:resumoPrestacao(atual),
    whatsapp_enviado:false, mensagem:'Pagamento registrado. Para enviar o resumo, prepare e confirme o WhatsApp separadamente.' };
}
function assinaturaResumo(r) {
  return JSON.stringify([Number(r.fornecedor_id), r.fornecedor, r.telefone, r.mensagem]);
}
async function prepararWhatsApp(args) {
  await aberta(args);
  await controle.verificar('prestacoes_resumo');
  const r = await prestacoes.prepararResumoWhatsapp(id(args.prestacao_id));
  if (Number(r.fornecedor_id) !== id(args.fornecedor_id)) falhar('Fornecedor da prestação mudou. Consulte novamente.');
  const expira_em = new Date(Date.now()+10*60000).toISOString();
  return { payload:{ versao:1, expira_em, prestacao_id:id(args.prestacao_id), fornecedor_id:id(args.fornecedor_id), assinatura:assinaturaResumo(r) },
    resumo:{ acao:'enviar_whatsapp_resumo_fornecedor', prestacao_id:id(args.prestacao_id), fornecedor:r.fornecedor,
      destinatario:{ telefone:r.telefone, final:r.telefone.slice(-4) }, mensagem:r.mensagem,
      quantidade_pagamentos:r.quantidade_pagamentos, confirmacao_obrigatoria:true,
      aviso:'Mesmo botão WhatsApp Resumo da prestação de contas. Nenhuma mensagem enviada; aguarde confirmação expressa.' } };
}
async function executarWhatsApp(payload, contexto = {}) {
  validarPayload(payload);
  const registrar = progresso(contexto);
  await aberta(payload);
  const r = await prestacoes.prepararResumoWhatsapp(id(payload.prestacao_id));
  if (assinaturaResumo(r) !== payload.assinatura) falhar('Resumo ou destinatário mudou. Prepare novamente.');
  await controle.verificar('prestacoes_resumo');
  await registrar({ etapa:'whatsapp_resumo_fornecedor', estado:'em_processamento', prestacao_id:payload.prestacao_id });
  const envio = await controle.comFuncionalidade('prestacoes_resumo', () =>
    prestacoes.enviarResumoWhatsapp(payload.prestacao_id, { validarResumo: atual => {
      if (assinaturaResumo(atual) !== payload.assinatura) falhar('Resumo ou destinatário mudou. Prepare novamente.');
    } }));
  await registrar({ etapa:'whatsapp_resumo_fornecedor', estado:'aceito_pelo_provedor' });
  return { status:'aceito_pelo_provedor', fornecedor:envio.fornecedor, telefone_final:String(envio.telefone || '').slice(-4),
    entrega_confirmada:false, mensagem:'Resumo aceito pelo provedor. Entrega no WhatsApp não confirmada.' };
}
module.exports = { buscarAbertas, prepararPagamento, executarPagamento, prepararWhatsApp, executarWhatsApp };
