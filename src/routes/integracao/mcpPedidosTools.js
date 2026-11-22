'use strict';

// Ferramentas de pedido integradas ao MESMO MCP autenticado (/mcp/clientes).
// Nunca incluir operações de escrita no endpoint público /mcp.
const pedidos = require('../../services/integracao/mcpPedidos.service');

const leitura = [{ type: 'oauth2', scopes: ['clientes:read'] }];
const gravacao = [{ type: 'oauth2', scopes: ['clientes:read', 'pedidos:write'] }];
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const writeTool = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const tools = [
  {
    name: 'buscar_produtos',
    title: 'Consultar produtos e preços para pedido',
    description: 'Busca pelo nome exato ou parcial de um produto da Alumínio JR para incluir em pedido simples por voz. Retorna o ID e preço do cadastro; nunca inventar produto, preço ou desconto.',
    securitySchemes: leitura,
    annotations: readOnly,
    inputSchema: { type: 'object', properties: {
      nome: { type: 'string', minLength: 2, maxLength: 100 },
      modalidade: { type: 'string', enum: ['orcamento', 'kit-feirinha'] }
    }, required: ['nome'], additionalProperties: false }
  },
  {
    name: 'buscar_vendedores',
    title: 'Consultar vendedor para o pedido',
    description: 'Busca vendedor no legado por nome para localizar código real. O código do vendedor é obrigatório para o pedido; não presumir um vendedor.',
    securitySchemes: leitura,
    annotations: readOnly,
    inputSchema: { type: 'object', properties: {
      nome: { type: 'string', maxLength: 100, description: 'Parte do nome; omitir para listar até 30 vendedores.' }
    }, additionalProperties: false }
  },
  {
    name: 'preparar_pedido',
    title: 'Montar prévia de pedido sem gravar',
    description: 'Para pedidos por voz: depois de identificar cliente, vendedor e produtos, calcula totais e cria apenas rascunho de 15 minutos. Modalidade padrão orçamento. Leia cliente, itens, quantidades, preços e total ao usuário; solicite confirmação explícita ANTES da gravação. Nunca chame confirmar_pedido na mesma etapa sem uma resposta posterior do usuário.',
    securitySchemes: gravacao,
    annotations: writeTool,
    inputSchema: { type: 'object', properties: {
      favorecido: { type: 'integer', minimum: 1, description: 'Código confirmado do cliente no legado.' },
      vendedor: { type: 'integer', minimum: 1, description: 'Código real do vendedor no legado.' },
      modalidade: { type: 'string', enum: ['orcamento', 'kit-feirinha'] },
      data: { type: 'string', description: 'Data AAAA-MM-DD. Omitir para data atual.' },
      volumes: { type: 'integer', minimum: 0 },
      carrada_codigo: { type: 'integer', minimum: 1 },
      observacao: { type: 'string', maxLength: 1000 },
      itens: { type: 'array', minItems: 1, maxItems: 25, items: {
        type: 'object', additionalProperties: false,
        properties: {
          produto_id: { type: 'integer', minimum: 1 },
          quantidade: { type: 'integer', minimum: 1 },
          preco: { type: 'number', minimum: 0, description: 'Preço unitário opcional, nunca inferior ao cadastro.' }
        }, required: ['produto_id', 'quantidade']
      }}
    }, required: ['favorecido', 'vendedor', 'itens'], additionalProperties: false }
  },
  {
    name: 'confirmar_pedido',
    title: 'Gravar pedido confirmado no sistema',
    description: 'GRAVAÇÃO REAL no Firebird. Executar somente após mostrar o resumo completo do rascunho e o usuário confirmar expressamente na conversa seguinte. Não repetir a gravação em erros ou resultado incerto. Requer pedidos:write.',
    securitySchemes: gravacao,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {
      rascunho_id: { type: 'string', description: 'UUID recebido de preparar_pedido.' },
      codigo_confirmacao: { type: 'string', description: 'Código técnico retornado em preparar_pedido.' },
      confirmacao: { type: 'string', enum: ['CONFIRMO'] }
    }, required: ['rascunho_id', 'codigo_confirmacao', 'confirmacao'], additionalProperties: false }
  },
  {
    name: 'consultar_rascunho',
    title: 'Verificar status do rascunho e pedido',
    description: 'Consulta o estado da tentativa de gravação. Se estiver em revisão necessária, conferir o legado; não reenviar automaticamente.',
    securitySchemes: gravacao,
    annotations: readOnly,
    inputSchema: { type: 'object', properties: {
      rascunho_id: { type: 'string' }
    }, required: ['rascunho_id'], additionalProperties: false }
  }
];
const nomes = new Set(tools.map(t => t.name));
const precisaEscrita = new Set(['preparar_pedido', 'confirmar_pedido', 'consultar_rascunho']);
function isPedido(name) { return nomes.has(name); }
function requiresWrite(name) { return precisaEscrita.has(name); }
async function executeTool(name, args = {}) {
  if (process.env.MCP_PEDIDOS_ENABLED !== 'true') {
    const e = new Error('Cadastro de pedidos ainda não habilitado no servidor.'); e.isValidation = true; throw e;
  }
  switch (name) {
    case 'buscar_produtos': return pedidos.buscarProdutos(args);
    case 'buscar_vendedores': return pedidos.buscarVendedores(args);
    case 'preparar_pedido': return pedidos.prepararPedido(args);
    case 'confirmar_pedido': return pedidos.confirmarPedido(args);
    case 'consultar_rascunho': return pedidos.consultarRascunho(args);
    default: { const e = new Error('Ferramenta de pedido inexistente.'); e.isValidation = true; throw e; }
  }
}
module.exports = { tools, isPedido, requiresWrite, executeTool };
