const express = require('express');
const controller = require('../../../controllers/legado/cheques/cheques.controller');
const sqlTerminal = require('../../../services/admin/sql-terminal.service');
const bridge = require('../../../services/legado/legadoBridge.service');
const { requireAuth } = require('../../../middlewares/adminAuth.middleware');

const router = express.Router();
const PAGE_SIZE = 50;
const DETAIL_SIZE = 200;
const MAX_CODE = 2147483647;

function integer(value, { min = 0, max = MAX_CODE } = {}) {
  if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function normalized(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase().replace(/_/g, ''), value]));
}

async function select(sql) {
  const result = await sqlTerminal.executarConsulta(sql);
  if (!result || !Array.isArray(result.linhas) || result.truncado === true ||
      (result.quantidade_linhas != null && Number(result.quantidade_linhas) > result.linhas.length)) {
    throw new Error('Resposta incompleta ou inválida da consulta SQL de encaminhamentos.');
  }
  return result.linhas.map(normalized);
}

function numeric(value, name) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) {
    throw new Error('Campo inválido na consulta de encaminhamentos: ' + name);
  }
  return Number(value);
}

function failure(res, error) {
  console.error('Erro na consulta direta de encaminhamentos do Firebird:', error);
  return res.status(502).json({ success: false, message: 'Não foi possível consultar os encaminhamentos no Firebird. Tente atualizar os dados.' });
}

router.get('/', controller.listarCheques);

// Consultas fixas, somente leitura, com a mesma autenticação do terminal SQL.
// O navegador nunca fornece SQL. O cursor é apenas um código inteiro validado.
router.get('/encaminhamentos', requireAuth, async (req, res) => {
  const cursor = req.query.antes === undefined ? null : integer(req.query.antes, { min: 1 });
  if (req.query.antes !== undefined && cursor === null) {
    return res.status(400).json({ success: false, message: 'Cursor de encaminhamento inválido.' });
  }
  try {
    // Limitar os cabeçalhos ANTES das junções evita agrupar todo o histórico
    // de cheques para devolver apenas 50 encaminhamentos à página.
    const where = cursor === null ? '' : 'WHERE codigo < ' + cursor;
    const startedAt = Date.now();
    const rows = await select(`
      SELECT gce.codigo AS codigo, f.nome AS fornecedor,
        gce.descricao AS descricao, gce.data AS data_encaminhamento,
        COUNT(gvp.codigo) AS quantidade, COALESCE(SUM(gvp.valor), 0) AS valor_total
      FROM (
        SELECT FIRST ${PAGE_SIZE + 1} codigo, favorecido, descricao, data
        FROM george_cheques_encaminha
        ${where}
        ORDER BY codigo DESC
      ) gce
      LEFT JOIN george_cheques_escolha gces ON gce.codigo = gces.cheque_encaminha_cod
      LEFT JOIN george_vendas_pgto gvp ON gces.carrada_pedidos_pgto_cod = gvp.codigo
      LEFT JOIN favorecidos f ON gce.favorecido = f.favorecido
      GROUP BY gce.codigo, f.nome, gce.descricao, gce.data
      ORDER BY gce.codigo DESC
    `);
    console.info('[cheques] Encaminhamentos: SQL do Firebird respondeu em ' + (Date.now() - startedAt) + ' ms; grupos=' + rows.length);
    const dados = rows.slice(0, PAGE_SIZE).map(r => ({
      id: String(numeric(r.codigo, 'codigo')),
      date: r.dataencaminhamento ?? '',
      supplier: r.fornecedor ?? '',
      description: r.descricao ?? '',
      count: numeric(r.quantidade, 'quantidade'),
      total: numeric(r.valortotal, 'valor_total')
    }));
    if (dados.some((g, i) => !integer(g.id, {min:1}) || (i > 0 && Number(g.id) >= Number(dados[i - 1].id)) || (cursor !== null && Number(g.id) >= cursor))) {
      throw new Error('Ordenação ou código inválido na lista de encaminhamentos.');
    }
    return res.json({ success: true, dados, nextCursor: rows.length > PAGE_SIZE ? dados[dados.length - 1].id : null });
  } catch (error) {
    return failure(res, error);
  }
});

