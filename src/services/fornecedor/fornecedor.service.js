const pool = require('../../../db/connection');

class FornecedorService {

  async listar(nome) {
    try {
      let query = `
        SELECT 
          f.id,
          f.nome,
          f.contato_principal,
          f.telefone,
          f.cidade_id,
          c.nome AS cidade,
          c.estado
        FROM fornecedores f
        JOIN cidades c ON c.id = f.cidade_id
      `;

      const values = [];

      if (nome) {
        query += ` WHERE LOWER(f.nome) LIKE LOWER($1)`;
        values.push(`%${nome}%`);
      }

      query += ` ORDER BY f.nome ASC`;

      const result = await pool.query(query, values);
      return result.rows;

    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  async buscarPorId(id) {
    try {
      const query = `
        SELECT 
          f.id,
          f.nome,
          f.contato_principal,
          f.telefone,
          f.cidade_id,
          c.nome AS cidade,
          c.estado
        FROM fornecedores f
        JOIN cidades c ON c.id = f.cidade_id
        WHERE f.id = $1
      `;

      const result = await pool.query(query, [id]);
      return result.rows[0];

    } catch (error) {
      throw error;
    }
  }

  async criar(data) {
    try {
      const query = `
        INSERT INTO fornecedores (nome, contato_principal, telefone, cidade_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const values = [
        data.nome,
        data.contato_principal,
        data.telefone,
        data.cidade_id
      ];

      const result = await pool.query(query, values);
      return result.rows[0];

    } catch (error) {
      throw error;
    }
  }

  async atualizar(id, data) {
    try {
      const query = `
        UPDATE fornecedores
        SET nome = $1,
            contato_principal = $2,
            telefone = $3,
            cidade_id = $4
        WHERE id = $5
        RETURNING *
      `;

      const values = [
        data.nome,
        data.contato_principal,
        data.telefone,
        data.cidade_id,
        id
      ];

      const result = await pool.query(query, values);
      return result.rows[0];

    } catch (error) {
      throw error;
    }
  }

  async deletar(id) {
    try {
      await pool.query(`DELETE FROM fornecedores WHERE id = $1`, [id]);
      return true;
    } catch (error) {
      throw error;
    }
  }

}

module.exports = new FornecedorService();
