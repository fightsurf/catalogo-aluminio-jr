'use strict';

// MCP Streamable HTTP stateless: primeira fase pública de teste, somente consultas.
// NÃO expor telefones, observações, clientes, pedidos ou ferramentas de escrita.
// Remover acesso anônimo e exigir autenticação antes de ampliar escopo.
const express = require('express');
const transportadorasService = require('../../services/logistica/transportadoraService');
const logisticaService = require('../../services/logistica/logisticaService');

const router = express.Router();
const PROTOCOL_VERSION = '2025-06-18';
const NAME = 'aluminio-jr-consultas';
const VERSION = '0.1.0';

const tools = [
  {
    name: 'consultar_transportadoras',
    title: 'Consultar transportadoras',
    description: 'Consulta até 20 transportadoras cadastradas na Alumínio JR, opcionalmente por parte do nome. Retorna somente ID, nome, cidade e UF; nunca retorna telefones.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: { nome: { type: 'string', maxLength: 120, description: 'Nome ou parte do nome da transportadora. Pode ficar vazio para listar as primeiras 20.' } },
      additionalProperties: false
    }
  },
  {
    name: 'buscar_cidades',
    title: 'Buscar cidades',
    description: 'Busca cidades cadastradas pelo nome e retorna nome, UF e ID.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: { nome: { type: 'string', minLength: 2, maxLength: 120 } },
      required: ['nome'],
      additionalProperties: false
    }
  },
  {
    name: 'listar_cidades_da_transportadora',
    title: 'Listar cidades atendidas',
    description: 'Lista cidades vinculadas a uma transportadora por ID, sem informações de contato ou observações.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: { transportadora_id: { type: 'integer', minimum: 1 } },
      required: ['transportadora_id'],
      additionalProperties: false
    }
  },
  {
    name: 'transportadoras_por_cidade',
    title: 'Transportadoras que atendem uma cidade',
    description: 'Consulta transportadoras que atendem uma cidade (ex.: Patos, PB) e retorna apenas nomes e origem, sem telefone nem observações.',
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        cidade: { type: 'string', minLength: 2, maxLength: 100 },
        uf: { type: 'string', minLength: 2, maxLength: 2, description: 'UF opcional, como PB ou PE.' }
      },
      required: ['cidade'],
      additionalProperties: false
    }
  }
];

function invalid(message) {
  const err = new Error(message);
  err.code = -32602;
  return err;
}

function isNonemptyString(v, max = 120) {
  return typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= max;
}

function readArguments(params) {
  const args = params && typeof params.arguments === 'object' && params.arguments !== null && !Array.isArray(params.arguments)
    ? params.arguments : {};
  return args;
}

async function executeTool(name, args) {
  switch (name) {
    case 'consultar_transportadoras': {
      if (args.nome !== undefined && (typeof args.nome !== 'string' || args.nome.length > 120)) {
        throw invalid('O filtro nome deve ter até 120 caracteres.');
      }
      const rows = await transportadorasService.listarTransportadoras();
      const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const filtro = normalizar(String(args.nome || '').trim());
      const result = (filtro ? rows.filter(r => normalizar(r.nome).includes(filtro)) : rows);
      return {
        total_encontrado: result.length,
        exibindo: Math.min(result.length, 20),
        transportadoras: result.slice(0, 20).map(r => ({
          id: r.id, nome: r.nome, cidade: r.cidade_nome || null, uf: r.cidade_estado || null
        }))
      };
    }
    case 'buscar_cidades': {
      if (!isNonemptyString(args.nome)) throw invalid('Informe o nome da cidade (2 a 120 caracteres).');
      const rows = await logisticaService.buscarCidadesPorNome(args.nome.trim());
      return { total: rows.length, cidades: rows.map(r => ({ id: r.id, nome: r.nome, uf: r.estado })) };
    }
    case 'listar_cidades_da_transportadora': {
      const id = Number(args.transportadora_id);
      if (!Number.isSafeInteger(id) || id < 1) throw invalid('Informe um ID de transportadora válido.');
      const rows = await logisticaService.listarCidades(id);
      return {
        transportadora_id: id,
        total_encontrado: rows.length,
        cidades: rows.slice(0, 100).map(r => ({ nome: r.nome, uf: r.estado, codigo_ibge: r.codigo_ibge }))
      };
    }
    case 'transportadoras_por_cidade': {
      if (!isNonemptyString(args.cidade, 100)) throw invalid('Informe a cidade (2 a 100 caracteres).');
      if (args.uf !== undefined && (typeof args.uf !== 'string' || !/^[A-Za-z]{2}$/.test(args.uf))) {
        throw invalid('UF deve ter exatamente duas letras.');
      }
      const cidade = args.cidade.trim() + (args.uf ? ' - ' + args.uf.toUpperCase() : '');
      const result = await logisticaService.buscarTransportadorasPorNomeCidade(cidade);
      if (result.tipo === 'resultado') {
        return {
          tipo: 'resultado',
          cidade: args.cidade.trim(), uf: args.uf ? args.uf.toUpperCase() : null,
          total: result.dados.length,
          transportadoras: result.dados.slice(0, 40).map(r => ({
            id: r.id, nome: r.nome,
            cidade_origem: r.transportadora_cidade_nome || null,
            uf_origem: r.transportadora_cidade_estado || null
          }))
        };
      }
      if (result.tipo === 'sugestao') {
        return { tipo: 'sugestao', cidades: (result.cidades || []).slice(0, 20).map(r => ({ nome: r.nome, uf: r.estado })) };
      }
      if (result.tipo === 'sem_frete') return { tipo: 'sem_frete', cidade: result.cidade, uf: result.estado };
      return { tipo: 'nao_encontrada' };
    }
    default:
      throw invalid('Ferramenta não encontrada.');
  }
}

