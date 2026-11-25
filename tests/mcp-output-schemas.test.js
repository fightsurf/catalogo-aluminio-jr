'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const crypto = require('node:crypto');
const { outputSchemaFor } = require('../src/routes/integracao/mcpOutputSchemas');
const { validar } = require('../src/routes/integracao/mcpValidacao');

function carregar(arquivo, deps) {
  const caminho = path.join(__dirname, '..', arquivo);
  const localRequire = createRequire(caminho);
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(caminho, 'utf8'))(
    nome => Object.prototype.hasOwnProperty.call(deps, nome) ? deps[nome] : localRequire(nome),
    modulo, modulo.exports
  );
  return modulo.exports;
}
function conferir(nome, resultado) {
  // Express serializa Date e omite undefined antes de entregar structuredContent.
  const json = JSON.parse(JSON.stringify(resultado));
  assert.ok(validar(outputSchemaFor(nome), json), 'Saída incompatível: ' + nome + '\n' + JSON.stringify(json));
  return json;
}

test('cada ferramenta publicada possui contrato de saída significativo', () => {
  const nomes = new Set();
  for (const arquivo of ['mcpClientes.routes.js', 'mcpLogistica.routes.js', 'mcpPedidosTools.js',
    'mcpAcoesPedidosTools.js', 'mcpImportacaoCidadesTools.js']) {
    const fonte = fs.readFileSync(path.join(__dirname, '../src/routes/integracao', arquivo), 'utf8');
    for (const match of fonte.matchAll(/(?:name:\s*|definir\()'([a-z_]+)'/g)) {
      // serverInfo.name usa hífens, portanto não entra nesta seleção.
      nomes.add(match[1]);
    }
  }
  assert.equal(nomes.size, 28);
  for (const nome of nomes) {
    const schema = outputSchemaFor(nome);
    assert.equal(schema.type, 'object', nome);
    assert.ok(Object.keys(schema.properties).length > 0, nome);
    assert.ok(schema.required.length > 0, nome);
    assert.equal(validar(schema, {}), false, nome);
    assert.equal(validar(schema, []), false, nome);
    assert.doesNotThrow(() => JSON.stringify(schema));
  }
  assert.throws(() => outputSchemaFor('nova_ferramenta_sem_contrato'), /sem contrato/);
  assert.throws(() => outputSchemaFor('toString'), /sem contrato/);
});

test('consultas públicas aceitam listas vazias, ids textuais e quatro resultados de frete', async () => {
  let tipo = 'resultado';
  const router = { use() {}, get() {}, post() {}, delete() {} };
  const logistica = carregar('src/routes/integracao/mcpLogistica.routes.js', {
    express: { Router: () => router },
    '../../services/logistica/transportadoraService': {
      listarTransportadoras: async () => [{ id: '3', nome: 'Transportadora', cidade_nome: null }]
    },
    '../../services/logistica/logisticaService': {
      buscarCidadesPorNome: async () => [],
      listarCidades: async () => [{ nome: 'Cidade', estado: 'PB', codigo_ibge: null }],
      buscarTransportadorasPorNomeCidade: async () => ({ tipo,
        dados: [{ id: 3, nome: 'Transportadora' }], cidades: [{ nome: 'Cidade', estado: 'PB' }],
        cidade: 'Cidade', estado: 'PB' })
    }
  });
  conferir('consultar_transportadoras', await logistica.executeTool('consultar_transportadoras', {}));
  conferir('buscar_cidades', await logistica.executeTool('buscar_cidades', { nome: 'Cidade' }));
  conferir('listar_cidades_da_transportadora', await logistica.executeTool('listar_cidades_da_transportadora', { transportadora_id: 3 }));
  for (tipo of ['resultado', 'sugestao', 'sem_frete', 'nao_encontrada']) {
    const r = conferir('transportadoras_por_cidade', await logistica.executeTool('transportadoras_por_cidade', { cidade: 'Cidade' }));
    assert.equal(r.tipo, tipo);
  }
});

test('consultas autenticadas preservam cliente ausente e dados legados opcionais', async () => {
  let existe = true;
  const service = carregar('src/services/integracao/mcpConsultasDetalhadas.service.js', {
    '../../../db/connection': { query: async sql => ({ rows: sql.includes('COUNT(*)')
      ? [{ total: 1 }] : [{ id: '3', nome: 'Transportadora', cidades_vinculadas: [
        { cidade: 'Cidade', uf: 'PB', codigo_ibge: null, observacao: null }
      ] }] }) },
    '../legado/clientes/clientes.service': { buscarCliente: async () => existe
      ? { favorecido: '7', nome: 'Cliente', telefonePrincipal: '83900000000' } : null }
  });
  conferir('consultar_cliente', await service.consultarCliente({ favorecido: 7 }));
  conferir('buscar_clientes', { total_encontrado: 1, exibindo: 1,
    clientes: [service.resumirCliente({ favorecido: '7', nome: 'Cliente' })] });
  existe = false;
  conferir('consultar_cliente', await service.consultarCliente({ favorecido: 7 }));
  conferir('buscar_clientes', { total_encontrado: 0, exibindo: 0, clientes: [] });
  conferir('listar_excursoes_transportadoras', await service.listarExcursoesTransportadoras({}));
});

function consultas() {
  const cliente = { favorecido: 7, nome: 'Cliente', cidade: 'Cidade', uf: 'PB' };
  const estado = { clientes: [cliente], pedidos: [], carradas: [], incompleto: false, falhaNomeLongo: false, nomesBuscados: [] };
  const service = carregar('src/services/integracao/mcpConsultaPedidos.service.js', {
    '../legado/pedido/pedidosLegado.service': {
      pesquisarPedidos: async () => estado.pedidos,
      buscarDetalhePedido: async id => estado.pedidos.find(p => Number(p.idMestre) === id) || null
    },
    '../legado/clientes/clientes.service': {
      listarClientes: async ({ nome }) => {
        estado.nomesBuscados.push(nome);
        if (estado.falhaNomeLongo && nome.length > 18) throw new Error('consulta legada excede tamanho máximo');
        return estado.clientes;
      },
      buscarCliente: async id => estado.clientes.find(c => Number(c.favorecido) === id) || null
    },
    '../legado/pedidos-cliente/pedidos-cliente.service': {
      listarPedidosPorCliente: async () => ({ cliente, dados: estado.pedidos,
        consultaIncompleta: estado.incompleto, totalOrigem: '30' })
    },
    '../legado/carradas/carradas.service': {
      listarCarradas: async () => estado.carradas, buscarResumoCarrada: async () => null
    }
  });
  return { service, estado, cliente };
}

test('resolução de nome longo faz fallback e valida nome completo', async () => {
  const { service, estado, cliente } = consultas();
  estado.clientes = [{ ...cliente, nome: 'JÚNIOR REPRESENTANTE' }];
  estado.falhaNomeLongo = true;
  const consulta = await service.consultarPedidos({ cliente: 'Júnior Representante' });
  assert.equal(consulta.cliente.nome, 'JÚNIOR REPRESENTANTE');
  assert.deepEqual(estado.nomesBuscados, ['Júnior Representante', 'Júnior Representan']);
});

test('consulta de pedidos cobre vazio, ausente, homônimos, incompleto e detalhes', async () => {
  const { service, estado, cliente } = consultas();
  conferir('consultar_pedidos', await service.consultarPedidos({ data: '2026-11-24' }));
  conferir('detalhar_pedido', await service.detalharPedido({ id_mestre: 21 }));
  conferir('consultar_pedidos', await service.consultarPedidos({ favorecido: 8 }));
  estado.clientes.push({ ...cliente, favorecido: 8 });
  const ambiguo = conferir('consultar_pedidos', await service.consultarPedidos({ cliente: 'Cliente' }));
  assert.equal(ambiguo.necessita_escolha_cliente, true);
  estado.pedidos.push({ idMestre: '21', numero: '0000021', cliente, data: '2026-11-24',
    total: '29.80', dataExpedicao: null, dataExpedicaoDisponivel: true,
    carradaAtual: { codigo: '1697', data: '2026-12-02' },
    itens: [{ item: '30', quantidade: '1', preco: '29.80', subtotal: '29.80' }] });
  estado.incompleto = true;
  const r = conferir('consultar_pedidos', await service.consultarPedidos({ favorecido: 7, ultimo: true }));
  assert.equal(r.resultado_completo, false);
  assert.equal(r.total_origem, '30');
  conferir('detalhar_pedido', await service.detalharPedido({ id_mestre: 21 }));
});

test('busca de carradas cobre nenhuma, única e múltiplas com paginação', async () => {
  const { service, estado } = consultas();
  const args = { data: '2026-12-02', limite: 1 };
  conferir('buscar_carradas', await service.buscarCarradas(args));
  estado.carradas.push({ codigo: '1697', data: '2026-12-02T00:00:00', descricao: 'QUARTA' });
  conferir('buscar_carradas', await service.buscarCarradas(args));
  estado.carradas.push({ codigo: 1698, data: '2026-12-02', descricao: 'EXTRA' });
  const r = conferir('buscar_carradas', await service.buscarCarradas(args));
  assert.equal(r.proxima_pagina, 2);
  assert.equal(r.necessita_escolha_carrada, true);
});

function pedidos() {
  const registros = new Map();
  const estado = { preco: 29.8, gravacoes: 0, erro: false,
    resultado: { pedido: { numero: '0000021', saida: 21, total: 59.6 } } };
  const produto = () => ({ id: 10, nome: 'Panela 3 litros', preco: estado.preco,
    item_legado: '99', ativo: true, perfil_orcamento: true });
  const pool = { query: async (sql, p = []) => {
    if (sql.includes('CREATE TABLE')) return { rows: [] };
    if (sql.includes('INSERT INTO')) {
      registros.set(p[0], { id: p[0], codigo_hash: p[1], payload: JSON.parse(p[2]),
        resumo: JSON.parse(p[3]), status: 'aguardando_confirmacao',
        expira_em: new Date(Date.now() + 900000), pedido_resultado: null, confirmado_em: null });
      return { rows: [] };
    }
    const row = registros.get(p[0]);
    if (sql.includes("SET status = 'em_processamento'")) {
      if (!row || row.codigo_hash !== p[1] || row.status !== 'aguardando_confirmacao'
        || row.expira_em <= new Date()) return { rows: [] };
      row.status = 'em_processamento'; return { rows: [{ payload: row.payload }] };
    }
    if (sql.includes('SELECT id, status')) return { rows: row ? [row] : [] };
    if (sql.includes("SET status='confirmado'")) {
      row.status = 'confirmado'; row.pedido_resultado = JSON.parse(p[1]); row.confirmado_em = new Date();
    } else if (sql.includes("status='revisao_necessaria'")) {
      row.status = 'revisao_necessaria'; row.erro = sql.includes('erro=$2') ? p[1] : /erro='([^']+)'/.exec(sql)?.[1];
    } else throw new Error('SQL inesperado no contrato');
    return { rows: [] };
  } };
  const service = carregar('src/services/integracao/mcpPedidos.service.js', {
    crypto, '../../../db/connection': pool,
    '../legado/clientes/clientes.service': { buscarCliente: async () => ({ nome: 'Cliente' }) },
    '../legado/vendedores/vendedores.service': {
      buscarVendedor: async () => ({ nome: 'Vendedor' }), listarVendedores: async () => [{ favorecido: '9', nome: 'Vendedor' }]
    },
    '../produto/produto.service': { buscar: async () => produto(), listar: async () => [produto()] },
    '../legado/pedidos-insercao-v2/pedidos-insercao-v2.service': { inserirPedido: async () => {
      estado.gravacoes++; if (estado.erro) throw new Error('rede'); return estado.resultado;
    } }
  });
  const preparar = async () => conferir('preparar_pedido', await service.prepararPedido({
    favorecido: 7, vendedor: 9, itens: [{ produto_id: 10, quantidade: 2 }]
  }));
  const confirmar = p => service.confirmarPedido({ rascunho_id: p.rascunho_id,
    codigo_confirmacao: p.codigo_confirmacao, confirmacao: 'CONFIRMO' });
  return { service, estado, registros, preparar, confirmar };
}

