const pool = require('../../../db/connection');
const produtoFotosSchemaService = require('./produtoFotosSchema.service');

const FOTO_COLUMNS = {
  1: 'foto',
  2: 'foto_2',
  3: 'foto_3',
  4: 'foto_4',
  5: 'foto_5',
  6: 'foto_6',
};

function normalizarItemLegado(valor) {
  if (valor === undefined || valor === null || `${valor}`.trim() === '') {
    return null;
  }

  const numero = Number.parseInt(valor, 10);

  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error('ITEM do legado inválido.');
  }

  return numero;
}

function normalizarFoto(valor) {
  if (valor === undefined || valor === null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

function normalizarBooleano(valor, nomeCampo) {
  if (typeof valor === 'boolean') return valor;

  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }

  if (typeof valor === 'number') {
    if (valor === 1) return true;
    if (valor === 0) return false;
  }

  const texto = String(valor).trim().toLowerCase();

  if (['true', '1', 'sim', 's', 'yes', 'y'].includes(texto)) return true;
  if (['false', '0', 'nao', 'não', 'n', 'no'].includes(texto)) return false;

  throw new Error(`${nomeCampo} inválido. Use true ou false.`);
}

function normalizarPerfil(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return null;
  }

  const texto = String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-');

  if (['kit', 'kit-feirinha', 'kits-feirinha', 'feirinha'].includes(texto)) {
    return 'kit-feirinha';
  }

  if (['orcamento', 'orçamento', 'pedido', 'pedido-comum', 'comum'].includes(texto)) {
    return 'orcamento';
  }

  throw new Error('Perfil de produto inválido. Use kit-feirinha ou orcamento.');
}

function normalizarPosicaoFoto(posicao) {
  const numero = Number.parseInt(posicao, 10);

  if (!FOTO_COLUMNS[numero]) {
    throw new Error('Posicao de foto invalida. Use uma posicao de 1 a 6.');
  }

  return numero;
}

function camposFotosSelect(alias = 'p') {
  return `
      ${alias}.foto,
      ${alias}.foto_2,
      ${alias}.foto_3,
      ${alias}.foto_4,
      ${alias}.foto_5,
      ${alias}.foto_6`;
}

function montarArrayFotos(produto) {
  return [
    produto.foto || null,
    produto.foto_2 || null,
    produto.foto_3 || null,
    produto.foto_4 || null,
    produto.foto_5 || null,
    produto.foto_6 || null,
  ];
}

function anexarArrayFotos(produto) {
  if (!produto) return produto;
  return {
    ...produto,
    fotos: montarArrayFotos(produto),
  };
}

async function listar(filtros = {}) {
  await produtoFotosSchemaService.criarEstrutura();

  let query = `
    SELECT 
      p.id,
      p.nome,
      p.preco,${camposFotosSelect('p')},
      p.capacidade_caixa,
      p.ativo,
      p.item_legado,
      p.perfil_kit_feirinha,
      p.perfil_orcamento,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c 
      ON p.categoria_id = c.id
    WHERE 1=1
  `;

  const values = [];

  if (filtros.busca) {
    values.push(`%${filtros.busca}%`);
    query += ` AND p.nome ILIKE $${values.length}`;
  }

  if (filtros.apenasAtivos) {
    query += ` AND p.ativo = true`;
  }

  const perfil = normalizarPerfil(filtros.perfil);

  if (perfil === 'kit-feirinha') {
    query += ` AND p.perfil_kit_feirinha = true`;
  }

  if (perfil === 'orcamento') {
    query += ` AND p.perfil_orcamento = true`;
  }

  query += ` ORDER BY p.nome ASC`;

  const result = await pool.query(query, values);

  return result.rows.map(anexarArrayFotos);
}

