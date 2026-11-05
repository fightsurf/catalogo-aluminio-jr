'use strict';
const pool = require('../../../db/connection');
const { validarCompra, erro } = require('./comprasValidator');
const boletos = require('./comprasBoletos.service');

async function fornecedores() {
  const { rows } = await pool.query('SELECT id, nome FROM public.fornecedores ORDER BY nome');
  return rows;
}
async function insumos() {
  const { rows } = await pool.query('SELECT id, nome, unidade_medida FROM public.insumos WHERE ativo = TRUE ORDER BY nome');
  return rows;
}
async function listar({ fornecedor_id, busca } = {}) {
  const valores = [];
  const filtros = [];
  if (fornecedor_id) {
    const id = Number(fornecedor_id);
    if (!Number.isSafeInteger(id) || id < 1) throw erro('Fornecedor inválido.');
    valores.push(id); filtros.push('n.fornecedor_id = $' + valores.length);
  }
  if (busca) { valores.push('%' + String(busca).trim().slice(0,80) + '%');
    filtros.push('(n.numero_nf ILIKE $' + valores.length + ' OR f.nome ILIKE $' + valores.length + ')');
  }
  const { rows } = await pool.query(
    'SELECT n.*, f.nome AS fornecedor_nome, ' +
    '(SELECT COUNT(*)::int FROM public.compras_itens i WHERE i.nota_id=n.id) AS linhas_cadastradas, ' +
    '(SELECT COUNT(*)::int FROM public.compras_boletos b WHERE b.nota_id=n.id) AS boletos_quantidade ' +
    'FROM public.compras_notas n JOIN public.fornecedores f ON f.id=n.fornecedor_id ' +
    (filtros.length ? 'WHERE '+filtros.join(' AND ')+' ' : '') + 'ORDER BY n.criado_em DESC LIMIT 200', valores
  );
  return rows;
}
async function buscar(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id)<1) throw erro('Nota inválida.');
  const { rows:[nota] } = await pool.query(
    'SELECT n.*, f.nome AS fornecedor_nome FROM public.compras_notas n JOIN public.fornecedores f ON f.id=n.fornecedor_id WHERE n.id=$1', [id]);
  if (!nota) throw erro('Nota fiscal não encontrada.',404);
  const { rows:itens } = await pool.query(
    'SELECT id, insumo_id, descricao, unidade, quantidade, preco_unitario, valor_total, posicao FROM public.compras_itens WHERE nota_id=$1 ORDER BY posicao', [id]);
  return { ...nota, itens, boletos:await boletos.listar(id) };
}
async function gravar(dados, id = null) {
  const compra = validarCompra(dados);
  const listaBoletos=dados.boletos===undefined?undefined:boletos.validarBoletos(dados.boletos);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const f = await cliente.query('SELECT 1 FROM public.fornecedores WHERE id=$1', [compra.fornecedor_id]);
    if (!f.rowCount) throw erro('Fornecedor não encontrado.');
    const ids = [...new Set(compra.itens.map(i=>i.insumo_id).filter(Boolean))];
    if (ids.length) {
      const validos = await cliente.query('SELECT id FROM public.insumos WHERE id = ANY($1::int[])', [ids]);
      if (validos.rowCount !== ids.length) throw erro('Algum insumo selecionado não existe.');
    }
    const campos = [compra.fornecedor_id, compra.numero_nf, compra.data_nf, compra.valor_nf,
      compra.quantidade_itens_nf, compra.valor_frete, compra.icms_frete, compra.origem];
    let nota;
    if (id !== null) {
      if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw erro('Nota inválida.');
      const bloqueada = await cliente.query('SELECT id FROM public.compras_notas WHERE id=$1 FOR UPDATE',[id]);
      if (!bloqueada.rowCount) throw erro('Nota fiscal não encontrada.',404);
      const r = await cliente.query(
        'UPDATE public.compras_notas SET fornecedor_id=$1,numero_nf=$2,data_nf=$3,valor_nf=$4,quantidade_itens_nf=$5,valor_frete=$6,icms_frete=$7,origem=$8,atualizado_em=NOW() WHERE id=$9 RETURNING id',
        [...campos,id]);
      nota = r.rows[0];
      await cliente.query('DELETE FROM public.compras_itens WHERE nota_id=$1',[nota.id]);
    } else {
      const r = await cliente.query(
        'INSERT INTO public.compras_notas (fornecedor_id,numero_nf,data_nf,valor_nf,quantidade_itens_nf,valor_frete,icms_frete,origem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        campos);
      nota = r.rows[0];
    }
    for (const item of compra.itens) {
      await cliente.query(
        'INSERT INTO public.compras_itens (nota_id,insumo_id,descricao,unidade,quantidade,preco_unitario,valor_total,posicao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [nota.id,item.insumo_id,item.descricao,item.unidade,item.quantidade,item.preco_unitario,item.valor_total,item.posicao]);
    }
    if(listaBoletos!==undefined) await boletos.sincronizar(cliente,nota.id,listaBoletos);
    await cliente.query('COMMIT');
    return buscar(nota.id);
  } catch (e) {
    await cliente.query('ROLLBACK');
    if (e.code === '23505') throw erro('Já existe uma NF com esse número para este fornecedor.',409);
    if (e.code === '23503') throw erro('Fornecedor ou insumo não encontrado.',400);
    throw e;
  } finally { cliente.release(); }
}

function chaveItem(item) {
  const nome = String(item.descricao || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return nome + '|' + String(item.unidade || 'outro').toLowerCase();
}
async function localizar(fornecedor_id, numero_nf) {
  const f = Number(fornecedor_id), nf=String(numero_nf || '').trim();
  if (!Number.isSafeInteger(f) || f<1 || !nf) throw erro('Informe fornecedor e número da NF.',400);
  const {rows} = await pool.query(
    'SELECT id FROM public.compras_notas WHERE fornecedor_id=$1 AND numero_nf=$2', [f,nf]);
  return rows.length ? buscar(rows[0].id) : null;
}
// Importa dados extraídos de fotos ou PDF em uma transação. A chave fornecedor+NF decide se
// complementa o registro existente ou cria um novo. Nunca apaga itens antigos.
// Reimportações idênticas são idempotentes.
async function importarDaIa(dados) {
  const compra = validarCompra({...dados, origem:'ia'});
  const listaBoletos=boletos.validarBoletos(dados.boletos||[],'ia');
  const cliente=await pool.connect();
  let id, criada=false, itensIncluidos=0, itensCompletados=0, boletosIncluidos=0;
  try {
    await cliente.query('BEGIN');
    let {rows:[nota]}=await cliente.query(
      'SELECT * FROM public.compras_notas WHERE fornecedor_id=$1 AND numero_nf=$2 FOR UPDATE',
      [compra.fornecedor_id,compra.numero_nf]);
    if (!nota) {
      const criado=await cliente.query(
        'INSERT INTO public.compras_notas (fornecedor_id,numero_nf,data_nf,valor_nf,quantidade_itens_nf,valor_frete,icms_frete,origem)' +
        ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (fornecedor_id,numero_nf) DO NOTHING RETURNING *',
        [compra.fornecedor_id,compra.numero_nf,compra.data_nf,compra.valor_nf,
          compra.quantidade_itens_nf ?? (compra.itens.length || null),compra.valor_frete,compra.icms_frete,'ia']);
      if (criado.rows.length) {nota=criado.rows[0];criada=true;}
      else {
        const achado=await cliente.query(
          'SELECT * FROM public.compras_notas WHERE fornecedor_id=$1 AND numero_nf=$2 FOR UPDATE',
          [compra.fornecedor_id,compra.numero_nf]);
        nota=achado.rows[0];
      }
    }
    if (!nota) throw erro('Não foi possível localizar ou criar a NF.',409);
    id=nota.id;
    // Coalesce preserva dados já informados manualmente, complementando apenas
    // campos ainda vazios (NULL). Zero é valor conhecido, não é campo vazio.
    await cliente.query(
      'UPDATE public.compras_notas SET ' +
      'data_nf=COALESCE(data_nf,$2), valor_nf=COALESCE(valor_nf,$3), ' +
      'quantidade_itens_nf=COALESCE(quantidade_itens_nf,$4), ' +
      'valor_frete=COALESCE(valor_frete,$5), icms_frete=COALESCE(icms_frete,$6), ' +
      "origem='ia', atualizado_em=NOW() WHERE id=$1",
      [id,compra.data_nf,compra.valor_nf,compra.quantidade_itens_nf ?? (compra.itens.length || null),
        compra.valor_frete,compra.icms_frete]);
    const {rows:atuais}=await cliente.query(
      'SELECT id, insumo_id, descricao, unidade, quantidade, preco_unitario, valor_total, posicao ' +
      'FROM public.compras_itens WHERE nota_id=$1 ORDER BY posicao FOR UPDATE', [id]);
    const porChave=new Map();
    for(const item of atuais) {
      const chave=chaveItem(item);
      if(!porChave.has(chave)) porChave.set(chave,[]);
      porChave.get(chave).push(item);
    }
    let posicao=Math.max(0,...atuais.map(item=>Number(item.posicao)));
    for(const item of compra.itens) {
      const fila=porChave.get(chaveItem(item)) || [];
      const existente=fila.shift();
      if (existente) {
        const r=await cliente.query(
          'UPDATE public.compras_itens SET insumo_id=COALESCE(insumo_id,$2), ' +
          'quantidade=COALESCE(quantidade,$3),preco_unitario=COALESCE(preco_unitario,$4), ' +
          'valor_total=COALESCE(valor_total,$5) WHERE id=$1 ' +
          'AND (insumo_id IS NULL AND $2 IS NOT NULL OR quantidade IS NULL AND $3 IS NOT NULL OR ' +
          'preco_unitario IS NULL AND $4 IS NOT NULL OR valor_total IS NULL AND $5 IS NOT NULL)',
          [existente.id,item.insumo_id,item.quantidade,item.preco_unitario,item.valor_total]);
        itensCompletados+=r.rowCount;
      } else {
        posicao++;
        await cliente.query(
          'INSERT INTO public.compras_itens (nota_id,insumo_id,descricao,unidade,quantidade,preco_unitario,valor_total,posicao) '+
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [id,item.insumo_id,item.descricao,item.unidade,item.quantidade,item.preco_unitario,item.valor_total,posicao]);
        itensIncluidos++;
      }
    }
    boletosIncluidos=await boletos.importar(cliente,id,listaBoletos);
    await cliente.query('COMMIT');
  } catch(e) {
    await cliente.query('ROLLBACK');
    if(e.code==='23503') throw erro('Fornecedor ou insumo não encontrado.',400);
    throw e;
  } finally {cliente.release();}
  return {nota:await buscar(id),criada,itensIncluidos,itensCompletados,boletosIncluidos};
}

module.exports = { fornecedores, insumos, listar, buscar, localizar, gravar, importarDaIa,
  consultarBoletos:boletos.consultar, alterarStatusBoleto:boletos.alterarStatus };