test('produtos e vendedores devolvem ids e preços no contrato publicado', async () => {
  const a = pedidos();
  conferir('buscar_produtos', await a.service.buscarProdutos({ nome: 'Panela' }));
  conferir('buscar_vendedores', await a.service.buscarVendedores({}));
});

test('criação, consulta, repetição e datas serializadas preservam resultado real', async () => {
  const a = pedidos();
  const p = await a.preparar();
  conferir('consultar_rascunho', await a.service.consultarRascunho(p));
  conferir('confirmar_pedido', await a.confirmar(p));
  const repetido = conferir('confirmar_pedido', await a.confirmar(p));
  assert.equal(a.estado.gravacoes, 1);
  assert.equal(typeof repetido.confirmado_em, 'string');
  conferir('consultar_rascunho', await a.service.consultarRascunho(p));
});

test('confirmação aceita todas as respostas de revisão sem inventar sucesso', async () => {
  for (const caso of ['expirado', 'preco_alterado', 'previa_antiga', 'sem_numero', 'erro']) {
    const a = pedidos(), p = await a.preparar();
    if (caso === 'expirado') a.registros.get(p.rascunho_id).expira_em = new Date(0);
    if (caso === 'preco_alterado') a.estado.preco++;
    if (caso === 'previa_antiga') a.registros.get(p.rascunho_id).payload.versao_fluxo = 1;
    if (caso === 'sem_numero') a.estado.resultado = { erro: 'Sem número' };
    if (caso === 'erro') a.estado.erro = true;
    const r = conferir('confirmar_pedido', await a.confirmar(p));
    assert.notEqual(r.pedido_gravado, true, caso);
    assert.notEqual(r.status, 'confirmado', caso);
  }
  // Respostas legadas malformadas continuam disponíveis para conferência.
  for (const pedido_resultado of [null, ['retorno inesperado'], 'Falha do bridge',
    { pedido: { numero: '0000021', total: '59.60' }, carradaVinculada: null }]) {
    conferir('consultar_rascunho', { rascunho_id: 'id-teste', status: 'revisao_necessaria',
      expirado: false, resumo: {}, pedido_resultado, erro: 'Conferir resultado',
      revisao_manual_necessaria: true, confirmado_em: null });
  }
});

