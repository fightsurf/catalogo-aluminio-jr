const firebirdService = require('../firebird.service');

function limparTexto(valor) {
  if (typeof valor !== 'string') {
    return '';
  }

  return valor.trim();
}

function textoPayload(payload, chavePrincipal, chaveAlternativa = null) {
  if (payload[chavePrincipal] !== undefined) {
    return limparTexto(payload[chavePrincipal]);
  }

  if (chaveAlternativa && payload[chaveAlternativa] !== undefined) {
    return limparTexto(payload[chaveAlternativa]);
  }

  return '';
}

function normalizarInteiro(valor) {
  const numero = Number(valor);

  if (!Number.isInteger(numero) || numero <= 0) {
    return null;
  }

  return numero;
}

function normalizarLimite(valor) {
  const numero = normalizarInteiro(valor);

  if (!numero) {
    return null;
  }

  return Math.min(numero, 500);
}

function normalizarStatusLista(valor) {
  const status = limparTexto(valor).toLowerCase();

  if (status === 'inativos' || status === 'inativo') {
    return 'inativos';
  }

  if (status === 'todos' || status === 'all') {
    return 'todos';
  }

  return 'ativos';
}

function normalizarAtivo(valor, padrao = true) {
  if (valor === undefined || valor === null || valor === '') {
    return padrao;
  }

  if (typeof valor === 'boolean') {
    return valor;
  }

  if (typeof valor === 'number') {
    return valor !== 0;
  }

  const texto = limparTexto(String(valor)).toLowerCase();

  return ['1', 'true', 's', 'sim', 'ativo', 'ativos'].includes(texto);
}

function mapearCliente(row) {
  return {
    favorecido: row.favorecido ?? null,
    nome: limparTexto(row.nome),
    razao: limparTexto(row.razao),
    codigo: limparTexto(row.codigo),
    telefonePrincipal: limparTexto(row.telefone_principal),
    cidade: limparTexto(row.cidade),
    uf: limparTexto(row.uf),
    ativo: limparTexto(row.desativado).toUpperCase() !== 'S',
    desativado: limparTexto(row.desativado).toUpperCase() === 'S' ? 'S' : 'N'
  };
}

async function gerarIdGlobal(tx) {
  const rows = await tx.query('select gen_id(GEN_IDGLOBAL, 1) as id from rdb$database');
  return Number(rows?.[0]?.id || 0);
}

async function buscarClientePorId(favorecido, executor = firebirdService) {
  const id = normalizarInteiro(favorecido);

  if (!id) {
    throw new Error('Favorecido inválido.');
  }

  const rows = await executor.query(`
    SELECT
      F.FAVORECIDO,
      TRIM(COALESCE(F.NOME, '')) AS NOME,
      TRIM(COALESCE(F.RAZAO, '')) AS RAZAO,
      TRIM(COALESCE(F.CODIGO, '')) AS CODIGO,
      TRIM(COALESCE(F.FONE1, '')) AS TELEFONE_PRINCIPAL,
      TRIM(COALESCE(F.CIDADE, '')) AS CIDADE,
      TRIM(COALESCE(F.UF, '')) AS UF,
      COALESCE(F.DESATIVADO, 'N') AS DESATIVADO
    FROM FAVORECIDOS F
    WHERE F.FAVORECIDO = ?
      AND F.TIPOFAVORECIDO = 1
  `, [id]);

  if (!rows.length) {
    return null;
  }

  return mapearCliente(rows[0]);
}

// Equivalências usadas apenas na pesquisa; os dados gravados não são alterados.
const ACENTOS_PESQUISA = [
  ['ÁÀÂÃÄÅ', 'A'],
  ['ÉÈÊË', 'E'],
  ['ÍÌÎÏ', 'I'],
  ['ÓÒÔÕÖ', 'O'],
  ['ÚÙÛÜ', 'U'],
  ['Ç', 'C'],
  ['Ñ', 'N'],
  ['Ý', 'Y']
];

