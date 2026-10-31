'use strict';

// Apenas telefone e horario da ultima mensagem RECEBIDA.
// Nao guarda corpo, midia ou identificador da mensagem.
const pool = require('../../../db/connection');
let estruturaPromise;

async function preparar() {
  if (!estruturaPromise) {
    estruturaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS bot_contatos_ultima_entrada (
        telefone VARCHAR(120) PRIMARY KEY,
        ultima_entrada_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
      )
    `).catch(error => { estruturaPromise = null; throw error; });
  }
  return estruturaPromise;
}

async function marcarEntrada(telefone) {
  await preparar();
  await pool.query(`
    INSERT INTO bot_contatos_ultima_entrada (telefone, ultima_entrada_em)
    VALUES ($1, NOW())
    ON CONFLICT (telefone) DO UPDATE
      SET ultima_entrada_em = NOW()
  `, [telefone]);
}

module.exports = { preparar, marcarEntrada };