function acoes() {
  const registros = new Map();
  const service = carregar('src/services/integracao/mcpAcoesConfirmadas.service.js', {
    crypto,
    '../../../db/connection': { query: async (sql, p = []) => {
      if (sql.includes('CREATE TABLE') || sql.includes("SET status='expirado'")) return { rows: [] };
      if (sql.includes('INSERT INTO')) {
        registros.set(p[0], { id: p[0], usuario: p[1], tipo: p[2], codigo_hash: p[3],
          payload: JSON.parse(p[4]), resumo: JSON.parse(p[5]), expira_em: new Date(p[6]),
          status: 'aguardando_confirmacao', progresso: [], resultado: null });
        return { rows: [] };
      }
      const row = registros.get(p[0]);
      if (sql.includes("SET status='em_processamento'")) {
        if (!row || row.usuario !== p[1] || row.tipo !== p[2] || row.codigo_hash !== p[3]
          || row.status !== 'aguardando_confirmacao' || row.expira_em <= new Date()) return { rows: [] };
        row.status = 'em_processamento'; return { rows: [{ payload: row.payload }] };
      }
      if (sql.includes('SELECT id, tipo')) return { rows: row ? [row] : [] };
      if (sql.includes('SET progresso=')) row.progresso.push(...JSON.parse(p[1]));
      else if (sql.includes('SET status=$2')) Object.assign(row,
        { status: p[1], resultado: JSON.parse(p[2]), concluido_em: new Date() });
      else throw new Error('SQL inesperado no contrato de ação');
      return { rows: [] };
    } }
  });
  return { service, registros };
}