async function buscar(id) {
  await produtoFotosSchemaService.criarEstrutura();

  const result = await pool.query(`
    SELECT 
      p.id,
      p.nome,
      p.preco,${camposFotosSelect('p')},
      p.capacidade_caixa,
      p.ativo,
      p.item_legado,
      p.perfil_kit_feirinha,
      p.perfil_orcamento,
      c.id AS categoria_id,
      c.nome AS categoria
    FROM produtos p
    LEFT JOIN produtos_categorias c 
      ON p.categoria_id = c.id
    WHERE p.id = $1
  `, [id]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return anexarArrayFotos(result.rows[0]);
}

async function criar(data) {
  await produtoFotosSchemaService.criarEstrutura();

  const {
    nome,
    preco,
    categoria_id,
    foto,
    foto_2,
    foto_3,
    foto_4,
    foto_5,
    foto_6,
    capacidade_caixa,
    ativo,
  } = data;
  const itemLegado = normalizarItemLegado(data?.item_legado);

  const result = await pool.query(`
    INSERT INTO produtos
    (nome, preco, categoria_id, foto, foto_2, foto_3, foto_4, foto_5, foto_6, capacidade_caixa, ativo, item_legado)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *
  `, [
    nome,
    preco,
    categoria_id || null,
    normalizarFoto(foto),
    normalizarFoto(foto_2),
    normalizarFoto(foto_3),
    normalizarFoto(foto_4),
    normalizarFoto(foto_5),
    normalizarFoto(foto_6),
    capacidade_caixa || 1,
    ativo !== false,
    itemLegado,
  ]);

  return anexarArrayFotos(result.rows[0]);
}

async function atualizar(id, data) {
  await produtoFotosSchemaService.criarEstrutura();

  const {
    nome,
    preco,
    categoria_id,
    foto,
    foto_2,
    foto_3,
    foto_4,
    foto_5,
    foto_6,
    capacidade_caixa,
    ativo,
  } = data;

  const result = await pool.query(`
    UPDATE produtos SET
      nome = $1,
      preco = $2,
      categoria_id = $3,
      foto = $4,
      foto_2 = $5,
      foto_3 = $6,
      foto_4 = $7,
      foto_5 = $8,
      foto_6 = $9,
      capacidade_caixa = $10,
      ativo = $11,
      updated_at = NOW()
    WHERE id = $12
    RETURNING *
  `, [
    nome,
    preco,
    categoria_id || null,
    normalizarFoto(foto),
    normalizarFoto(foto_2),
    normalizarFoto(foto_3),
    normalizarFoto(foto_4),
    normalizarFoto(foto_5),
    normalizarFoto(foto_6),
    capacidade_caixa || 1,
    ativo !== false,
    id,
  ]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return anexarArrayFotos(result.rows[0]);
}

async function atualizarFoto(id, posicao, url) {
  await produtoFotosSchemaService.criarEstrutura();

  const posicaoNormalizada = normalizarPosicaoFoto(posicao);
  const coluna = FOTO_COLUMNS[posicaoNormalizada];

  const result = await pool.query(`
    UPDATE produtos
    SET ${coluna} = $1,
        updated_at = NOW()
    WHERE id = $2
    RETURNING *
  `, [normalizarFoto(url), id]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return anexarArrayFotos(result.rows[0]);
}

async function associarItemLegado(produtoId, itemLegado) {
  await produtoFotosSchemaService.criarEstrutura();

  const itemNormalizado = normalizarItemLegado(itemLegado);

  try {
    const result = await pool.query(`
      UPDATE produtos
      SET item_legado = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome, preco, foto, foto_2, foto_3, foto_4, foto_5, foto_6, capacidade_caixa, ativo, item_legado, perfil_kit_feirinha, perfil_orcamento, categoria_id
    `, [itemNormalizado, produtoId]);

    if (result.rows.length === 0) {
      throw new Error('Produto não encontrado');
    }

    return anexarArrayFotos(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      throw new Error(`O ITEM legado ${itemNormalizado} já está associado a outro produto no PostgreSQL.`);
    }

    throw error;
  }
}

async function desassociarItemLegado(produtoId) {
  await produtoFotosSchemaService.criarEstrutura();

  const result = await pool.query(`
    UPDATE produtos
    SET item_legado = NULL,
        updated_at = NOW()
    WHERE id = $1
    RETURNING id, nome, preco, foto, foto_2, foto_3, foto_4, foto_5, foto_6, capacidade_caixa, ativo, item_legado, perfil_kit_feirinha, perfil_orcamento, categoria_id
  `, [produtoId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return anexarArrayFotos(result.rows[0]);
}

async function transferirItemLegado(produtoIdDestino, itemLegado) {
  await produtoFotosSchemaService.criarEstrutura();

  const itemNormalizado = normalizarItemLegado(itemLegado);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const produtoDestinoResult = await client.query(`
      SELECT id, nome, item_legado
      FROM produtos
      WHERE id = $1
      FOR UPDATE
    `, [produtoIdDestino]);

    if (produtoDestinoResult.rows.length === 0) {
      throw new Error('Produto de destino não encontrado.');
    }

    const produtoDestino = produtoDestinoResult.rows[0];

    const produtoAtualResult = await client.query(`
      SELECT id, nome, item_legado
      FROM produtos
      WHERE item_legado = $1
      FOR UPDATE
    `, [itemNormalizado]);

    const produtoAtual = produtoAtualResult.rows[0] || null;

    if (produtoAtual && Number(produtoAtual.id) !== Number(produtoDestino.id)) {
      await client.query(`
        UPDATE produtos
        SET item_legado = NULL,
            updated_at = NOW()
        WHERE id = $1
      `, [produtoAtual.id]);
    }

    const produtoAtualizadoResult = await client.query(`
      UPDATE produtos
      SET item_legado = $1,
          updated_at = NOW()
      WHERE id = $2
      RETURNING id, nome, preco, foto, foto_2, foto_3, foto_4, foto_5, foto_6, capacidade_caixa, ativo, item_legado, perfil_kit_feirinha, perfil_orcamento, categoria_id
    `, [itemNormalizado, produtoIdDestino]);

    await client.query('COMMIT');

    return {
      produto: anexarArrayFotos(produtoAtualizadoResult.rows[0]),
      produtoAnterior: produtoAtual && Number(produtoAtual.id) !== Number(produtoIdDestino)
        ? produtoAtual
        : null
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function atualizarPerfisComerciais(produtoId, data = {}) {
  await produtoFotosSchemaService.criarEstrutura();

  const kitRaw = data.perfil_kit_feirinha ?? data.kit_feirinha ?? data.kitFeirinha;
  const orcamentoRaw = data.perfil_orcamento ?? data.orcamento ?? data.pedido_comum ?? data.pedidoComum;

  const perfilKitFeirinha = normalizarBooleano(kitRaw, 'perfil_kit_feirinha');
  const perfilOrcamento = normalizarBooleano(orcamentoRaw, 'perfil_orcamento');

  if (perfilKitFeirinha === null && perfilOrcamento === null) {
    throw new Error('Informe ao menos um perfil comercial para atualizar.');
  }

  const result = await pool.query(`
    UPDATE produtos
    SET perfil_kit_feirinha = COALESCE($1, perfil_kit_feirinha),
        perfil_orcamento = COALESCE($2, perfil_orcamento),
        updated_at = NOW()
    WHERE id = $3
    RETURNING id
  `, [perfilKitFeirinha, perfilOrcamento, produtoId]);

  if (result.rows.length === 0) {
    throw new Error('Produto não encontrado');
  }

  return buscar(produtoId);
}

async function buscarPorItemLegado(itemLegado, opcoes = {}) {
  await produtoFotosSchemaService.criarEstrutura();

  const itemNormalizado = normalizarItemLegado(itemLegado);

  if (itemNormalizado === null) {
    return null;
  }

  const values = [itemNormalizado];
  let query = `
    SELECT
      p.id,
      p.nome,
      p.preco,${camposFotosSelect('p')},
      p.capacidade_caixa,
      p.ativo,
      p.item_legado,
      p.perfil_kit_feirinha,
      p.perfil_orcamento,
      p.categoria_id
    FROM produtos p
    WHERE p.item_legado = $1
  `;

  if (opcoes.ignorarProdutoId !== undefined && opcoes.ignorarProdutoId !== null && `${opcoes.ignorarProdutoId}` !== '') {
    values.push(opcoes.ignorarProdutoId);
    query += ` AND p.id <> $${values.length}`;
  }

  query += ' LIMIT 1';

  const result = await pool.query(query, values);

  return result.rows[0] ? anexarArrayFotos(result.rows[0]) : null;
}

async function excluir(id) {
  await pool.query(
    'DELETE FROM produtos WHERE id = $1',
    [id]
  );
}

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  atualizarFoto,
  associarItemLegado,
  desassociarItemLegado,
  transferirItemLegado,
  atualizarPerfisComerciais,
  buscarPorItemLegado,
  excluir
};
