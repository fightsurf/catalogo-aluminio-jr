const pool = require('../../db/connection');

const SINTOMAS_INICIAIS = [
  'Febre',
  'Tosse',
  'Dor de cabeça',
  'Dor no corpo',
  'Falta de ar',
  'Náusea',
  'Vômito',
  'Diarreia',
];

async function criarEstrutura() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS mirian_pacientes (
        id BIGSERIAL PRIMARY KEY,
        nome VARCHAR(160) NOT NULL,
        telefone VARCHAR(30) NOT NULL,
        cidade VARCHAR(120) NOT NULL,
        data_nascimento DATE NOT NULL,
        visitado BOOLEAN NOT NULL DEFAULT FALSE,
        data_cadastro TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mirian_sintomas (
        id BIGSERIAL PRIMARY KEY,
        nome VARCHAR(120) NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mirian_paciente_sintomas (
        id BIGSERIAL PRIMARY KEY,
        paciente_id BIGINT NOT NULL,
        sintoma_id BIGINT NOT NULL,
        CONSTRAINT mirian_paciente_sintomas_paciente_fk
          FOREIGN KEY (paciente_id)
          REFERENCES mirian_pacientes(id)
          ON DELETE CASCADE,
        CONSTRAINT mirian_paciente_sintomas_sintoma_fk
          FOREIGN KEY (sintoma_id)
          REFERENCES mirian_sintomas(id)
          ON DELETE CASCADE,
        CONSTRAINT mirian_paciente_sintomas_unico
          UNIQUE (paciente_id, sintoma_id)
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS mirian_sintomas_nome_unico_idx
      ON mirian_sintomas (LOWER(nome))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS mirian_pacientes_nome_idx
      ON mirian_pacientes (LOWER(nome))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS mirian_pacientes_telefone_idx
      ON mirian_pacientes (telefone)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS mirian_pacientes_cidade_idx
      ON mirian_pacientes (LOWER(cidade))
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS mirian_paciente_sintomas_sintoma_idx
      ON mirian_paciente_sintomas (sintoma_id)
    `);

    for (const nome of SINTOMAS_INICIAIS) {
      await client.query(
        `
          INSERT INTO mirian_sintomas (nome, ativo)
          VALUES ($1, TRUE)
          ON CONFLICT DO NOTHING
        `,
        [nome]
      );
    }

    await client.query('COMMIT');
    console.log('🟢 Estrutura Mirian criada/verificada.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  criarEstrutura,
};