test('quatro ações cobrem prévia, conclusão, consulta e confirmação repetida', async () => {
  const nomes = [['alterar_pedido', 'alteracao'], ['cancelar_pedido', 'cancelamento'],
    ['expedicao_pedido', 'expedicao'], ['whatsapp_pedido', 'whatsapp']];
  const contexto = { usuario: 'teste-contratos' };
  for (const [tipo, nome] of nomes) {
    const { service } = acoes();
    const p = conferir('preparar_' + nome + '_pedido', await service.prepararAcao({
      tipo, payload: { id_mestre: 21 }, resumo: { acao: tipo, pedido: { id_mestre: 21, numero: '0000021' } }
    }, contexto));
    const args = { acao_id: p.acao_id, codigo_confirmacao: p.codigo_confirmacao, confirmacao: 'CONFIRMO' };
    const executar = async (_payload, { registrarProgresso }) => {
      await registrarProgresso({ etapa: tipo, estado: 'iniciando' });
      return { status: 'concluido', mensagem: 'Executado', entrega_confirmada: false };
    };
    conferir('consultar_acao_pedido', await service.consultarAcao(args, contexto));
    conferir('confirmar_' + nome + '_pedido', await service.confirmarAcao(args, contexto, tipo, executar));
    conferir('confirmar_' + nome + '_pedido', await service.confirmarAcao(args, contexto, tipo, executar));
    conferir('consultar_acao_pedido', await service.consultarAcao(args, contexto));
  }
});