function normalizarPesquisa(valor) {
  return limparTexto(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function expressaoPesquisaSemAcentos(campo) {
  let expressao = `UPPER(COALESCE(${campo}, ''))`;
  for (const [acentuados, simples] of ACENTOS_PESQUISA) {
    for (const acento of acentuados) {
      expressao = `REPLACE(${expressao}, '${acento}', '${simples}')`;
    }
  }
  return expressao;
}

async function listarClientes(filtros = {}) {
  const nome = limparTexto(filtros.nome);
  const cidade = limparTexto(filtros.cidade);
  const uf = limparTexto(filtros.uf).toUpperCase();
  const telefone = limparTexto(filtros.telefone).replace(/\D+/g, '');
  const telefoneLocal = telefone.startsWith('55') && (telefone.length === 12 || telefone.length === 13)
    ? telefone.slice(2)
    : telefone;
  const status = normalizarStatusLista(filtros.status || (normalizarAtivo(filtros.incluirInativos, false) ? 'todos' : 'ativos'));
  const limite = normalizarLimite(filtros.limite);
  const firstClause = limite ? ` FIRST ${limite}` : '';

  let sql = `
    SELECT${firstClause}
      F.FAVORECIDO,
      TRIM(COALESCE(F.NOME, '')) AS NOME,
      TRIM(COALESCE(F.RAZAO, '')) AS RAZAO,
      TRIM(COALESCE(F.CODIGO, '')) AS CODIGO,
      TRIM(COALESCE(F.FONE1, '')) AS TELEFONE_PRINCIPAL,
      TRIM(COALESCE(F.CIDADE, '')) AS CIDADE,
      TRIM(COALESCE(F.UF, '')) AS UF,
      COALESCE(F.DESATIVADO, 'N') AS DESATIVADO
    FROM FAVORECIDOS F
    WHERE F.TIPOFAVORECIDO = ?
  `;

  const params = [1];

  if (status === 'ativos') {
    sql += ` AND COALESCE(F.DESATIVADO, 'N') = 'N'`;
  } else if (status === 'inativos') {
    sql += ` AND COALESCE(F.DESATIVADO, 'N') = 'S'`;
  }

  if (nome) {
    sql += ` AND (
      ${expressaoPesquisaSemAcentos('F.NOME')} LIKE ?
      OR ${expressaoPesquisaSemAcentos('F.RAZAO')} LIKE ?
      OR ${expressaoPesquisaSemAcentos('F.CODIGO')} LIKE ?
    )`;
    const termo = `%${normalizarPesquisa(nome)}%`;
    params.push(termo, termo, termo);
  }

  if (cidade) {
    sql += ` AND ${expressaoPesquisaSemAcentos('F.CIDADE')} LIKE ?`;
    params.push(`%${normalizarPesquisa(cidade)}%`);
  }

  if (uf) {
    sql += ` AND UPPER(COALESCE(F.UF, '')) = ?`;
    params.push(uf);
  }

  if (telefoneLocal) {
    const telefoneExpr = `
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(COALESCE(F.FONE1, ''), '(', ''),
              ')', ''),
            '-', ''),
          ' ', ''),
        '+', ''),
      '.', '')
    `;

    const candidatos = [...new Set([telefone, telefoneLocal].filter(Boolean))];
    const placeholders = candidatos.map(() => '?').join(', ');

    sql += ` AND ${telefoneExpr} IN (${placeholders})`;
    params.push(...candidatos);
  }

  sql += ' ORDER BY F.NOME';

  const rows = await firebirdService.query(sql, params);
  return rows.map(mapearCliente);
}

async function criarCliente(payload = {}) {
  const nome = limparTexto(payload.nome);
  const razao = limparTexto(payload.razao) || nome;
  const telefonePrincipal = textoPayload(payload, 'telefonePrincipal', 'telefone');
  const cidade = limparTexto(payload.cidade);
  const uf = limparTexto(payload.uf).toUpperCase();
  const ativo = normalizarAtivo(payload.ativo, true);

  if (!nome) {
    throw new Error('Nome do cliente é obrigatório.');
  }

  return firebirdService.withTransaction(async (tx) => {
    const favorecido = await gerarIdGlobal(tx);
    const codigo = limparTexto(payload.codigo) || String(favorecido);

    await tx.query(`
      INSERT INTO FAVORECIDOS (
        FAVORECIDO,
        NOME,
        RAZAO,
        CODIGO,
        FONE1,
        CIDADE,
        UF,
        TIPOFAVORECIDO,
        DESATIVADO,
        DATACADASTRO
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_DATE
      )
    `, [
      favorecido,
      nome,
      razao,
      codigo,
      telefonePrincipal,
      cidade,
      uf,
      ativo ? 'N' : 'S'
    ]);

    return buscarClientePorId(favorecido, tx);
  });
}

async function atualizarCliente(favorecido, payload = {}) {
  const id = normalizarInteiro(favorecido);

  if (!id) {
    throw new Error('Favorecido inválido.');
  }

  return firebirdService.withTransaction(async (tx) => {
    const atual = await buscarClientePorId(id, tx);

    if (!atual) {
      return null;
    }

    const nome = limparTexto(payload.nome || atual.nome);
    const razao = limparTexto(payload.razao || atual.razao || nome);
    const codigo = limparTexto(payload.codigo || atual.codigo || String(id));
    const telefonePrincipal = payload.telefonePrincipal === undefined && payload.telefone === undefined
      ? atual.telefonePrincipal
      : textoPayload(payload, 'telefonePrincipal', 'telefone');
    const cidade = payload.cidade === undefined ? atual.cidade : limparTexto(payload.cidade);
    const uf = (payload.uf === undefined ? atual.uf : limparTexto(payload.uf)).toUpperCase();
    const ativo = payload.ativo === undefined ? atual.ativo : normalizarAtivo(payload.ativo, atual.ativo);

    if (!nome) {
      throw new Error('Nome do cliente é obrigatório.');
    }

    await tx.query(`
      UPDATE FAVORECIDOS
      SET NOME = ?,
          RAZAO = ?,
          CODIGO = ?,
          FONE1 = ?,
          CIDADE = ?,
          UF = ?,
          TIPOFAVORECIDO = 1,
          DESATIVADO = ?
      WHERE FAVORECIDO = ?
        AND TIPOFAVORECIDO = 1
    `, [
      nome,
      razao,
      codigo,
      telefonePrincipal,
      cidade,
      uf,
      ativo ? 'N' : 'S',
      id
    ]);

    return buscarClientePorId(id, tx);
  });
}

async function desativarCliente(favorecido) {
  return atualizarCliente(favorecido, { ativo: false });
}

async function reativarCliente(favorecido) {
  return atualizarCliente(favorecido, { ativo: true });
}

module.exports = {
  listarClientes,
  buscarClientePorId,
  criarCliente,
  atualizarCliente,
  desativarCliente,
  reativarCliente
};
