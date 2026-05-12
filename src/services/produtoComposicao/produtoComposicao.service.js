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

function parseAtivo(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  throw new Error('Valor de ativo inválido');
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

function moedaNumero(value) {
  return Number(value || 0);
}

function parsePrecoVenda(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error('Preço de venda inválido');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Preço de venda inválido');
    }
    return Number(value.toFixed(2));
  }

  let texto = String(value)
    .trim()
    .replace(/R\$/gi, '')
    .replace(/\s/g, '')
    .replace(/[^0-9,.-]/g, '');

  if (!texto) {
    throw new Error('Preço de venda inválido');
  }

  const ultimoPonto = texto.lastIndexOf('.');
  const ultimaVirgula = texto.lastIndexOf(',');
  let separadorDecimal = null;

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    separadorDecimal = ultimaVirgula > ultimoPonto ? ',' : '.';
  } else {
    const idx = Math.max(ultimoPonto, ultimaVirgula);
    if (idx >= 0) {
      const casas = texto.length - idx - 1;
      separadorDecimal = casas > 0 && casas <= 2 ? texto[idx] : null;
    }
  }

  if (separadorDecimal) {
    const separadorMilhar = separadorDecimal === ',' ? '.' : ',';
    texto = texto.replace(new RegExp('\\' + separadorMilhar, 'g'), '');
    const partes = texto.split(separadorDecimal);
    texto = partes.slice(0, -1).join('') + '.' + partes[partes.length - 1];
  } else {
    texto = texto.replace(/[.,]/g, '');
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error('Preço de venda inválido');
  }

  return Number(numero.toFixed(2));
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

async function listarPorProduto(produtoIdParam) {
  const produtoId = normalizarId(produtoIdParam, 'Produto');
  const produto = await obterProduto(produtoId);

  const result = await pool.query(`
    SELECT
      pc.id,
      pc.produto_id,
      pc.nome,
      pc.ativo,
      pc.created_at,
      pc.updated_at,
      COUNT(pci.id)::int AS total_itens,
      COALESCE(SUM(
        pci.quantidade *
        CASE
          WHEN d.insumo_id IS NOT NULL THEN COALESCE(d.peso_kg, 0) * COALESCE(ifn.custo_final, 0)
          ELSE COALESCE(ifn.custo_final, 0)
        END
      ), 0)::numeric(14,4) AS custo_total
    FROM produtos_composicoes pc
    LEFT JOIN produtos_composicoes_itens pci ON pci.composicao_id = pc.id
    LEFT JOIN insumos_fornecedores ifn ON ifn.id = pci.insumo_fornecedor_id
    LEFT JOIN insumos i ON i.id = ifn.insumo_id
    LEFT JOIN insumos_discos d ON d.insumo_id = i.id
    WHERE pc.produto_id = $1
    GROUP BY pc.id
    ORDER BY pc.nome ASC
  `, [produtoId]);

  return {
    produto: {
      id: Number(produto.id),
      nome: produto.nome,
      preco: moedaNumero(produto.preco),
      ativo: produto.ativo
    },
    composicoes: result.rows.map(row => ({
      id: Number(row.id),
      produto_id: Number(row.produto_id),
      nome: row.nome,
      ativo: row.ativo,
      total_itens: Number(row.total_itens || 0),
      custo_total: moedaNumero(row.custo_total)
    }))
  };
}

async function buscar(composicaoIdParam) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  const composicao = await obterComposicao(composicaoId);

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
  `, [composicaoId]);

  const itens = itensResult.rows.map(mapearItem);
  const resumo = calcularResumoItens(itens, composicao.preco_venda);

  return {
    id: Number(composicao.id),
    produto_id: Number(composicao.produto_id),
    produto: composicao.produto,
    preco_venda: moedaNumero(composicao.preco_venda),
    nome: composicao.nome,
    ativo: composicao.ativo,
    itens,
    resumo
  };
}

async function criar(data = {}) {
  const produtoId = normalizarId(data.produto_id, 'Produto');
  const nome = normalizarTexto(data.nome) || 'PADRÃO';
  const ativo = data.ativo === undefined ? true : parseAtivo(data.ativo);

  await obterProduto(produtoId);

  try {
    const result = await pool.query(`
      INSERT INTO produtos_composicoes (produto_id, nome, ativo)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [produtoId, nome, ativo]);

    return buscar(result.rows[0].id);
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Já existe uma composição com este nome para este produto');
    }
    throw error;
  }
}

async function atualizar(composicaoIdParam, data = {}) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  const atual = await obterComposicao(composicaoId);
  const produtoId = data.produto_id !== undefined ? normalizarId(data.produto_id, 'Produto') : Number(atual.produto_id);
  const nome = data.nome !== undefined ? normalizarTexto(data.nome) : atual.nome;
  const ativo = data.ativo === undefined ? atual.ativo : parseAtivo(data.ativo);

  if (!nome) {
    throw new Error('Nome da composição é obrigatório');
  }

  await obterProduto(produtoId);

  try {
    await pool.query(`
      UPDATE produtos_composicoes
      SET produto_id = $1,
          nome = $2,
          ativo = $3,
          updated_at = NOW()
      WHERE id = $4
    `, [produtoId, nome, ativo, composicaoId]);

    return buscar(composicaoId);
  } catch (error) {
    if (error.code === '23505') {
      throw new Error('Já existe uma composição com este nome para este produto');
    }
    throw error;
  }
}

function consolidarItens(itens = []) {
  const mapa = new Map();

  for (const item of itens || []) {
    if (!item) continue;
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

async function atualizarPrecoProduto(produtoIdParam, precoParam) {
  const produtoId = normalizarId(produtoIdParam, 'Produto');
  const preco = parsePrecoVenda(precoParam);

  const result = await pool.query(`
    UPDATE produtos
    SET preco = $1,
        updated_at = NOW()
    WHERE id = $2
    RETURNING id, nome, preco, ativo
  `, [preco, produtoId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return {
    id: Number(result.rows[0].id),
    nome: result.rows[0].nome,
    preco: moedaNumero(result.rows[0].preco),
    ativo: result.rows[0].ativo
  };
}

async function salvarItens(composicaoIdParam, itensPayload = []) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  await obterComposicao(composicaoId);

  const itens = consolidarItens(itensPayload);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await validarInsumosFornecedores(client, itens);

    await client.query('DELETE FROM produtos_composicoes_itens WHERE composicao_id = $1', [composicaoId]);

    for (const item of itens) {
      await client.query(`
        INSERT INTO produtos_composicoes_itens (composicao_id, insumo_fornecedor_id, quantidade, ativo)
        VALUES ($1, $2, $3, TRUE)
      `, [composicaoId, item.insumo_fornecedor_id, item.quantidade]);
    }

    await client.query(`
      UPDATE produtos_composicoes
      SET updated_at = NOW()
      WHERE id = $1
    `, [composicaoId]);

    await client.query('COMMIT');
    return buscar(composicaoId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function excluir(composicaoIdParam) {
  const composicaoId = normalizarId(composicaoIdParam, 'Composição');
  await obterComposicao(composicaoId);

  await pool.query('DELETE FROM produtos_composicoes WHERE id = $1', [composicaoId]);
}

module.exports = {
  listarInsumosDisponiveis,
  listarPorProduto,
  buscar,
  criar,
  atualizar,
  atualizarPrecoProduto,
  salvarItens,
  excluir
};
