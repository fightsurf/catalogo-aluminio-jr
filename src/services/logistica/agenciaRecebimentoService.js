const pool = require('../../../db/connection');

let estruturaPromise = null;

function criarErro(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function limparTexto(value) {
  return String(value || '').trim();
}

function normalizarCodigo(value) {
  const codigo = Number.parseInt(value, 10);
  if (!Number.isInteger(codigo) || codigo <= 0) {
    throw criarErro('Código da agência inválido.', 400);
  }
  return codigo;
}

function normalizarCidadeId(value, { obrigatoria = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (obrigatoria) {
      throw criarErro('Cidade é obrigatória.', 400);
    }
    return null;
  }

  const cidadeId = Number.parseInt(value, 10);
  if (!Number.isInteger(cidadeId) || cidadeId <= 0) {
    throw criarErro('Cidade inválida.', 400);
  }
  return cidadeId;
}

async function garantirEstruturaAgencias(client = pool) {
  if (!estruturaPromise || client !== pool) {
    const executar = async () => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS agencias_recebimento (
          codigo BIGSERIAL PRIMARY KEY,
          nome TEXT NOT NULL,
          telefone TEXT,
          cidade_id BIGINT REFERENCES cidades(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await client.query(`
        ALTER TABLE agencias_recebimento
        ADD COLUMN IF NOT EXISTS telefone TEXT
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_agencias_recebimento_nome
        ON agencias_recebimento (LOWER(nome))
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_agencias_recebimento_cidade_id
        ON agencias_recebimento (cidade_id)
      `);

      const localEntregaResult = await client.query(`
        SELECT to_regclass('public.carradas_pedidos_local_entrega') AS tabela
      `);

      if (localEntregaResult.rows[0]?.tabela) {
        await client.query(`
          ALTER TABLE carradas_pedidos_local_entrega
          ADD COLUMN IF NOT EXISTS agencia_recebimento_codigo BIGINT REFERENCES agencias_recebimento(codigo)
        `);

        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_carradas_local_entrega_agencia_recebimento
          ON carradas_pedidos_local_entrega(agencia_recebimento_codigo)
        `);

        // Converte os nomes já existentes no campo textual legado em cadastros reais.
        // A cidade fica vazia nesses registros porque ela não era armazenada anteriormente.
        await client.query(`
          INSERT INTO agencias_recebimento (nome)
          SELECT DISTINCT ON (LOWER(BTRIM(le.agencia_cidade))) BTRIM(le.agencia_cidade)
          FROM carradas_pedidos_local_entrega le
          WHERE NULLIF(BTRIM(le.agencia_cidade), '') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM agencias_recebimento a
              WHERE LOWER(BTRIM(a.nome)) = LOWER(BTRIM(le.agencia_cidade))
            )
          ORDER BY LOWER(BTRIM(le.agencia_cidade)), BTRIM(le.agencia_cidade)
        `);

        await client.query(`
          UPDATE carradas_pedidos_local_entrega le
          SET agencia_recebimento_codigo = (
            SELECT a.codigo
            FROM agencias_recebimento a
            WHERE LOWER(BTRIM(a.nome)) = LOWER(BTRIM(le.agencia_cidade))
            ORDER BY a.codigo
            LIMIT 1
          )
          WHERE le.agencia_recebimento_codigo IS NULL
            AND NULLIF(BTRIM(le.agencia_cidade), '') IS NOT NULL
        `);
      }
    };

    if (client !== pool) {
      await executar();
      return;
    }

    estruturaPromise = executar().catch((error) => {
      estruturaPromise = null;
      throw error;
    });
  }

  await estruturaPromise;
}

async function buscarCidadeOuFalhar(cidadeId, client = pool) {
  const result = await client.query('SELECT id FROM cidades WHERE id = $1 LIMIT 1', [cidadeId]);
  if (!result.rows[0]) {
    throw criarErro('Cidade não encontrada.', 404);
  }
}

async function verificarNomeDuplicado(nome, codigoIgnorar = null, client = pool) {
  const params = [nome];
  let filtroCodigo = '';

  if (codigoIgnorar) {
    params.push(codigoIgnorar);
    filtroCodigo = 'AND codigo <> $2';
  }

  const result = await client.query(
    `
      SELECT codigo
      FROM agencias_recebimento
      WHERE LOWER(BTRIM(nome)) = LOWER(BTRIM($1))
        ${filtroCodigo}
      LIMIT 1
    `,
    params
  );

  if (result.rows[0]) {
    throw criarErro('Já existe uma Agência de Recebimento com este nome.', 409);
  }
}

async function listarAgencias() {
  await garantirEstruturaAgencias();

  const result = await pool.query(`
    SELECT
      a.codigo,
      a.nome,
      a.telefone,
      a.cidade_id,
      c.nome AS cidade_nome,
      c.estado AS cidade_estado,
      a.created_at,
      a.updated_at
    FROM agencias_recebimento a
    LEFT JOIN cidades c ON c.id = a.cidade_id
    ORDER BY LOWER(a.nome), a.codigo
  `);

  return result.rows;
}

async function buscarAgenciaPorCodigo(codigoParam) {
  await garantirEstruturaAgencias();
  const codigo = normalizarCodigo(codigoParam);

  const result = await pool.query(
    `
      SELECT
        a.codigo,
        a.nome,
        a.telefone,
        a.cidade_id,
        c.nome AS cidade_nome,
        c.estado AS cidade_estado,
        a.created_at,
        a.updated_at
      FROM agencias_recebimento a
      LEFT JOIN cidades c ON c.id = a.cidade_id
      WHERE a.codigo = $1
      LIMIT 1
    `,
    [codigo]
  );

  return result.rows[0] || null;
}

async function criarAgencia(dados = {}) {
  await garantirEstruturaAgencias();

  const nome = limparTexto(dados.nome);
  const telefone = limparTexto(dados.telefone);
  const cidadeId = normalizarCidadeId(dados.cidade_id, { obrigatoria: true });

  if (!nome) {
    throw criarErro('Nome é obrigatório.', 400);
  }

  await buscarCidadeOuFalhar(cidadeId);
  await verificarNomeDuplicado(nome);

  const result = await pool.query(
    `
      INSERT INTO agencias_recebimento (nome, telefone, cidade_id)
      VALUES ($1, $2, $3)
      RETURNING codigo
    `,
    [nome, telefone || null, cidadeId]
  );

  return buscarAgenciaPorCodigo(result.rows[0].codigo);
}

async function atualizarAgencia(codigoParam, dados = {}) {
  await garantirEstruturaAgencias();

  const codigo = normalizarCodigo(codigoParam);
  const nome = limparTexto(dados.nome);
  const telefone = limparTexto(dados.telefone);
  const cidadeId = normalizarCidadeId(dados.cidade_id, { obrigatoria: true });

  if (!nome) {
    throw criarErro('Nome é obrigatório.', 400);
  }

  await buscarCidadeOuFalhar(cidadeId);
  await verificarNomeDuplicado(nome, codigo);

  const result = await pool.query(
    `
      UPDATE agencias_recebimento
      SET nome = $1,
          telefone = $2,
          cidade_id = $3,
          updated_at = NOW()
      WHERE codigo = $4
      RETURNING codigo
    `,
    [nome, telefone || null, cidadeId, codigo]
  );

  if (!result.rows[0]) {
    throw criarErro('Agência de Recebimento não encontrada.', 404);
  }

  // Mantém o campo textual antigo sincronizado enquanto outras rotinas ainda o utilizarem.
  await pool.query(
    `
      UPDATE carradas_pedidos_local_entrega
      SET agencia_cidade = $1,
          updated_at = NOW()
      WHERE agencia_recebimento_codigo = $2
    `,
    [nome, codigo]
  );

  return buscarAgenciaPorCodigo(codigo);
}

async function deletarAgencia(codigoParam) {
  await garantirEstruturaAgencias();
  const codigo = normalizarCodigo(codigoParam);

  try {
    const result = await pool.query(
      'DELETE FROM agencias_recebimento WHERE codigo = $1 RETURNING codigo',
      [codigo]
    );

    if (!result.rows[0]) {
      throw criarErro('Agência de Recebimento não encontrada.', 404);
    }

    return true;
  } catch (error) {
    if (error?.code === '23503') {
      throw criarErro('Esta agência já está vinculada a pedidos e não pode ser excluída.', 409);
    }
    throw error;
  }
}

module.exports = {
  garantirEstruturaAgencias,
  listarAgencias,
  buscarAgenciaPorCodigo,
  criarAgencia,
  atualizarAgencia,
  deletarAgencia
};