// Gravação pela API local. O Firebird permanece a fonte de verdade.
router.get('/encaminhamentos/fornecedores', requireAuth, async (req, res) => {
  try {
    const result = await bridge.get('/api/cheques/encaminhamentos/fornecedores');
    if (result?.success !== true || result.versao !== 1 || !Array.isArray(result.dados)) throw new Error('API local incompatível');
    const dados = result.dados.map(f => ({id: integer(String(f.id), {min:1}), nome: String(f.nome || '').trim()})).filter(f => f.id !== null && f.nome);
    return res.json({success:true, dados});
  } catch (error) {
    console.error('[cheques] API local de fornecedores indisponível:', error.message);
    return res.status(503).json({success:false,message:'A gravação depende da atualização da API local da fábrica.'});
  }
});

router.post('/encaminhamentos', requireAuth, async (req, res) => {
  if (!req.is('application/json')) return res.status(415).json({success:false,message:'Envie JSON.'});
  const body = req.body || {};
  const data = typeof body.data === 'string' ? body.data : '';
  const dt = new Date(data+'T00:00:00Z');
  const fornecedorId = integer(String(body.fornecedorId ?? ''), {min:1});
  const observacao = body.observacao ?? '';
  const cheques = Array.isArray(body.cheques) ? body.cheques.map(x => integer(String(x), {min:1})) : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(+dt) || dt.toISOString().slice(0,10)!==data || Number(data.slice(0,4))<1900 || fornecedorId===null ||
      typeof observacao !== 'string' || observacao.length>100 || cheques.length<1 || cheques.length>200 || cheques.includes(null) || new Set(cheques).size!==cheques.length) {
    return res.status(400).json({success:false,message:'Confira a data, o fornecedor, a observação (até 100 caracteres) e os cheques (1 a 200, sem repetição).'});
  }
  try {
    const result = await bridge.post('/api/cheques/encaminhamentos', {data,fornecedorId,observacao,cheques});
    const codigo = integer(String(result?.dados?.codigo ?? ''), {min:1});
    if (result?.success !== true || codigo===null || Number(result.dados.quantidade)!==cheques.length || !Number.isFinite(Number(result.dados.valorTotal))) throw new Error('Confirmação de gravação inválida');
    return res.status(201).json({success:true,dados:{codigo,quantidade:cheques.length,valorTotal:Number(result.dados.valorTotal)}});
  } catch(error) {
    console.error('[cheques] gravação não confirmada:', error.message);
    return res.status(502).json({success:false,message:'Gravação não confirmada. Confira os encaminhamentos e os cheques disponíveis antes de tentar novamente.'});
  }
});

router.get('/encaminhamentos/:codigo', requireAuth, async (req, res) => {
  const codigo = integer(req.params.codigo, { min: 1 });
  const offset = req.query.offset === undefined ? 0 : integer(req.query.offset);
  if (codigo === null || offset === null) {
    return res.status(400).json({ success: false, message: 'Código ou página de encaminhamento inválido.' });
  }
  try {
    const rows = await select(`
      SELECT FIRST ${DETAIL_SIZE + 1} SKIP ${offset}
        gc.codigo AS codigo_escolha, gvp.codigo AS codigo,
        gvp.numero_cheque AS numero_cheque, gvp.titular_cheque AS titular_cheque,
        gvp.data_vencimento AS data_vencimento, f.nome AS cliente, gvp.valor AS valor
      FROM george_cheques_escolha gc
      JOIN george_vendas_pgto gvp ON gc.carrada_pedidos_pgto_cod = gvp.codigo
      LEFT JOIN george_vendas gv ON gvp.cod_venda = gv.codigo
      LEFT JOIN favorecidos f ON gv.favorecido = f.favorecido
      WHERE gc.cheque_encaminha_cod = ${codigo}
      ORDER BY gvp.data_vencimento, gc.codigo
    `);
    const dados = rows.slice(0, DETAIL_SIZE).map(r => ({
      codigo: r.codigo,
      numeroCheque: r.numerocheque ?? '',
      titularCheque: r.titularcheque ?? '',
      dataVencimento: r.datavencimento ?? '',
      cliente: r.cliente ?? '',
      valor: numeric(r.valor, 'valor')
    }));
    return res.json({ success: true, dados, nextOffset: rows.length > DETAIL_SIZE ? offset + DETAIL_SIZE : null });
  } catch (error) {
    return failure(res, error);
  }
});

module.exports = router;
