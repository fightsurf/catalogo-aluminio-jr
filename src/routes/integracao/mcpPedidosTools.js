'use strict';

// Ferramentas de pedido integradas ao MESMO MCP autenticado (/mcp/clientes).
// Nunca incluir operações de escrita no endpoint público /mcp.
const pedidos = require('../../services/integracao/mcpPedidos.service');
const consultaPedidos = require('../../services/integracao/mcpConsultaPedidos.service');
const acoes = require('./mcpAcoesPedidosTools');

const leitura = [{ type: 'oauth2', scopes: ['clientes:read'] }];
const gravacao = [{ type: 'oauth2', scopes: ['clientes:read', 'pedidos:write', 'whatsapp:send'] }];
const leituraRascunho = [{ type: 'oauth2', scopes: ['clientes:read', 'pedidos:write'] }];
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
    name: 'consultar_pedidos',
    title: 'Consultar pedidos gravados por número, cliente ou data',
    description: 'Consulta pedidos reais por número, cliente (nome ou código favorecido) ou data. Por cliente, pagina o histórico; ultimo=true retorna o último CADASTRADO por id_mestre/SAIDA, sem usar data de expedição. sem_data_expedicao=true filtra somente ausência verificada. Se houver homônimos, escolha o código entre candidatos. Leia resultado_completo, ultimo_pedido_confirmado e avisos; percorra proxima_pagina para obter todos. Use detalhar_pedido para itens. Somente leitura.',
    securitySchemes: leitura,
    annotations: readOnly,
    inputSchema: { type: 'object', properties: {
      numero: { type: 'string', maxLength: 40 },
      cliente: { type: 'string', maxLength: 120 },
      favorecido: { type: 'integer', minimum: 1, description: 'Código real do cliente; preferível após resolver homônimos.' },
      ultimo: { type: 'boolean', description: 'Retornar o último pedido cadastrado; usa id_mestre/SAIDA, nunca data de entrega ou expedição.' },
      sem_data_expedicao: { type: 'boolean', description: 'Somente pedidos com ausência de expedição verificada. Dados não informados pelo legado são reportados separadamente.' },
      pagina: { type: 'integer', minimum: 1, maximum: 100000 },
      data: { type: 'string', description: 'AAAA-MM-DD (data do pedido)' },
      limite: { type: 'integer', minimum: 1, maximum: 30 },
      incluir_cancelados: { type: 'boolean', description: 'Padrão true. Não omita cancelados sem explicar o filtro.' }
    }, additionalProperties: false }
  },
  {
    name: 'detalhar_pedido',
    title: 'Consultar itens, valores e carrada de pedido gravado',
    description: 'Detalha um pedido real pelo id_mestre obtido na consulta. Somente leitura; retorna itens, situação, valores, cliente, vendedor e carrada. Não confundir id_mestre (chave interna) com o número do pedido.',
    securitySchemes: leitura,
    annotations: readOnly,
    inputSchema: { type: 'object', properties: {
      id_mestre: { type: 'integer', minimum: 1 }
    }, required: ['id_mestre'], additionalProperties: false }
  },
  {
    name: 'preparar_pedido',
    title: 'Montar prévia de pedido sem gravar',
    description: 'Para pedidos por voz: depois de identificar cliente, vendedor e produtos, calcula totais e cria apenas rascunho de 15 minutos. Modalidade padrão orçamento. Leia cliente, itens, quantidades, preços e total ao usuário. Se houver carrada, avise que a gravação confirmada tentará enviar automaticamente o aviso de entrada na carrada por WhatsApp ao cliente cadastrado. Solicite confirmação explícita ANTES da gravação. Nunca confirme na mesma etapa.',
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
    description: 'GRAVAÇÃO REAL no Firebird. Se o rascunho vincula carrada, a confirmação também tentará enviar ao WhatsApp do cliente o aviso de entrada, pelo fluxo já existente da Inserção V2. Execute somente após mostrar resumo e informar o aviso automático, e o usuário confirmar expressamente na resposta seguinte. Não repetir gravação nem mensagem em erro ou resultado incerto. Requer pedidos:write.',
    securitySchemes: gravacao,
    // A criação de um pedido confirmado acrescenta um registro; não apaga nem substitui pedidos.
    // Continua sendo uma operação de escrita: exige pedidos:write e confirmação expressa.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
    securitySchemes: leituraRascunho,
    annotations: readOnly,
    inputSchema: { type: 'object', properties: {
      rascunho_id: { type: 'string' }
    }, required: ['rascunho_id'], additionalProperties: false }
  }
];
tools.push(...acoes.tools);
// O ChatGPT utiliza _meta.securitySchemes para solicitar o escopo OAuth específico de escrita.
for (const t of tools) t._meta = { securitySchemes: t.securitySchemes };
const nomes = new Set(tools.map(t => t.name));
function isPedido(name) { return nomes.has(name); }
function requiredScopes(name) {
  return tools.find(t => t.name === name)?.securitySchemes[0].scopes || ['clientes:read'];
}
function requiresWrite(name) { return requiredScopes(name).some(s => s !== 'clientes:read'); }
async function executeTool(name, args = {}, contexto = {}) {
  if (process.env.MCP_PEDIDOS_ENABLED !== 'true') {
    const e = new Error('Cadastro de pedidos ainda não habilitado no servidor.'); e.isValidation = true; throw e;
  }
  if (acoes.isAcao(name)) return acoes.executeTool(name, args, contexto);
  switch (name) {
    case 'buscar_produtos': return pedidos.buscarProdutos(args);
    case 'buscar_vendedores': return pedidos.buscarVendedores(args);
    case 'consultar_pedidos': return consultaPedidos.consultarPedidos(args);
    case 'detalhar_pedido': return consultaPedidos.detalharPedido(args);
    case 'preparar_pedido': return pedidos.prepararPedido(args);
    case 'confirmar_pedido': return pedidos.confirmarPedido(args);
    case 'consultar_rascunho': return pedidos.consultarRascunho(args);
    default: { const e = new Error('Ferramenta de pedido inexistente.'); e.isValidation = true; throw e; }
  }
}
module.exports = { tools, isPedido, requiresWrite, requiredScopes, executeTool };