test('ações preservam falha anterior, efeito incerto, parcial e prazo vencido', async () => {
  const contexto = { usuario: 'teste-contratos' };
  for (const caso of ['antes', 'incerto', 'parcial', 'expirado']) {
    const { service, registros } = acoes();
    const p = await service.prepararAcao({ tipo: 'whatsapp_pedido', payload: { id_mestre: 21 }, resumo: {} }, contexto);
    if (caso === 'expirado') registros.get(p.acao_id).expira_em = new Date(0);
    const executar = async (_p, { registrarProgresso }) => {
      if (caso === 'antes') throw new Error('Validação falhou');
      await registrarProgresso({ tipo: 'texto', status: 'em_processamento', produto_id: null });
      if (caso === 'incerto') throw new Error('Timeout após envio');
      return { status: 'parcial', aceitos: 1, total: 2, entrega_confirmada: false,
        resultados: [{ ordem: 1, tipo: 'foto', status: 'aceito_pelo_provedor', id_mensagem: 'id-teste' }] };
    };
    const args = { acao_id: p.acao_id, codigo_confirmacao: p.codigo_confirmacao, confirmacao: 'CONFIRMO' };
    const r = conferir('confirmar_whatsapp_pedido', await service.confirmarAcao(args, contexto, 'whatsapp_pedido', executar));
    assert.notEqual(r.status, 'concluido');
    conferir('consultar_acao_pedido', await service.consultarAcao(args, contexto));
  }
});

test('importação cobre pendências, prévia aprovada e lote repetido sem inserções extras', async () => {
  const segredoAnterior = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'segredo-apenas-do-teste-de-contrato';
  try {
    const vinculos = new Set();
    const cidade = { id: 1, nome: 'Cidade', estado: 'PB', codigo_ibge: null };
    const query = async sql => {
      if (sql.includes('FROM transportadoras')) return { rows: [{ id: 3, nome: 'Transportadora' }] };
      if (sql.includes('FROM cidades')) return { rows: [cidade] };
      if (sql.includes('COUNT(*)')) return { rows: [{ total: vinculos.size }] };
      if (sql.includes('SELECT cidade_id')) return { rows: [...vinculos].map(cidade_id => ({ cidade_id })) };
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      throw new Error('SQL inesperado no contrato de importação');
    };
    const service = carregar('src/services/logistica/importacaoCidades.service.js', {
      'node:crypto': crypto,
      '../../../db/connection': { query, connect: async () => ({ query, release() {} }) },
      './logisticaService': { vincularCidadePorId: async (_t, id) => {
        const nova = !vinculos.has(id); vinculos.add(id); return nova;
      } }
    });
    const contexto = { usuario: 'teste-contratos' };
    const pendente = conferir('preparar_importacao_cidades', await service.prepararImportacao({
      transportadora_id: 3, cidades: [{ nome: 'Cidade', uf: '' }]
    }, contexto));
    assert.equal(pendente.token_previa, null);
    const p = conferir('preparar_importacao_cidades', await service.prepararImportacao({
      transportadora_id: 3, cidades: [{ nome: 'Cidade', uf: 'PB' }]
    }, contexto));
    conferir('confirmar_importacao_cidades', await service.confirmarImportacao({ token_previa: p.token_previa }, contexto));
    const repetido = conferir('confirmar_importacao_cidades', await service.confirmarImportacao({ token_previa: p.token_previa }, contexto));
    assert.equal(repetido.adicionadas, 0);
    assert.equal(repetido.ja_vinculadas, 1);
  } finally {
    if (segredoAnterior === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = segredoAnterior;
  }
});

test('contratos rejeitam contagens inválidas e tipos errados sem suprimir campos extras', () => {
  assert.equal(validar(outputSchemaFor('buscar_cidades'), { total: -1, cidades: [] }), false);
  assert.equal(validar(outputSchemaFor('buscar_cidades'), { total: 0, cidades: 'nenhuma' }), false);
  assert.equal(validar(outputSchemaFor('confirmar_pedido'), { status: 'confirmado' }), false);
  conferir('confirmar_pedido', { status: 'revisao_necessaria', rascunho_id: 'id-teste',
    mensagem: 'Conferir resultado', diagnostico_adicional: { origem: 'legado' } });
});
