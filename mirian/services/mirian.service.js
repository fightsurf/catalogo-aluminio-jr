const pool = require('../../db/connection');

function criarErro(status, mensagem) {
  const error = new Error(mensagem);
  error.status = status;
  return error;
}

function textoObrigatorio(valor, campo, limite) {
  const texto = String(valor || '').trim();

  if (!texto) {
    throw criarErro(400, `${campo} é obrigatório.`);
  }

  if (texto.length > limite) {
    throw criarErro(400, `${campo} deve possuir no máximo ${limite} caracteres.`);
  }

  return texto;
}

function idPositivo(valor, campo = 'ID') {
  const id = Number.parseInt(valor, 10);

  if (!Number.isInteger(id) || id <= 0) {
    throw criarErro(400, `${campo} inválido.`);
  }

  return id;
}

function normalizarDataNascimento(valor) {
  const data = String(valor || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw criarErro(400, 'Data de nascimento inválida.');
  }

  const [ano, mes, dia] = data.split('-').map(Number);
  const dataInformada = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));

  if (
    Number.isNaN(dataInformada.getTime()) ||
    dataInformada.getUTCFullYear() !== ano ||
    dataInformada.getUTCMonth() + 1 !== mes ||
    dataInformada.getUTCDate() !== dia
  ) {
    throw criarErro(400, 'Data de nascimento inválida.');
  }

  const hoje = new Date();
  const hojeIso = [
    hoje.getFullYear(),
    String(hoje.getMonth() + 1).padStart(2, '0'),
    String(hoje.getDate()).padStart(2, '0'),
  ].join('-');

  if (data > hojeIso) {
    throw criarErro(400, 'A data de nascimento não pode estar no futuro.');
  }

  return data;
}

function normalizarIdsSintomas(sintomas) {
  if (sintomas == null) return [];

  if (!Array.isArray(sintomas)) {
    throw criarErro(400, 'A lista de sintomas é inválida.');
  }

  const ids = sintomas.map((item) => idPositivo(item, 'Sintoma'));
  return [...new Set(ids)];
}

async function listarSintomas({ incluirInativos = false } = {}) {
  const resultado = await pool.query(
    `
      SELECT id, nome, ativo
      FROM mirian_sintomas
      WHERE ($1::boolean = TRUE OR ativo = TRUE)
      ORDER BY ativo DESC, LOWER(nome), id
    `,
    [Boolean(incluirInativos)]
  );

  return resultado.rows;
}

async function criarSintoma({ nome }) {
  const nomeValidado = textoObrigatorio(nome, 'Nome do sintoma', 120);

  try {
    const resultado = await pool.query(
      `
        INSERT INTO mirian_sintomas (nome, ativo)
        VALUES ($1, TRUE)
        RETURNING id, nome, ativo
      `,
      [nomeValidado]
    );

    return resultado.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw criarErro(409, 'Já existe um sintoma com esse nome.');
    }

    throw error;
  }
}

async function atualizarSintoma(idInformado, alteracoes) {
  const id = idPositivo(idInformado, 'Sintoma');
  const possuiNome = Object.prototype.hasOwnProperty.call(alteracoes, 'nome');
  const possuiAtivo = Object.prototype.hasOwnProperty.call(alteracoes, 'ativo');

  if (!possuiNome && !possuiAtivo) {
    throw criarErro(400, 'Nenhuma alteração foi informada.');
  }

  let nome = null;
  let ativo = null;

  if (possuiNome) {
    nome = textoObrigatorio(alteracoes.nome, 'Nome do sintoma', 120);
  }

  if (possuiAtivo) {
    if (typeof alteracoes.ativo !== 'boolean') {
      throw criarErro(400, 'O campo ativo deve ser verdadeiro ou falso.');
    }

    ativo = alteracoes.ativo;
  }

  try {
    const resultado = await pool.query(
      `
        UPDATE mirian_sintomas
        SET
          nome = CASE WHEN $2::boolean THEN $3::varchar ELSE nome END,
          ativo = CASE WHEN $4::boolean THEN $5::boolean ELSE ativo END
        WHERE id = $1
        RETURNING id, nome, ativo
      `,
      [id, possuiNome, nome, possuiAtivo, ativo]
    );

    if (!resultado.rowCount) {
      throw criarErro(404, 'Sintoma não encontrado.');
    }

    return resultado.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw criarErro(409, 'Já existe um sintoma com esse nome.');
    }

    throw error;
  }
}

