'use strict';

// MCP de pedidos: endpoint separado do piloto público de logística.
// Desligado por padrão; exige Bearer forte e transporte HTTPS em produção.
const express = require('express');
const crypto = require('crypto');
const service = require('../../services/integracao/mcpPedidos.service');

const router = express.Router();
const PROTOCOL = '2025-06-18';
const tools = [
  {
    name: 'buscar_clientes',
    title: 'Buscar clientes',
    description: 'Busca possíveis clientes pelo nome. Se houver homônimos, peça ao usuário para escolher pelo código favorecido antes de preparar o pedido.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: { nome: { type: 'string', minLength: 2, maxLength: 100 } },
      required: ['nome'], additionalProperties: false
    }
  },
  {
    name: 'buscar_produtos',
    title: 'Buscar produtos e preços',
    description: 'Busca produtos ativos, seus IDs, valores de referência e vínculo ao item legado. O nome não deve ser adivinhado.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        nome: { type: 'string', minLength: 2, maxLength: 100 },
        modalidade: { type: 'string', enum: ['orcamento', 'kit-feirinha'] }
      },
      required: ['nome'], additionalProperties: false
    }
  },
  {
    name: 'preparar_pedido',
    title: 'Preparar pedido sem gravar',
    description: 'Valida cliente, vendedor, produtos, modalidade e preços, calcula o total e salva APENAS um rascunho válido por 15 minutos. Nunca grava no Firebird. Mostre o resumo completo e peça confirmação explícita.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        favorecido: { type: 'integer', minimum: 1, description: 'Código exato do cliente após busca.' },
        vendedor: { type: 'integer', minimum: 1, description: 'Código do vendedor cadastrado; não presumir.' },
        modalidade: { type: 'string', enum: ['orcamento', 'kit-feirinha'] },
        data: { type: 'string', description: 'Data do pedido em AAAA-MM-DD; omitir para hoje (São Paulo).' },
        volumes: { type: 'integer', minimum: 0 },
        carrada_codigo: { type: 'integer', minimum: 1 },
        observacao: { type: 'string', maxLength: 1000 },
        itens: {
          type: 'array', minItems: 1, maxItems: 25,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              produto_id: { type: 'integer', minimum: 1 },
              quantidade: { type: 'integer', minimum: 1 },
              preco: { type: 'number', minimum: 0, description: 'Opcional. Não pode ser inferior ao preço cadastrado; preços diferentes exigem revisão.' }
            },
            required: ['produto_id', 'quantidade']
          }
        }
      },
      required: ['favorecido', 'vendedor', 'itens'],
      additionalProperties: false
    }
  },
  {
    name: 'confirmar_pedido',
    title: 'Confirmar e gravar pedido no legado',
    description: 'AÇÃO DE ESCRITA no Firebird. Chame somente APÓS o usuário ter aprovado explicitamente o resumo do pedido nesta conversa, nunca como parte automática de preparar_pedido. Confirmar é operação única; em resultado incerto, NÃO repetir.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        rascunho_id: { type: 'string', description: 'ID UUID retornado por preparar_pedido.' },
        codigo_confirmacao: { type: 'string', description: 'Código retornado por preparar_pedido, não criar outro.' },
        confirmacao: { type: 'string', enum: ['CONFIRMO'], description: 'Usar somente se o usuário disser que confirma a gravação.' }
      },
      required: ['rascunho_id', 'codigo_confirmacao', 'confirmacao'],
      additionalProperties: false
    }
  },
  {
    name: 'consultar_rascunho',
    title: 'Consultar situação da gravação',
    description: 'Lê a situação de um rascunho ou pedido confirmado. Em revisão necessária, não tente reenviar automaticamente.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: { rascunho_id: { type: 'string' } },
      required: ['rascunho_id'], additionalProperties: false
    }
  }
];

function equalSafe(a, b) {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
router.use((req, res, next) => {
  if (process.env.MCP_PEDIDOS_ENABLED !== 'true') {
    return res.status(503).json({ erro: 'MCP de pedidos desativado no ambiente.' });
  }
  const key = String(process.env.MCP_PEDIDOS_BEARER_TOKEN || '');
  if (key.length < 32) {
    return res.status(503).json({ erro: 'Credencial do MCP de pedidos não configurada.' });
  }
  if (process.env.NODE_ENV === 'production' && !req.secure && req.get('x-forwarded-proto') !== 'https') {
    return res.status(403).json({ erro: 'HTTPS obrigatório.' });
  }
  const auth = String(req.get('authorization') || '');
  if (!auth.startsWith('Bearer ') || !equalSafe(auth.slice(7), key)) {
    return res.status(401).set('WWW-Authenticate', 'Bearer realm="mcp-pedidos"')
      .json({ erro: 'Credencial Bearer inválida ou ausente.' });
  }
  next();
});

router.get('/status', (_req, res) => res.json({
  ok: true, servidor: 'aluminio-jr-pedidos', versao: '0.1.0',
  endpoint: '/mcp/pedidos', ferramentas: tools.map(t => t.name)
}));
router.get('/', (_req, res) => res.status(405).set('Allow', 'POST').end());
router.delete('/', (_req, res) => res.status(405).set('Allow', 'POST').end());

function resposta(res, id, result) { return res.json({ jsonrpc: '2.0', id, result }); }
function erroRpc(res, id, code, message, status = 200) {
  return res.status(status).json({ jsonrpc: '2.0', id, error: { code, message } });
}
router.post('/', async (req, res) => {
  const msg = req.body;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) ||
      msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return erroRpc(res, null, -32600, 'Mensagem JSON-RPC inválida.', 400);
  }
  if (!Object.prototype.hasOwnProperty.call(msg, 'id')) return res.status(202).end();
  try {
    if (msg.method === 'initialize') {
      return resposta(res, msg.id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'aluminio-jr-pedidos', version: '0.1.0' },
        instructions: 'Consulte cliente, vendedor e produtos antes de preparar. Preparar não grava no legado. Mostre o resumo e aguarde confirmação explícita do usuário antes de chamar confirmar_pedido. Nunca repetir uma gravação de resultado incerto.'
      });
    }
    if (msg.method === 'ping') return resposta(res, msg.id, {});
    if (msg.method === 'tools/list') return resposta(res, msg.id, { tools });
    if (msg.method !== 'tools/call') return erroRpc(res, msg.id, -32601, 'Método não encontrado.', 404);
    const p = msg.params;
    if (!p || typeof p !== 'object' || typeof p.name !== 'string') {
      return erroRpc(res, msg.id, -32602, 'Ferramenta obrigatória.');
    }
    const args = p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments)
      ? p.arguments : {};
    const executors = {
      buscar_clientes: service.buscarClientes,
      buscar_produtos: service.buscarProdutos,
      preparar_pedido: service.prepararPedido,
      confirmar_pedido: service.confirmarPedido,
      consultar_rascunho: service.consultarRascunho
    };
    if (!Object.prototype.hasOwnProperty.call(executors, p.name)) {
      return erroRpc(res, msg.id, -32602, 'Ferramenta não encontrada.');
    }
    const result = await executors[p.name](args);
    return resposta(res, msg.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false
    });
  } catch (err) {
    if (!err.isValidation) console.error('[mcp/pedidos] Falha:', err.message);
    return resposta(res, msg.id, {
      content: [{ type: 'text', text: err.isValidation ? err.message : 'Erro ao processar o pedido. Não repetir gravações sem verificar o status.' }],
      isError: true
    });
  }
});
module.exports = router;
