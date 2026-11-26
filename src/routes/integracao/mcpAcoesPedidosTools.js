'use strict';

const confirmacoes = require('../../services/integracao/mcpAcoesConfirmadas.service');
const gestao = require('../../services/integracao/mcpPedidoGestao.service');
const whatsapp = require('../../services/integracao/mcpPedidoWhatsapp.service');
const pagamentosWhatsapp = require('../../services/integracao/mcpPagamentosWhatsapp.service');

const fornecedores = require('../../services/integracao/mcpPrestacaoFornecedor.service');
const lerPrestacoes = ['clientes:read', 'prestacoes:read'];
const pagarFornecedor = [...lerPrestacoes, 'prestacoes:write'];
const whatsappFornecedor = [...lerPrestacoes, 'whatsapp:send'];
const idPrestacao = { type: 'integer', minimum: 1, description: 'ID real da prestação aberta, retornado pela consulta. Escolha pelo título e data.' };
const idFornecedor = { type: 'integer', minimum: 1, description: 'ID real do fornecedor escolhido na consulta.' };
const consultar = ['clientes:read'];
const gerenciar = ['clientes:read', 'pedidos:manage'];
const enviar = ['clientes:read', 'whatsapp:send'];
const gerenciarEnviar = ['clientes:read', 'pedidos:manage', 'whatsapp:send'];
const idPedido = { type: 'integer', minimum: 1, description: 'id_mestre interno real obtido por consultar_pedidos; não é o número visível do pedido.' };
const confirmacao = {
  acao_id: { type: 'string', description: 'Identificador recebido na preparação desta ação.' },
  codigo_confirmacao: { type: 'string', description: 'Código técnico recebido na mesma preparação.' },
  confirmacao: { type: 'string', enum: ['CONFIRMO'] }
};
function definir(name, title, description, scopes, properties, required, annotations = {}) {
  const securitySchemes = [{ type: 'oauth2', scopes }];
  return { name, title, description, securitySchemes, _meta: { securitySchemes },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, ...annotations },
    inputSchema: { type: 'object', properties, required, additionalProperties: false } };
}
const tools = [
  definir('buscar_prestacoes_fornecedor', 'Consultar prestações abertas dos fornecedores',
    'Busca pelo nome ou código real do fornecedor. Retorna somente prestações abertas, título, referência, compra, total pago e saldo. Se houver mais de um fornecedor ou prestação, apresente as opções e aguarde a escolha; percorra as páginas. Não invente códigos.',
    lerPrestacoes, { fornecedor: { type: 'string', minLength: 2, maxLength: 120 }, fornecedor_id: idFornecedor,
      pagina: { type: 'integer', minimum: 1, maximum: 100000 }, limite: { type: 'integer', minimum: 1, maximum: 50 } }, [], { readOnlyHint: true }),
  definir('preparar_pagamento_fornecedor', 'Preparar lançamento de pagamento de fornecedor',
    'Somente prévia: consulte primeiro as prestações abertas e identifique fornecedor e prestação escolhidos. Recebe data civil, valor em reais e observação. Apresente o saldo antes e previsto, data, valor e observação. Não grava nem envia WhatsApp. Aguarde confirmação expressa posterior.',
    pagarFornecedor, { fornecedor_id: idFornecedor, prestacao_id: idPrestacao,
      data: { type: 'string', minLength: 10, maxLength: 10, description: 'AAAA-MM-DD' },
      valor: { type: 'number', exclusiveMinimum: 0 }, observacao: { type: 'string', maxLength: 1000 } },
      ['fornecedor_id', 'prestacao_id', 'data', 'valor', 'observacao']),
  definir('confirmar_pagamento_fornecedor', 'Gravar pagamento de fornecedor confirmado',
    'Registra efetivamente o pagamento pela mesma rotina da prestação web. Só confirme após autorização expressa da prévia em resposta posterior. Não envia WhatsApp. Em resultado incerto, consulte a ação; nunca repita automaticamente.',
    pagarFornecedor, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true }),
  definir('preparar_whatsapp_resumo_fornecedor', 'Preparar WhatsApp Resumo da prestação',
    'Usa exatamente a mensagem do botão WhatsApp Resumo da prestação aberta, com os últimos cinco pagamentos, valor da compra, total pago e saldo. Mostre fornecedor, telefone e texto; aguarde confirmação posterior. Não envia PDF nem comprovante separado.',
    whatsappFornecedor, { fornecedor_id: idFornecedor, prestacao_id: idPrestacao }, ['fornecedor_id', 'prestacao_id'], { openWorldHint: true }),
  definir('confirmar_whatsapp_resumo_fornecedor', 'Enviar WhatsApp Resumo ao fornecedor',
    'Envia pela rotina original do botão WhatsApp Resumo, somente após autorização explícita posterior. Revalida conteúdo, destinatário e Central de Controle. Aceite do provedor não garante entrega; não repetir em falha incerta.',
    whatsappFornecedor, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true, openWorldHint: true }),
  definir('consultar_acao_prestacao', 'Consultar resultado do lançamento ou envio de resumo',
    'Consulta o status de uma ação de prestação de fornecedor desta conta. Somente leitura; não reexecuta.',
    lerPrestacoes, { acao_id: { type: 'string' } }, ['acao_id'], { readOnlyHint: true }),
  definir('preparar_alteracao_pedido', 'Preparar alteração de um pedido',
    'Somente prévia. Identifique um pedido real e informe apenas os campos a mudar. A lista itens, quando informada, SUBSTITUI todos os itens: inclua os que devem permanecer. Mostre antes/depois e total, e aguarde confirmação posterior. Alterar carrada preserva os avisos automáticos da tela. Nunca grava nem envia durante esta preparação.',
    gerenciarEnviar, {
      id_mestre: idPedido, data: { type: 'string', description: 'Nova data do pedido AAAA-MM-DD; não é a data de expedição.' },
      vendedor: { type: 'integer', minimum: 1 }, observacao: { type: 'string', maxLength: 1000 },
      carrada_codigo: { type: ['integer', 'null'], minimum: 1, description: 'Omitir mantém a carrada; null remove. Mudança pode emitir avisos WhatsApp de saída/entrada.' },
      itens: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object',
        properties: { produto_id: { type: 'integer', minimum: 1 }, quantidade: { type: 'number', exclusiveMinimum: 0 },
          preco: { type: 'number', minimum: 0, description: 'Omitir usa preço atual do cadastro; permite preço negociado informado explicitamente, inclusive abaixo do cadastro.' } },
        required: ['produto_id', 'quantidade'], additionalProperties: false } }
    }, ['id_mestre']),
  definir('confirmar_alteracao_pedido', 'Executar alteração confirmada de um pedido',
    'ALTERA O PEDIDO REAL e, se a carrada mudar, usa seus avisos automáticos existentes. Somente após o usuário aprovar a prévia em uma resposta posterior. Uma única execução; em resultado parcial ou incerto consulte a ação e não repita.',
    gerenciarEnviar, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true, openWorldHint: true }),
  definir('preparar_cancelamento_pedido', 'Preparar cancelamento de um pedido',
    'Somente prévia do cancelamento individual: pedido, cliente, total e motivo. Não cancela agora. Aguarde confirmação expressa posterior; nunca invente motivo. Usa os bloqueios da mesma rotina do sistema.',
    gerenciar, { id_mestre: idPedido, motivo: { type: 'string', minLength: 1, maxLength: 250 } }, ['id_mestre', 'motivo']),
  definir('confirmar_cancelamento_pedido', 'Cancelar pedido após confirmação',
    'CANCELA UM PEDIDO REAL pela rotina existente. Executar somente após aprovação expressa da prévia em resposta posterior. Preserva bloqueios do legado e não repete tentativa incerta.',
    gerenciar, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true }),
  definir('preparar_expedicao_pedido', 'Preparar registro da data de expedição',
    'Somente prévia de um pedido: confere carrada, data atual e data proposta. Informe que a confirmação realizará EXATAMENTE a ação da tela Progresso, incluindo WhatsApp/áudio automáticos configurados. Não separar registro e aviso. Não há ação de enviar para todos.',
    gerenciarEnviar, { id_mestre: idPedido, carrada_codigo: { type: 'integer', minimum: 1 },
      data_expedicao: { type: 'string', description: 'Data civil AAAA-MM-DD; a prévia apresenta DD/MM/AAAA.' } }, ['id_mestre', 'data_expedicao']),
  definir('confirmar_expedicao_pedido', 'Registrar expedição e executar aviso confirmado',
    'REGISTRA a data e executa a notificação automática da rotina existente de Progresso para UM pedido. Somente após prévia e confirmação expressa posterior. Não repetir em erro, pois a data ou mensagem pode já ter sido processada.',
    gerenciarEnviar, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true, openWorldHint: true }),
  definir('preparar_whatsapp_pedido', 'Preparar aviso de carrada, mensagem, fotos, PDF ou áudio de pedido',
    'Gera prévia para o cliente real de UM pedido já gravado, sem enviar WhatsApp. Tipos: aviso_carrada, texto, fotos, pdf ou audio_ia. aviso_carrada usa o mesmo aviso de entrada da Inserção V2 e exige vínculo atual confirmado; não admite texto personalizado. Confere telefone cadastrado, cancelamento, carrada, mídias e Central de WhatsApp. Mostre cliente, telefone, conteúdo e efeitos; áudio inclui transcrição. Aguarde confirmação expressa posterior do envio. Uma falha nesta ação não desfaz nem exige repetir a gravação do pedido. Nunca selecione destinatário arbitrário ou envie em lote.',
    enviar, { id_mestre: idPedido, tipo: { type: 'string', enum: ['aviso_carrada', 'texto', 'fotos', 'pdf', 'audio_ia'] },
      mensagem: { type: 'string', maxLength: 10000, description: 'Texto opcional explicitamente solicitado pelo usuário, apenas para tipo texto; omitir usa relatório padrão.' } }, ['id_mestre', 'tipo'], { openWorldHint: true }),
  definir('confirmar_whatsapp_pedido', 'Enviar conteúdo de pedido após confirmação',
    'ENVIA WHATSAPP REAL ao cliente e telefone exibidos na prévia. Só executar após aprovação expressa em resposta posterior. Revalida pedido, destinatário, mídias e Central. Em falha parcial de fotos ou resultado incerto, consulte a ação sem reenviar. Aceitação do provedor não significa entrega.',
    enviar, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true, openWorldHint: true }),
  definir('preparar_whatsapp_pagamentos_cliente', 'Preparar WhatsApp com saldos dos últimos pedidos',
    'Localiza o cliente pelo nome ou código favorecido; seleciona os últimos pedidos ATIVOS por NÚMERO SEQUENCIAL, do maior para o menor (padrão 3, máximo 10). Consulta os pagamentos reais pela mesma rotina do botão preto da tela Pagamentos, com a mesma mensagem por pedido. Mostra número, total, pago, saldo, telefone e texto de CADA mensagem. Exige histórico completo, cliente único e valores verificados. Não envia nada agora. Aguarde aprovação explícita posterior.',
    enviar, {
      cliente: { type: 'string', minLength: 3, maxLength: 120, description: 'Nome ou parte do nome do cliente; se houver homônimos, informe o código favorecido.' },
      favorecido: { type: 'integer', minimum: 1, description: 'Código real do cliente, opcional se o nome identificar unicamente.' },
      quantidade: { type: 'integer', minimum: 1, maximum: 10, description: 'Quantidade de últimos pedidos por número, padrão 3.' }
    }, [], { openWorldHint: true }),
  definir('confirmar_whatsapp_pagamentos_cliente', 'Enviar saldos dos pedidos após autorização',
    'ENVIA as mensagens financeiras exibidas na prévia, UMA por pedido, somente para o WhatsApp cadastrado do mesmo cliente. Exige aprovação expressa em resposta posterior. Revalida ordem dos pedidos, pagamentos, saldos, texto, telefone e Central de Controle. Registra cada tentativa antes do envio; resultado parcial ou incerto NÃO deve ser repetido automaticamente. Aceite do provedor não garante entrega.',
    enviar, confirmacao, Object.keys(confirmacao), { destructiveHint: true, idempotentHint: true, openWorldHint: true }),
  definir('consultar_acao_pedido', 'Consultar resultado de uma ação de pedido',
    'Consulta a prévia, estado, progresso e resultado da tentativa desta conta. Somente leitura. Nunca executa novamente alteração, cancelamento, expedição ou WhatsApp. Em em_processamento/parcial/revisao_necessaria, confira o resultado antes de qualquer nova ação.',
    consultar, { acao_id: { type: 'string' } }, ['acao_id'], { readOnlyHint: true })
];
const porNome = new Map(tools.map(t => [t.name, t]));
const preparadores = {
  preparar_pagamento_fornecedor: ['pagamento_fornecedor', fornecedores.prepararPagamento],
  preparar_whatsapp_resumo_fornecedor: ['whatsapp_resumo_fornecedor', fornecedores.prepararWhatsApp],
  preparar_alteracao_pedido: ['alterar_pedido', gestao.prepararAlteracao],
  preparar_cancelamento_pedido: ['cancelar_pedido', gestao.prepararCancelamento],
  preparar_expedicao_pedido: ['expedicao_pedido', gestao.prepararExpedicao],
  preparar_whatsapp_pedido: ['whatsapp_pedido', whatsapp.prepararEnvio],
  preparar_whatsapp_pagamentos_cliente: ['whatsapp_pagamentos', pagamentosWhatsapp.prepararEnvio]
};
const executores = {
  confirmar_pagamento_fornecedor: ['pagamento_fornecedor', fornecedores.executarPagamento],
  confirmar_whatsapp_resumo_fornecedor: ['whatsapp_resumo_fornecedor', fornecedores.executarWhatsApp],
  confirmar_alteracao_pedido: ['alterar_pedido', gestao.executarAlteracao],
  confirmar_cancelamento_pedido: ['cancelar_pedido', gestao.executarCancelamento],
  confirmar_expedicao_pedido: ['expedicao_pedido', gestao.executarExpedicao],
  confirmar_whatsapp_pedido: ['whatsapp_pedido', whatsapp.executarEnvio],
  confirmar_whatsapp_pagamentos_cliente: ['whatsapp_pagamentos', pagamentosWhatsapp.executarEnvio]
};
function requiredScopes(name) { return porNome.get(name)?.securitySchemes[0].scopes || []; }
async function executeTool(name, args, contexto) {
  if (name === 'buscar_prestacoes_fornecedor') return fornecedores.buscarAbertas(args);
  if (name === 'consultar_acao_prestacao') {
    const resultado = await confirmacoes.consultarAcao(args, contexto);
    if (!['pagamento_fornecedor', 'whatsapp_resumo_fornecedor'].includes(resultado.tipo)) { const e = new Error('Ação não pertence à prestação de fornecedor.'); e.isValidation = true; throw e; }
    return resultado;
  }
  if (preparadores[name]) {
    const [tipo, preparar] = preparadores[name];
    const previa = await preparar(args, contexto);
    return confirmacoes.prepararAcao({ tipo, ...previa }, contexto);
  }
  if (executores[name]) {
    const [tipo, executar] = executores[name];
    return confirmacoes.confirmarAcao(args, contexto, tipo, executar);
  }
  if (name === 'consultar_acao_pedido') return confirmacoes.consultarAcao(args, contexto);
  const e = new Error('Ação de pedido desconhecida.'); e.isValidation = true; throw e;
}
module.exports = { tools, requiredScopes, executeTool, isAcao: name => porNome.has(name) };
