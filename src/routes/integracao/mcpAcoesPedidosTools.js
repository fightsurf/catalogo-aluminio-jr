'use strict';

const confirmacoes = require('../../services/integracao/mcpAcoesConfirmadas.service');
const gestao = require('../../services/integracao/mcpPedidoGestao.service');
const whatsapp = require('../../services/integracao/mcpPedidoWhatsapp.service');

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
  definir('preparar_whatsapp_pedido', 'Preparar mensagem, fotos, PDF ou áudio de pedido',
    'Gera prévia para o cliente real de UM pedido, sem enviar WhatsApp. Tipos: texto, fotos, pdf ou audio_ia. Confere telefone cadastrado, cancelamento, mídias e Central de WhatsApp. Mostre cliente, telefone, conteúdo e efeitos; áudio inclui transcrição. Aguarde confirmação expressa posterior. Nunca selecione destinatário arbitrário ou envie em lote.',
    enviar, { id_mestre: idPedido, tipo: { type: 'string', enum: ['texto', 'fotos', 'pdf', 'audio_ia'] },
      mensagem: { type: 'string', maxLength: 10000, description: 'Texto opcional explicitamente solicitado pelo usuário, apenas para tipo texto; omitir usa relatório padrão.' } }, ['id_mestre', 'tipo'], { openWorldHint: true }),
  definir('confirmar_whatsapp_pedido', 'Enviar conteúdo de pedido após confirmação',
    'ENVIA WHATSAPP REAL ao cliente e telefone exibidos na prévia. Só executar após aprovação expressa em resposta posterior. Revalida pedido, destinatário, mídias e Central. Em falha parcial de fotos ou resultado incerto, consulte a ação sem reenviar. Aceitação do provedor não significa entrega.',
    enviar, confirmacao, Object.keys(confirmacao), { idempotentHint: true, openWorldHint: true }),
  definir('consultar_acao_pedido', 'Consultar resultado de uma ação de pedido',
    'Consulta a prévia, estado, progresso e resultado da tentativa desta conta. Somente leitura. Nunca executa novamente alteração, cancelamento, expedição ou WhatsApp. Em em_processamento/parcial/revisao_necessaria, confira o resultado antes de qualquer nova ação.',
    consultar, { acao_id: { type: 'string' } }, ['acao_id'], { readOnlyHint: true })
];
const porNome = new Map(tools.map(t => [t.name, t]));
const preparadores = {
  preparar_alteracao_pedido: ['alterar_pedido', gestao.prepararAlteracao],
  preparar_cancelamento_pedido: ['cancelar_pedido', gestao.prepararCancelamento],
  preparar_expedicao_pedido: ['expedicao_pedido', gestao.prepararExpedicao],
  preparar_whatsapp_pedido: ['whatsapp_pedido', whatsapp.prepararEnvio]
};
const executores = {
  confirmar_alteracao_pedido: ['alterar_pedido', gestao.executarAlteracao],
  confirmar_cancelamento_pedido: ['cancelar_pedido', gestao.executarCancelamento],
  confirmar_expedicao_pedido: ['expedicao_pedido', gestao.executarExpedicao],
  confirmar_whatsapp_pedido: ['whatsapp_pedido', whatsapp.executarEnvio]
};
function requiredScopes(name) { return porNome.get(name)?.securitySchemes[0].scopes || []; }
async function executeTool(name, args, contexto) {
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
