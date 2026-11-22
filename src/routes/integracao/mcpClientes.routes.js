'use strict';

const express = require('express');
const auth = require('../../services/integracao/mcpClientesOAuth.service');
const clientesService = require('../../services/legado/clientes/clientes.service');
const logistica = require('./mcpLogistica.routes');
const consultas = require('../../services/integracao/mcpConsultasDetalhadas.service');

const router = express.Router();
const PROTOCOL = '2025-06-18';
const TOOL = {
  name: 'buscar_clientes',
  title: 'Buscar clientes da Alumínio JR',
  description: 'Busca clientes cadastrados por nome. Retorna código favorecido, nome, cidade, UF, número de telefone e observação quando disponível na API do legado. Somente leitura. Não inventa dados ausentes.',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  securitySchemes: [{ type: 'oauth2', scopes: ['clientes:read'] }],
  inputSchema: {
    type: 'object',
    properties: {
      nome: {
        type: 'string', minLength: 3, maxLength: 100,
        description: 'Nome ou parte do nome do cliente, com pelo menos três caracteres.'
      }
    },
    required: ['nome'],
    additionalProperties: false
  }
};
// Ferramentas de logística usam a mesma sessão OAuth do plugin já conectado.
// Mantemos todas as consultas somente leitura e sem dados de contato.
const TOOL_CLIENTE_ID = {
  name: 'consultar_cliente',
  title: 'Consultar cliente pelo código',
  description: 'Consulta um cliente pelo código favorecido, com nome, cidade, UF, número do telefone e observação quando disponível. Somente leitura.',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  securitySchemes: [{ type: 'oauth2', scopes: ['clientes:read'] }],
  inputSchema: {
    type: 'object',
    properties: { favorecido: { type: 'integer', minimum: 1, description: 'Código favorecido do cliente.' } },
    required: ['favorecido'], additionalProperties: false
  }
};
const TOOL_LOGISTICA = {
  name: 'listar_excursoes_transportadoras',
  title: 'Listar excursões e transportadoras com cidades vinculadas',
  description: 'Lista os cadastros de excursões e transportadoras na mesma tabela, com cidade, UF, número de telefone, observação e todas as cidades vinculadas. Retorna até 50 por página e permite avançar por páginas. Somente leitura.',
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  securitySchemes: [{ type: 'oauth2', scopes: ['clientes:read'] }],
  inputSchema: {
    type: 'object',
    properties: {
      nome: { type: 'string', maxLength: 120, description: 'Parte opcional do nome.' },
      pagina: { type: 'integer', minimum: 1, maximum: 100000, description: 'Página, começando em 1.' },
      limite: { type: 'integer', minimum: 1, maximum: 50, description: 'Registros por página (padrão 20).' }
    },
    additionalProperties: false
  }
};
const TOOLS = [TOOL, TOOL_CLIENTE_ID, TOOL_LOGISTICA, ...logistica.mcpTools.map(t => ({
  ...t,
  securitySchemes: [{ type: 'oauth2', scopes: ['clientes:read'] }]
}))];
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
async function buscar({ nome } = {}) {
  if (typeof nome !== 'string' || nome.trim().length < 3 || nome.trim().length > 100) {
    throw new Error('Informe pelo menos três caracteres do nome do cliente.');
  }
  const rows = await clientesService.listarClientes({ nome: nome.trim() });
  const encontrados = (Array.isArray(rows) ? rows : []).filter(c =>
    norm(c.nome || c.razao_social || c.fantasia).includes(norm(nome))
  );
  const clientes = encontrados.slice(0, 10).map(consultas.resumirCliente);
  return { total_encontrado: encontrados.length, exibindo: clientes.length, clientes };
}
function jsonrpc(res, id, result) { return res.json({ jsonrpc: '2.0', id, result }); }
function rpcError(res, id, code, message, status = 200) {
  return res.status(status).json({ jsonrpc: '2.0', id, error: { code, message } });
}
router.use(async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!auth.enabled()) return res.status(503).json({ erro: 'MCP de clientes desativado.' });
  const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') || '');
  try {
    const credential = bearer ? await auth.validateAccess(bearer[1]) : null;
    if (!credential) {
      res.set('WWW-Authenticate', 'Bearer resource_metadata="' + auth.metadataUrl() + '", scope="clientes:read"');
      return res.status(401).json({ erro: 'Autorização OAuth necessária.' });
    }
    req.oauthUser = credential.user;
    return next();
  } catch (err) {
    console.error('[mcp/clientes] Falha ao validar token:', err.message);
    return res.status(503).json({ erro: 'Falha temporária na autenticação.' });
  }
});
router.get('/status', (_req, res) => res.json({ ok: true, escopo: 'clientes:read', somente_leitura: true }));
router.get('/', (_req, res) => res.status(405).set('Allow', 'POST').end());
router.delete('/', (_req, res) => res.status(405).set('Allow', 'POST').end());
router.post('/', async (req, res) => {
  const m = req.body;
  if (!m || typeof m !== 'object' || Array.isArray(m) ||
      m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return rpcError(res, null, -32600, 'JSON-RPC inválido.', 400);
  }
  if (!Object.prototype.hasOwnProperty.call(m, 'id')) return res.status(202).end();
  if (m.method === 'initialize') {
    return jsonrpc(res, m.id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'aluminio-jr-clientes', version: '1.0.0' },
      instructions: 'Consulte clientes por nome ou código, excursões, transportadoras e cidades do sistema Alumínio JR. Use a ferramenta autenticada listar_excursoes_transportadoras para obter números de telefone, observações e cidades vinculadas, percorrendo as páginas quando necessário. Se houver clientes semelhantes, apresente os códigos. Nenhuma ferramenta altera dados. Não invente informações ausentes.'
    });
  }
  if (m.method === 'ping') return jsonrpc(res, m.id, {});
  if (m.method === 'tools/list') return jsonrpc(res, m.id, { tools: TOOLS });
  if (m.method !== 'tools/call') return rpcError(res, m.id, -32601, 'Método não encontrado.', 404);
  const name = m.params?.name;
  const ferramentaLogistica = logistica.mcpTools.find(t => t.name === name);
  const ferramentaDetalhada = [TOOL_CLIENTE_ID, TOOL_LOGISTICA].find(t => t.name === name);
  if (name !== 'buscar_clientes' && !ferramentaLogistica && !ferramentaDetalhada) {
    return rpcError(res, m.id, -32602, 'Ferramenta não encontrada.');
  }
  const args = m.params.arguments === undefined ? {} : m.params.arguments;
  const allowed = (name === 'buscar_clientes' ? TOOL : ferramentaDetalhada || ferramentaLogistica).inputSchema.properties;
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(k => !Object.prototype.hasOwnProperty.call(allowed, k))) {
    return rpcError(res, m.id, -32602, 'Parâmetros inválidos.');
  }
  try {
    const result = name === 'buscar_clientes' ? await buscar(args)
      : name === 'consultar_cliente' ? await consultas.consultarCliente(args)
      : name === 'listar_excursoes_transportadoras' ? await consultas.listarExcursoesTransportadoras(args)
      : await logistica.executeTool(name, args);
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false
    });
  } catch (err) {
    console.error('[mcp/clientes] Consulta:', err.message);
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: 'Não foi possível concluir a consulta à Alumínio JR. Confira os parâmetros e tente novamente.' }],
      isError: true
    });
  }
});
module.exports = router;
