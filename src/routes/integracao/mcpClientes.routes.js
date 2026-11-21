'use strict';

const express = require('express');
const auth = require('../../services/integracao/mcpClientesOAuth.service');
const clientesService = require('../../services/legado/clientes/clientes.service');

const router = express.Router();
const PROTOCOL = '2025-06-18';
const TOOL = {
  name: 'buscar_clientes',
  title: 'Buscar clientes da Alumínio JR',
  description: 'Use esta ferramenta quando o usuário pedir para procurar cliente por nome na Alumínio JR. Busca somente clientes existentes. Exibe código favorecido, nome, cidade e UF; não mostra telefones, CPF, observações nem pedidos. Nunca cadastra nem altera dados.',
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
  const clientes = encontrados.slice(0, 10).map(c => ({
    favorecido: c.favorecido ?? null,
    nome: String(c.nome || c.razao_social || c.fantasia || '').trim(),
    cidade: c.cidade || null,
    uf: c.uf || null
  }));
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
      instructions: 'Pesquise clientes por nomes no sistema Alumínio JR. Se houver mais de um cliente com nome semelhante, apresente os códigos e peça esclarecimento. Não invente dados. Este conector é exclusivamente de leitura.'
    });
  }
  if (m.method === 'ping') return jsonrpc(res, m.id, {});
  if (m.method === 'tools/list') return jsonrpc(res, m.id, { tools: [TOOL] });
  if (m.method !== 'tools/call') return rpcError(res, m.id, -32601, 'Método não encontrado.', 404);
  if (m.params?.name !== 'buscar_clientes') {
    return rpcError(res, m.id, -32602, 'Ferramenta não encontrada.');
  }
  const args = m.params.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(k => k !== 'nome')) {
    return rpcError(res, m.id, -32602, 'Parâmetros inválidos.');
  }
  try {
    const result = await buscar(args);
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false
    });
  } catch (err) {
    console.error('[mcp/clientes] Consulta:', err.message);
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: 'Não foi possível consultar clientes. Verifique o nome ou tente novamente.' }],
      isError: true
    });
  }
});
module.exports = router;
