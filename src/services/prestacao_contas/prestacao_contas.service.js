const pool = require('../../../db/connection');

class PrestacaoContasService {

  // ─── PRESTAÇÕES ───────────────────────────────────────────────

  async listar() {
    const result = await pool.query(`
      SELECT p.*, f.nome AS fornecedor_nome
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      ORDER BY p.id DESC
    `);
    return result.rows;
  }

  async buscarPorId(id) {
    const result = await pool.query(`
      SELECT p.*, f.nome AS fornecedor_nome
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  async criar(data) {
    const { titulo, data_referencia, fornecedor_id } = data;
    const result = await pool.query(`
      INSERT INTO prestacoes (titulo, data_referencia, fornecedor_id, total_material, total_pago, saldo_restante)
      VALUES ($1, $2, $3, 0, 0, 0)
      RETURNING *
    `, [titulo, this._parseDate(data_referencia), fornecedor_id]);
    const prestacao = result.rows[0];
    await this._registrarLog(prestacao.id, 'CRIAR_PRESTACAO', `Prestação criada: ${titulo}`);
    return prestacao;
  }

  async atualizar(id, data) {
    const { titulo, data_referencia, fornecedor_id } = data;
    const result = await pool.query(`
      UPDATE prestacoes
      SET titulo = $1, data_referencia = $2, fornecedor_id = $3
      WHERE id = $4
      RETURNING *
    `, [titulo, this._parseDate(data_referencia), fornecedor_id, id]);
    const prestacao = result.rows[0] || null;
    if (prestacao) {
      await this._registrarLog(id, 'ATUALIZAR_PRESTACAO', `Prestação atualizada: ${titulo}`);
    }
    return prestacao;
  }

  async deletar(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM prestacao_pagamentos WHERE prestacao_id = $1`, [id]);
      await client.query(`DELETE FROM prestacao_itens WHERE prestacao_id = $1`, [id]);
      await client.query(`DELETE FROM prestacao_logs WHERE prestacao_id = $1`, [id]);
      await client.query(`DELETE FROM prestacoes WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return true;
  }

  // ─── ITENS ────────────────────────────────────────────────────

  async criarItem(prestacao_id, data) {
    const { material, peso_kg, preco_por_kg } = data;
    const total_item = parseFloat(peso_kg) * parseFloat(preco_por_kg);
    const result = await pool.query(`
      INSERT INTO prestacao_itens (prestacao_id, material, peso_kg, preco_por_kg, total_item)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [prestacao_id, material, peso_kg, preco_por_kg, total_item]);
    const item = result.rows[0];
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'CRIAR_ITEM', `Item adicionado: ${material}`);
    return item;
  }

  async atualizarItem(prestacao_id, itemId, data) {
    const { material, peso_kg, preco_por_kg } = data;
    const total_item = parseFloat(peso_kg) * parseFloat(preco_por_kg);
    const result = await pool.query(`
      UPDATE prestacao_itens
      SET material = $1, peso_kg = $2, preco_por_kg = $3, total_item = $4
      WHERE id = $5 AND prestacao_id = $6
      RETURNING *
    `, [material, peso_kg, preco_por_kg, total_item, itemId, prestacao_id]);
    const item = result.rows[0] || null;
    if (item) {
      await this._recalcular(prestacao_id);
      await this._registrarLog(prestacao_id, 'ATUALIZAR_ITEM', `Item atualizado: ${material}`);
    }
    return item;
  }

  async deletarItem(prestacao_id, itemId) {
    await pool.query(`DELETE FROM prestacao_itens WHERE id = $1 AND prestacao_id = $2`, [itemId, prestacao_id]);
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'DELETAR_ITEM', `Item removido: id=${itemId}`);
    return true;
  }

  // ─── PAGAMENTOS ───────────────────────────────────────────────

  async criarPagamento(prestacao_id, data) {
    const { data: dataPag, valor, observacao } = data;
    const result = await pool.query(`
      INSERT INTO prestacao_pagamentos (prestacao_id, data, valor, observacao)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [prestacao_id, this._parseDate(dataPag), valor, observacao || null]);
    const pagamento = result.rows[0];
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'CRIAR_PAGAMENTO', `Pagamento registrado: R$ ${valor}`);
    return pagamento;
  }

  async deletarPagamento(prestacao_id, pagamentoId) {
    await pool.query(`DELETE FROM prestacao_pagamentos WHERE id = $1 AND prestacao_id = $2`, [pagamentoId, prestacao_id]);
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'DELETAR_PAGAMENTO', `Pagamento removido: id=${pagamentoId}`);
    return true;
  }

  // ─── RESUMO ───────────────────────────────────────────────────

  async gerarResumoPrestacao(prestacao_id) {
    const cabecalhoRes = await pool.query(`
      SELECT p.*, f.nome AS fornecedor_nome
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.id = $1
    `, [prestacao_id]);
    const cabecalho = cabecalhoRes.rows[0] || null;

    const materiaisRes = await pool.query(`
      SELECT * FROM prestacao_itens WHERE prestacao_id = $1 ORDER BY id ASC
    `, [prestacao_id]);

    const pagamentosRes = await pool.query(`
      SELECT * FROM prestacao_pagamentos WHERE prestacao_id = $1 ORDER BY data ASC, id ASC
    `, [prestacao_id]);

    const total_material = parseFloat(cabecalho ? cabecalho.total_material : 0);
    const total_pago = parseFloat(cabecalho ? cabecalho.total_pago : 0);
    const saldo_restante = parseFloat(cabecalho ? cabecalho.saldo_restante : 0);
    const peso_total = materiaisRes.rows.reduce((acc, i) => acc + parseFloat(i.peso_kg), 0);

    return {
      cabecalho,
      materiais: materiaisRes.rows,
      pagamentos: pagamentosRes.rows,
      totais: {
        peso_total,
        total_material,
        total_pago,
        saldo_restante
      }
    };
  }

  // ─── HELPERS PRIVADOS ─────────────────────────────────────────

  async _recalcular(prestacao_id) {
    const itensRes = await pool.query(`
      SELECT COALESCE(SUM(total_item), 0) AS total_material
      FROM prestacao_itens
      WHERE prestacao_id = $1
    `, [prestacao_id]);
    const total_material = parseFloat(itensRes.rows[0].total_material);

    const pagRes = await pool.query(`
      SELECT COALESCE(SUM(valor), 0) AS total_pago
      FROM prestacao_pagamentos
      WHERE prestacao_id = $1
    `, [prestacao_id]);
    const total_pago = parseFloat(pagRes.rows[0].total_pago);

    const saldo_restante = total_material - total_pago;

    await pool.query(`
      UPDATE prestacoes
      SET total_material = $1, total_pago = $2, saldo_restante = $3
      WHERE id = $4
    `, [total_material, total_pago, saldo_restante, prestacao_id]);
  }

  async _registrarLog(prestacao_id, acao, descricao) {
    await pool.query(`
      INSERT INTO prestacao_logs (prestacao_id, acao, descricao)
      VALUES ($1, $2, $3)
    `, [prestacao_id, acao, descricao]);
  }

  _parseDate(value) {
    if (!value) return value;
    // Convert DD/MM/YYYY → YYYY-MM-DD
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [d, m, y] = value.split('/');
      return `${y}-${m}-${d}`;
    }
    return value;
  }

}

module.exports = new PrestacaoContasService();

