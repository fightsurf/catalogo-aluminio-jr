const pool = require('../../../db/connection');

function normalizarId(value, campo) {
  const numero = Number.parseInt(value, 10);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(`${campo} inválido`);
  }
  return numero;
}

function normalizarTexto(value) {
  return String(value || '').trim();
}

function normalizarQuantidade(value, campo = 'Quantidade') {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${campo} inválida`);
  }

  const numero = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(numero) || numero <= 0) {
    throw new Error(`${campo} inválida`);
  }

  return Number(numero.toFixed(4));
}

function normalizarPrecoVenda(value) {
  if (value === undefined || value === null || value === '') {
    throw new Error('Preço de venda inválido');
  }

  const textoOriginal = String(value).trim();
  const textoNormalizado = textoOriginal.includes(',')
    ? textoOriginal.replace(/\./g, '').replace(',', '.')
    : textoOriginal;
  const numero = Number(textoNormalizado);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error('Preço de venda inválido');
  }

  return Number(numero.toFixed(2));
}

function moedaNumero(value) {
  return Number(value || 0);
}

function calcularCustoUnitario(row) {
  const custoFinal = moedaNumero(row.custo_final);
  const pesoKg = row.peso_kg !== null && row.peso_kg !== undefined ? Number(row.peso_kg) : null;

  if (row.eh_disco) {
    return Number((custoFinal * (pesoKg || 0)).toFixed(4));
  }

  return Number(custoFinal.toFixed(4));
}

function mapearInsumoDisponivel(row) {
  const custoUnitario = calcularCustoUnitario(row);

  return {
    insumo_fornecedor_id: Number(row.insumo_fornecedor_id),
    insumo_id: Number(row.insumo_id),
    insumo: row.insumo,
    categoria_insumo_id: Number(row.categoria_insumo_id),
    categoria: row.categoria,
    fornecedor_id: Number(row.fornecedor_id),
    fornecedor: row.fornecedor,
    unidade_custo: row.unidade_custo,
    custo_final: moedaNumero(row.custo_final),
    preco_base: moedaNumero(row.preco_base),
    custo_unitario: custoUnitario,
    eh_disco: row.eh_disco,
    diametro_mm: row.diametro_mm !== null ? Number(row.diametro_mm) : null,
    espessura_mm: row.espessura_mm !== null ? Number(row.espessura_mm) : null,
    peso_kg: row.peso_kg !== null ? Number(row.peso_kg) : null
  };
}

function mapearItem(row) {
  const custoUnitario = calcularCustoUnitario(row);
  const quantidade = Number(row.quantidade || 0);

  return {
    id: Number(row.id),
    composicao_id: Number(row.composicao_id),
    insumo_fornecedor_id: Number(row.insumo_fornecedor_id),
    insumo_id: Number(row.insumo_id),
    insumo: row.insumo,
    categoria_insumo_id: Number(row.categoria_insumo_id),
    categoria: row.categoria,
    fornecedor_id: Number(row.fornecedor_id),
    fornecedor: row.fornecedor,
    unidade_custo: row.unidade_custo,
    quantidade,
    custo_final: moedaNumero(row.custo_final),
    preco_base: moedaNumero(row.preco_base),
    custo_unitario: custoUnitario,
    subtotal: Number((quantidade * custoUnitario).toFixed(4)),
    ativo: row.ativo,
    eh_disco: row.eh_disco,
    diametro_mm: row.diametro_mm !== null ? Number(row.diametro_mm) : null,
    espessura_mm: row.espessura_mm !== null ? Number(row.espessura_mm) : null,
    peso_kg: row.peso_kg !== null ? Number(row.peso_kg) : null
  };
}

function calcularResumoItens(itens, precoProduto = 0) {
  const custo_total = Number(itens.reduce((soma, item) => soma + Number(item.subtotal || 0), 0).toFixed(4));
  const preco_venda = moedaNumero(precoProduto);
  const lucro_bruto = Number((preco_venda - custo_total).toFixed(4));
  const margem_bruta_percentual = preco_venda > 0 ? Number(((lucro_bruto / preco_venda) * 100).toFixed(2)) : null;

  return {
    custo_total,
    preco_venda,
    lucro_bruto,
    margem_bruta_percentual
  };
}

async function obterProduto(produtoId) {
  const result = await pool.query(`
    SELECT id, nome, preco, ativo
    FROM produtos
    WHERE id = $1
  `, [produtoId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return result.rows[0];
}

async function obterComposicao(composicaoId) {
  const result = await pool.query(`
    SELECT
      pc.id,
      pc.produto_id,
      p.nome AS produto,
      p.preco AS preco_venda,
      pc.nome,
      pc.ativo,
      pc.created_at,
      pc.updated_at
    FROM produtos_composicoes pc
    JOIN produtos p ON p.id = pc.produto_id
    WHERE pc.id = $1
  `, [composicaoId]);

  if (result.rows.length === 0) {
    throw new Error('Composição não encontrada');
  }

  return result.rows[0];
}

async function obterComposicaoPorProduto(produtoId, client = pool) {
  const result = await client.query(`
    SELECT
      pc.id,
      pc.produto_id,
      p.nome AS produto,
      p.preco AS preco_venda,
      pc.nome,
      pc.ativo,
      pc.created_at,
      pc.updated_at
    FROM produtos_composicoes pc
    JOIN produtos p ON p.id = pc.produto_id
    WHERE pc.produto_id = $1
    ORDER BY pc.id ASC
    LIMIT 1
  `, [produtoId]);

  return result.rows[0] || null;
}

async function garantirComposicaoPorProduto(produtoId, client = pool) {
  const existente = await obterComposicaoPorProduto(produtoId, client);
  if (existente) return existente;

  const insert = await client.query(`
    INSERT INTO produtos_composicoes (produto_id, nome, ativo)
    VALUES ($1, 'COMPOSIÇÃO ÚNICA', TRUE)
    RETURNING id
  `, [produtoId]);

  const nova = await client.query(`
    SELECT
      pc.id,
      pc.produto_id,
      p.nome AS produto,
      p.preco AS preco_venda,
      pc.nome,
      pc.ativo,
      pc.created_at,
      pc.updated_at
    FROM produtos_composicoes pc
    JOIN produtos p ON p.id = pc.produto_id
    WHERE pc.id = $1
  `, [insert.rows[0].id]);

  return nova.rows[0];
}

async function listarInsumosDisponiveis(filtros = {}) {
  const values = [];
  const conditions = ['ifn.ativo = TRUE', 'i.ativo = TRUE'];

  if (filtros.busca) {
    values.push(`%${normalizarTexto(filtros.busca)}%`);
    conditions.push(`i.nome ILIKE $${values.length}`);
  }

  if (filtros.categoria_insumo_id) {
    values.push(normalizarId(filtros.categoria_insumo_id, 'Categoria'));
    conditions.push(`i.categoria_insumo_id = $${values.length}`);
  }

  if (filtros.fornecedor_id) {
    values.push(normalizarId(filtros.fornecedor_id, 'Fornecedor'));
    conditions.push(`ifn.fornecedor_id = $${values.length}`);
  }

  if (filtros.tipo === 'disco') {
    conditions.push('d.insumo_id IS NOT NULL');
  }

  if (filtros.tipo === 'comum') {
    conditions.push('d.insumo_id IS NULL');
  }

  const query = `
    SELECT
      ifn.id AS insumo_fornecedor_id,
      ifn.insumo_id,
      i.nome AS insumo,
      i.categoria_insumo_id,
      c.nome AS categoria,
      ifn.fornecedor_id,
      f.nome AS fornecedor,
      ifn.unidade_custo,
      ifn.preco_base,
      ifn.custo_final,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM insumos_fornecedores ifn
    JOIN insumos i ON i.id = ifn.insumo_id
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    JOIN fornecedores f ON f.id = ifn.fornecedor_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.nome ASC, f.nome ASC
    LIMIT 500
  `;

  const result = await pool.query(query, values);
  return result.rows.map(mapearInsumoDisponivel);
}

async function buscar(composicaoIdParam) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  const composicao = await obterComposicao(composicaoId);
  return montarComposicao(composicao);
}

async function montarComposicao(composicao) {
  const itensResult = await pool.query(`
    SELECT
      pci.id,
      pci.composicao_id,
      pci.insumo_fornecedor_id,
      pci.quantidade,
      pci.ativo,
      ifn.insumo_id,
      i.nome AS insumo,
      i.categoria_insumo_id,
      c.nome AS categoria,
      ifn.fornecedor_id,
      f.nome AS fornecedor,
      ifn.unidade_custo,
      ifn.preco_base,
      ifn.custo_final,
      (d.insumo_id IS NOT NULL) AS eh_disco,
      d.diametro_mm,
      d.espessura_mm,
      d.peso_kg
    FROM produtos_composicoes_itens pci
    JOIN insumos_fornecedores ifn ON ifn.id = pci.insumo_fornecedor_id
    JOIN insumos i ON i.id = ifn.insumo_id
    JOIN insumos_categorias c ON c.id = i.categoria_insumo_id
    JOIN fornecedores f ON f.id = ifn.fornecedor_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE pci.composicao_id = $1
    ORDER BY i.nome ASC, f.nome ASC
  `, [composicao.id]);

  const itens = itensResult.rows.map(mapearItem);
  const resumo = calcularResumoItens(itens, composicao.preco_venda);

  return {
    id: Number(composicao.id),
    produto_id: Number(composicao.produto_id),
    produto: composicao.produto,
    preco_venda: moedaNumero(composicao.preco_venda),
    nome: composicao.nome || 'COMPOSIÇÃO ÚNICA',
    ativo: composicao.ativo,
    total_itens: itens.length,
    itens,
    resumo
  };
}

async function listarPorProduto(produtoIdParam) {
  const produtoId = normalizarId(produtoIdParam, 'Produto');
  const produto = await obterProduto(produtoId);
  const composicao = await obterComposicaoPorProduto(produtoId);

  let composicaoDetalhada = null;
  if (composicao) {
    composicaoDetalhada = await montarComposicao(composicao);
  }

  return {
    produto: {
      id: Number(produto.id),
      nome: produto.nome,
      preco: moedaNumero(produto.preco),
      ativo: produto.ativo
    },
    composicao: composicaoDetalhada
  };
}

function consolidarItens(itens = []) {
  const mapa = new Map();

  for (const item of itens || []) {
    if (!item) continue;
    const quantidadeRaw = item.quantidade;
    if (quantidadeRaw === undefined || quantidadeRaw === null || quantidadeRaw === '' || Number(quantidadeRaw) <= 0) {
      continue;
    }

    const insumoFornecedorId = normalizarId(item.insumo_fornecedor_id, 'Insumo do fornecedor');
    const quantidade = normalizarQuantidade(item.quantidade);
    const anterior = mapa.get(insumoFornecedorId) || 0;
    mapa.set(insumoFornecedorId, Number((anterior + quantidade).toFixed(4)));
  }

  return Array.from(mapa.entries()).map(([insumo_fornecedor_id, quantidade]) => ({
    insumo_fornecedor_id,
    quantidade
  }));
}

async function validarInsumosFornecedores(client, itens) {
  if (!itens.length) return;

  const ids = itens.map(item => item.insumo_fornecedor_id);
  const result = await client.query(`
    SELECT ifn.id
    FROM insumos_fornecedores ifn
    JOIN insumos i ON i.id = ifn.insumo_id
    WHERE ifn.id = ANY($1::int[])
      AND ifn.ativo = TRUE
      AND i.ativo = TRUE
  `, [ids]);

  const encontrados = new Set(result.rows.map(row => Number(row.id)));
  const faltantes = ids.filter(id => !encontrados.has(Number(id)));

  if (faltantes.length) {
    throw new Error('Existem insumos sem custo ativo por fornecedor na composição');
  }
}

async function salvarItensPorProduto(produtoIdParam, itensPayload = []) {
  const produtoId = normalizarId(produtoIdParam, 'Produto');
  await obterProduto(produtoId);

  const itens = consolidarItens(itensPayload);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await validarInsumosFornecedores(client, itens);

    const composicao = await garantirComposicaoPorProduto(produtoId, client);

    await client.query('DELETE FROM produtos_composicoes_itens WHERE composicao_id = $1', [composicao.id]);

    for (const item of itens) {
      await client.query(`
        INSERT INTO produtos_composicoes_itens (composicao_id, insumo_fornecedor_id, quantidade, ativo)
        VALUES ($1, $2, $3, TRUE)
      `, [composicao.id, item.insumo_fornecedor_id, item.quantidade]);
    }

    await client.query(`
      UPDATE produtos_composicoes
      SET nome = 'COMPOSIÇÃO ÚNICA',
          ativo = TRUE,
          updated_at = NOW()
      WHERE id = $1
    `, [composicao.id]);

    await client.query('COMMIT');
    return buscar(composicao.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function salvarItens(composicaoIdParam, itensPayload = []) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  const composicao = await obterComposicao(composicaoId);
  return salvarItensPorProduto(composicao.produto_id, itensPayload);
}

async function limparItensPorProduto(produtoIdParam) {
  const produtoId = normalizarId(produtoIdParam, 'Produto');
  await obterProduto(produtoId);

  const composicao = await obterComposicaoPorProduto(produtoId);
  if (!composicao) return null;

  await pool.query(`
    DELETE FROM produtos_composicoes_itens
    WHERE composicao_id = $1
  `, [composicao.id]);

  await pool.query(`
    UPDATE produtos_composicoes
    SET updated_at = NOW()
    WHERE id = $1
  `, [composicao.id]);

  return buscar(composicao.id);
}

async function copiarComposicao(data = {}) {
  const produtoOrigemId = normalizarId(data.produto_origem_id, 'Produto origem');
  const produtoDestinoId = normalizarId(data.produto_destino_id, 'Produto destino');

  if (produtoOrigemId === produtoDestinoId) {
    throw new Error('Produto origem e destino não podem ser iguais');
  }

  await obterProduto(produtoOrigemId);
  await obterProduto(produtoDestinoId);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const origem = await obterComposicaoPorProduto(produtoOrigemId, client);
    if (!origem) {
      throw new Error('Produto origem não possui composição cadastrada');
    }

    const itensOrigem = await client.query(`
      SELECT insumo_fornecedor_id, quantidade
      FROM produtos_composicoes_itens
      WHERE composicao_id = $1
      ORDER BY id ASC
    `, [origem.id]);

    if (itensOrigem.rows.length === 0) {
      throw new Error('Produto origem está sem itens na composição');
    }

    const destino = await garantirComposicaoPorProduto(produtoDestinoId, client);

    await client.query('DELETE FROM produtos_composicoes_itens WHERE composicao_id = $1', [destino.id]);

    for (const item of itensOrigem.rows) {
      await client.query(`
        INSERT INTO produtos_composicoes_itens (composicao_id, insumo_fornecedor_id, quantidade, ativo)
        VALUES ($1, $2, $3, TRUE)
      `, [destino.id, item.insumo_fornecedor_id, item.quantidade]);
    }

    await client.query(`
      UPDATE produtos_composicoes
      SET nome = 'COMPOSIÇÃO ÚNICA',
          ativo = TRUE,
          updated_at = NOW()
      WHERE id = $1
    `, [destino.id]);

    await client.query('COMMIT');
    return buscar(destino.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function atualizarPrecoProduto(produtoIdParam, data = {}) {
  const produtoId = normalizarId(produtoIdParam, 'Produto');
  const preco = normalizarPrecoVenda(data.preco);

  const result = await pool.query(`
    UPDATE produtos
    SET preco = $1
    WHERE id = $2
    RETURNING id, nome, preco, ativo
  `, [preco, produtoId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return listarPorProduto(produtoId);
}

async function criar(data = {}) {
  const produtoId = normalizarId(data.produto_id, 'Produto');
  return salvarItensPorProduto(produtoId, data.itens || []);
}

async function atualizar(composicaoIdParam, data = {}) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  const composicao = await obterComposicao(composicaoId);
  return salvarItensPorProduto(composicao.produto_id, data.itens || []);
}

async function excluir(composicaoIdParam) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  const composicao = await obterComposicao(composicaoId);
  return limparItensPorProduto(composicao.produto_id);
}

module.exports = {
  listarInsumosDisponiveis,
  listarPorProduto,
  buscar,
  criar,
  atualizar,
  salvarItens,
  salvarItensPorProduto,
  limparItensPorProduto,
  copiarComposicao,
  atualizarPrecoProduto,
  excluir
};
