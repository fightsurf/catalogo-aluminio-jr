'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const auth = require('../../services/integracao/mcpClientesOAuth.service');
const clientesService = require('../../services/legado/clientes/clientes.service');
const logistica = require('./mcpLogistica.routes');
const pedidosMcp = require('./mcpPedidosTools');
const importacaoCidadesMcp = require('./mcpImportacaoCidadesTools');
const validacao = require('./mcpValidacao');
const { outputSchemaFor } = require('./mcpOutputSchemas');
const { validateProtocolRequest } = require('./mcpProtocol');
const consultas = require('../../services/integracao/mcpConsultasDetalhadas.service');

const router = express.Router();
const VERSION = '1.5.0';
function auditar(ferramenta, rastreio, etapa) {
  // Apenas nomes de ferramentas validados (ou null antes da autenticação)
  // e etapas constantes. Não registrar argumentos,
  // usuário, telefone, tokens, códigos de confirmação ou mensagens de transporte.
  console.info('[mcp/auditoria]', JSON.stringify({ versao: VERSION, ferramenta, rastreio, etapa }));
}
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
})), ...pedidosMcp.tools, ...importacaoCidadesMcp.tools]
  .map(t => ({ ...t, outputSchema: outputSchemaFor(t.name) }));
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
async function buscar({ nome } = {}) {
  if (typeof nome !== 'string' || nome.trim().length < 3 || nome.trim().length > 100) {
    throw new Error('Informe pelo menos três caracteres do nome do cliente.');
  }
  const termo = nome.trim();
  let rows;
  try {
    rows = await clientesService.listarClientes({ nome: termo });
  } catch (error) {
    // Algumas versões da bridge rejeitam pesquisas longas (ex.: nome completo
    // de Júnior Representante). Consultar pelo prefixo e filtrar pelo nome
    // completo em memória evita respostas erradas sem perder a validação.
    if (termo.length <= 18) throw error;
    rows = await clientesService.listarClientes({ nome: termo.slice(0, 18) });
  }
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
  req.mcpRastreio = randomUUID();
  req.mcpMeta = { 'aluminiojr/versao': VERSION, 'aluminiojr/rastreio': req.mcpRastreio };
  res.set('Cache-Control', 'no-store');
  res.set('X-MCP-Rastreio', req.mcpRastreio);
  res.set('X-MCP-Versao', VERSION);
  if (!auth.enabled()) {
    auditar(null, req.mcpRastreio, 'servico_desativado');
    return res.status(503).json({ erro: 'MCP de clientes desativado.', _meta: req.mcpMeta });
  }
  const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') || '');
  try {
    const credential = bearer ? await auth.validateAccess(bearer[1]) : null;
    if (!credential) {
      auditar(null, req.mcpRastreio, 'autenticacao_necessaria');
      res.set('WWW-Authenticate', 'Bearer resource_metadata="' + auth.metadataUrl() + '", scope="clientes:read"');
      return res.status(401).json({ erro: 'Autorização OAuth necessária.', _meta: req.mcpMeta });
    }
    req.oauthUser = credential.user;
    req.oauthScopes = credential.scope;
    return next();
  } catch {
    auditar(null, req.mcpRastreio, 'autenticacao_indisponivel');
    return res.status(503).json({ erro: 'Falha temporária na autenticação.', _meta: req.mcpMeta });
  }
});
router.get('/status', (req, res) => {
  const scopes = new Set(String(req.oauthScopes || '').split(/\s+/));
  const pedidosHabilitados = process.env.MCP_PEDIDOS_ENABLED === 'true';
  const podeImportarCidades = importacaoCidadesMcp.requiredScopes('confirmar_importacao_cidades').every(s => scopes.has(s));
  const podeEscrever = podeImportarCidades || (pedidosHabilitados && pedidosMcp.tools.some(t =>
    t.annotations.readOnlyHint === false && pedidosMcp.requiredScopes(t.name).every(s => scopes.has(s))));
  return res.json({ ok: true, versao: VERSION, escopos: [...scopes],
    pedidos_habilitados: pedidosHabilitados, importacao_cidades_habilitada: true,
    pode_importar_cidades: podeImportarCidades, somente_leitura: !podeEscrever });
});
function metodoNaoSuportado(req, res) {
  const protocolo = validateProtocolRequest(null, req.get('MCP-Protocol-Version'));
  if (!protocolo.ok) return rpcError(res, null, protocolo.code, protocolo.message, protocolo.status);
  return res.status(405).set('Allow', 'POST').end();
}
router.get('/', metodoNaoSuportado);
router.delete('/', metodoNaoSuportado);
router.post('/', async (req, res) => {
  const m = req.body;
  if (!m || typeof m !== 'object' || Array.isArray(m) ||
      m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return rpcError(res, null, -32600, 'JSON-RPC inválido.', 400);
  }
  const protocolo = validateProtocolRequest(m, req.get('MCP-Protocol-Version'));
  if (!protocolo.ok) {
    auditar(null, req.mcpRastreio, 'protocolo_invalido');
    return rpcError(res, m.id ?? null, protocolo.code, protocolo.message, protocolo.status);
  }
  if (!Object.prototype.hasOwnProperty.call(m, 'id')) return res.status(202).end();
  if (m.method === 'initialize') {
    return jsonrpc(res, m.id, {
      protocolVersion: protocolo.protocolVersion,
      // HTTP sem stream de notificações: o catálogo precisa ser atualizado pelo cliente.
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'aluminio-jr-clientes', version: VERSION },
      instructions: 'Consulte clientes, logística e pedidos. Por cliente, permita último cadastrado, histórico paginado e filtro sem data de expedição; respeite avisos de dados incompletos e homônimos. Ao preparar um novo pedido com carrada informada por data, consulte buscar_carradas naquele momento e use o código retornado internamente. Não peça o código ao usuário. Se houver várias correspondências, peça a escolha pela descrição; se não houver, esclareça a data antes de preparar. Não reutilize carrada de outro pedido. Preparar cria somente prévia. A criação confirma somente o pedido e a carrada, sem WhatsApp. Para o aviso de entrada solicitado, depois da gravação use preparar_whatsapp_pedido com tipo aviso_carrada usando o id_mestre real; apresente destinatário e texto e obtenha confirmação do envio. Falha no aviso não exige repetir a gravação. Para criar, alterar, cancelar, registrar expedição ou enviar WhatsApp, leia o resumo e todos os efeitos, aguarde confirmação expressa posterior e use o confirmador correspondente. Expedição usa a ação completa de Progresso com seus avisos. As ações de pedidos são individuais, sem enviar para todos. Para enviar saldos dos últimos pedidos de UM cliente por WhatsApp, use preparar_whatsapp_pagamentos_cliente (ordem numérica decrescente, padrão 3). Mostre o resumo e o texto de cada mensagem e aguarde autorização explícita posterior; depois use confirmar_whatsapp_pagamentos_cliente. Nunca envie sem confirmação, nem repita operação parcial ou incerta. Para importar cidades de uma transportadora, use preparar_importacao_cidades com os nomes e UFs fornecidos, apresente a lista e resolva pendências; depois da aprovação, confirme com confirmar_importacao_cidades e o token da prévia. A importação apenas acrescenta vínculos, preserva os existentes e não envia mensagens. Nunca repita efeitos incertos. Não invente dados nem alegue entrega pelo simples aceite do provedor.'
    });
  }
  if (m.method === 'ping') return jsonrpc(res, m.id, {});
  if (m.method === 'tools/list') return jsonrpc(res, m.id, {
    tools: process.env.MCP_PEDIDOS_ENABLED === 'true' ? TOOLS : TOOLS.filter(t => !pedidosMcp.isPedido(t.name))
  });
  if (m.method !== 'tools/call') return rpcError(res, m.id, -32601, 'Método não encontrado.', 404);
  const name = m.params?.name;
  const ferramentaLogistica = logistica.mcpTools.find(t => t.name === name);
  const ferramentaDetalhada = [TOOL_CLIENTE_ID, TOOL_LOGISTICA].find(t => t.name === name);
  const ferramentaPedido = pedidosMcp.tools.find(t => t.name === name);
  const ferramentaImportacao = importacaoCidadesMcp.tools.find(t => t.name === name);
  if (name !== 'buscar_clientes' && !ferramentaLogistica && !ferramentaDetalhada && !ferramentaPedido && !ferramentaImportacao) {
    return rpcError(res, m.id, -32602, 'Ferramenta não encontrada.');
  }
  const rastreio = req.mcpRastreio;
  const meta = req.mcpMeta;
  auditar(name, rastreio, 'recebida');
  const necessarios = ferramentaPedido ? pedidosMcp.requiredScopes(name)
    : ferramentaImportacao ? importacaoCidadesMcp.requiredScopes(name) : ['clientes:read'];
  const concedidos = new Set(String(req.oauthScopes || '').split(/\s+/));
  if (necessarios.some(scope => !concedidos.has(scope))) {
    auditar(name, rastreio, 'escopo_insuficiente');
    const challenge = 'Bearer resource_metadata="' + auth.metadataUrl() + '", scope="' + necessarios.join(' ') + '", error="insufficient_scope", error_description="This action requires additional OAuth scopes."';
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: 'Esta ação precisa de autorização adicional no plugin Alumínio JR: ' + necessarios.filter(s => !concedidos.has(s)).join(', ') + '.' }],
      _meta: { ...meta, 'mcp/www_authenticate': [challenge] },
      isError: true
    });
  }
  const args = m.params.arguments === undefined ? {} : m.params.arguments;
  const schema = (name === 'buscar_clientes' ? TOOL : ferramentaDetalhada || ferramentaPedido || ferramentaImportacao || ferramentaLogistica).inputSchema;
  if (!validacao.validar(schema, args)) {
    auditar(name, rastreio, 'parametros_invalidos');
    return rpcError(res, m.id, -32602, 'Parâmetros inválidos. Confira campos obrigatórios, tipos, códigos internos e limites.');
  }
  try {
    const result = name === 'buscar_clientes' ? await buscar(args)
      : name === 'consultar_cliente' ? await consultas.consultarCliente(args)
      : name === 'listar_excursoes_transportadoras' ? await consultas.listarExcursoesTransportadoras(args)
      : ferramentaPedido ? await pedidosMcp.executeTool(name, args, { usuario: req.oauthUser, scopes: req.oauthScopes })
      : ferramentaImportacao ? await importacaoCidadesMcp.executeTool(name, args, { usuario: req.oauthUser, scopes: req.oauthScopes })
      : await logistica.executeTool(name, args);
    const status = ['confirmado', 'aguardando_confirmacao', 'em_processamento', 'revisao_necessaria',
      'parcial', 'nao_enviado', 'resultado_incerto', 'aceito_pelo_provedor'].includes(result?.status)
      ? result.status : 'concluida';
    auditar(name, rastreio, status);
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      _meta: meta,
      isError: false
    });
  } catch (err) {
    auditar(name, rastreio, err.isValidation ? 'erro_validacao' : 'erro_operacao');
    return jsonrpc(res, m.id, {
      content: [{ type: 'text', text: err.isValidation ? err.message : 'Não foi possível concluir a operação na Alumínio JR. Para ações de escrita ou envio, consulte o rascunho/ação e confira o resultado antes de qualquer nova tentativa.' }],
      _meta: meta,
      isError: true
    });
  }
});
module.exports = router;