function reply(res, id, result) {
  return res.status(200).json({ jsonrpc: '2.0', id, result });
}

function error(res, id, code, message, status = 200) {
  return res.status(status).json({ jsonrpc: '2.0', id, error: { code, message } });
}

// Evita uso via páginas de terceiros. Chamadas backend sem Origin são permitidas.
router.use((req, res, next) => {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    const selfHost = req.hostname.toLowerCase();
    if (u.protocol === 'https:' && (host === 'chatgpt.com' || host === 'chat.openai.com' || host === selfHost)) return next();
  } catch (_err) { /* Origin malformado */ }
  return res.status(403).json({ erro: 'Origin não permitido.' });
});

// Pedidos possuem autenticação própria e não ficam disponíveis no MCP público de consultas.
router.use('/pedidos', require('./mcpPedidos.routes'));

// Endpoint legível por navegador para diagnóstico, sem revelar dados privados.
router.get('/status', (_req, res) => {
  res.json({ ok: true, servidor: NAME, versao: VERSION, mcp: '/mcp', autenticacao: 'temporariamente desativada', ferramentas: tools.map(t => t.name), somente_leitura: true });
});

// MCP 2025-06-18: stateless HTTP. Não oferece SSE por GET.
router.get('/', (_req, res) => res.status(405).set('Allow', 'POST').end());
router.delete('/', (_req, res) => res.status(405).set('Allow', 'POST').end());

router.post('/', async (req, res) => {
  const msg = req.body;
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return error(res, null, -32600, 'Requisição JSON-RPC inválida.', 400);
  }

  // Notificações são aceitas sem resposta JSON-RPC.
  if (!Object.prototype.hasOwnProperty.call(msg, 'id')) return res.status(202).end();

  try {
    switch (msg.method) {
      case 'initialize':
        return reply(res, msg.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: NAME, version: VERSION },
          instructions: 'Consultar apenas dados de transportadoras e cidades da Alumínio JR. Ferramentas somente leitura. Dados de contato não são expostos.'
        });
      case 'ping':
        return reply(res, msg.id, {});
      case 'tools/list':
        return reply(res, msg.id, { tools });
      case 'tools/call': {
        const params = msg.params || {};
        if (!params || typeof params.name !== 'string') throw invalid('Informe o nome da ferramenta.');
        const output = await executeTool(params.name, readArguments(params));
        return reply(res, msg.id, {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
          isError: false
        });
      }
      default:
        return error(res, msg.id, -32601, 'Método MCP não encontrado.', 404);
    }
  } catch (err) {
    if (err.code === -32602) return error(res, msg.id, -32602, err.message);
    console.error('[mcp/logistica] Falha na consulta:', err);
    return reply(res, msg.id, {
      content: [{ type: 'text', text: 'Falha ao consultar dados da Alumínio JR.' }],
      isError: true
    });
  }
});

// Reutiliza as mesmas consultas no MCP autenticado de clientes, sem expor
// dados de contato ou operações de gravação.
module.exports = router;
module.exports.mcpTools = tools;
module.exports.executeTool = executeTool;