async function excluirSintoma(idInformado) {
  const id = idPositivo(idInformado, 'Sintoma');
  const resultado = await pool.query(
    `
      DELETE FROM mirian_sintomas
      WHERE id = $1
      RETURNING id, nome
    `,
    [id]
  );

  if (!resultado.rowCount) {
    throw criarErro(404, 'Sintoma não encontrado.');
  }

  return resultado.rows[0];
}

async function criarPaciente(dados) {
  const nome = textoObrigatorio(dados.nome, 'Nome completo', 160);
  const telefone = textoObrigatorio(dados.telefone, 'Telefone', 30);
  const cidade = textoObrigatorio(dados.cidade, 'Cidade', 120);
  const dataNascimento = normalizarDataNascimento(dados.data_nascimento);
  const sintomas = normalizarIdsSintomas(dados.sintomas);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (sintomas.length) {
      const sintomasValidos = await client.query(
        `
          SELECT id
          FROM mirian_sintomas
          WHERE ativo = TRUE
            AND id = ANY($1::bigint[])
        `,
        [sintomas]
      );

      if (sintomasValidos.rowCount !== sintomas.length) {
        throw criarErro(400, 'Um ou mais sintomas selecionados não estão disponíveis.');
      }
    }

    const pacienteResultado = await client.query(
      `
        INSERT INTO mirian_pacientes (
          nome,
          telefone,
          cidade,
          data_nascimento,
          visitado
        )
        VALUES ($1, $2, $3, $4, FALSE)
        RETURNING
          id,
          nome,
          telefone,
          cidade,
          TO_CHAR(data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
          visitado,
          data_cadastro
      `,
      [nome, telefone, cidade, dataNascimento]
    );

    const paciente = pacienteResultado.rows[0];

    for (const sintomaId of sintomas) {
      await client.query(
        `
          INSERT INTO mirian_paciente_sintomas (paciente_id, sintoma_id)
          VALUES ($1, $2)
        `,
        [paciente.id, sintomaId]
      );
    }

    await client.query('COMMIT');

    return {
      ...paciente,
      sintomas,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listarPacientes(filtros = {}) {
  const nome = String(filtros.nome || '').trim();
  const telefone = String(filtros.telefone || '').trim();
  const cidade = String(filtros.cidade || '').trim();
  const sintomaId = filtros.sintomaId ? idPositivo(filtros.sintomaId, 'Sintoma') : null;

  const resultado = await pool.query(
    `
      SELECT
        p.id,
        p.nome,
        p.telefone,
        p.cidade,
        TO_CHAR(p.data_nascimento, 'YYYY-MM-DD') AS data_nascimento,
        p.visitado,
        p.data_cadastro,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', s.id,
              'nome', s.nome,
              'ativo', s.ativo
            )
            ORDER BY LOWER(s.nome)
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS sintomas
      FROM mirian_pacientes p
      LEFT JOIN mirian_paciente_sintomas ps
        ON ps.paciente_id = p.id
      LEFT JOIN mirian_sintomas s
        ON s.id = ps.sintoma_id
      WHERE ($1 = '' OR p.nome ILIKE '%' || $1 || '%')
        AND ($2 = '' OR p.telefone ILIKE '%' || $2 || '%')
        AND ($3 = '' OR p.cidade ILIKE '%' || $3 || '%')
        AND (
          $4::bigint IS NULL
          OR EXISTS (
            SELECT 1
            FROM mirian_paciente_sintomas filtro_ps
            WHERE filtro_ps.paciente_id = p.id
              AND filtro_ps.sintoma_id = $4
          )
        )
      GROUP BY p.id
      ORDER BY p.visitado ASC, p.data_cadastro DESC, LOWER(p.nome)
    `,
    [nome, telefone, cidade, sintomaId]
  );

  return resultado.rows;
}

async function atualizarPacienteVisitado(idInformado, visitadoInformado) {
  const id = idPositivo(idInformado, 'Paciente');

  if (typeof visitadoInformado !== 'boolean') {
    throw criarErro(400, 'O campo visitado deve ser verdadeiro ou falso.');
  }

  const resultado = await pool.query(
    `
      UPDATE mirian_pacientes
      SET visitado = $2
      WHERE id = $1
      RETURNING id, visitado
    `,
    [id, visitadoInformado]
  );

  if (!resultado.rowCount) {
    throw criarErro(404, 'Paciente não encontrado.');
  }

  return resultado.rows[0];
}

module.exports = {
  listarSintomas,
  criarSintoma,
  atualizarSintoma,
  excluirSintoma,
  criarPaciente,
  listarPacientes,
  atualizarPacienteVisitado,
};
