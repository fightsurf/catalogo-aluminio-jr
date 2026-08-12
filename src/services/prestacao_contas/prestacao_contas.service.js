const pool = require('../../../db/connection');
const envioWhatsappService = require('../whatsapp/envio-whatsapp.service');
const prestacaoPdfService = require('./prestacaoPdf.service');

class PrestacaoContasService {
  constructor() {
    this._schemaReady = null;
  }

  // ─── PRESTAÇÕES ───────────────────────────────────────────────

  async listar(status = 'ABERTA') {
    await this._ensureSchema();
    const statusNormalizado = this._normalizarStatusFiltro(status);
    const statusExpr = this._statusSql('p.status');

    const result = await pool.query(`
      SELECT p.*, f.nome AS fornecedor_nome
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE ($1::text = 'TODAS' OR ${statusExpr} = $1)
      ORDER BY
        CASE WHEN ${statusExpr} = 'ABERTA' THEN 0 ELSE 1 END,
        COALESCE(p.concluida_em, p.data_referencia, NOW()) DESC,
        p.id DESC
    `, [statusNormalizado]);
    return result.rows;
  }


  async listarPainelSaldosAbertos() {
    await this._ensureSchema();
    const statusExpr = this._statusSql('p.status');

    const prestacoesRes = await pool.query(`
      SELECT
        p.id,
        p.titulo,
        p.data_referencia,
        p.fornecedor_id,
        p.total_material,
        p.total_pago,
        p.saldo_restante,
        f.nome AS fornecedor_nome
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE ${statusExpr} = 'ABERTA'
      ORDER BY
        COALESCE(NULLIF(TRIM(f.nome), ''), 'Fornecedor sem nome') ASC,
        p.data_referencia DESC NULLS LAST,
        p.id DESC
    `);

    const movimentosRes = await pool.query(`
      WITH movimentos AS (
        SELECT
          i.prestacao_id,
          'MATERIAL'::text AS tipo,
          i.id AS registro_id,
          COALESCE(i.movimentado_em, p.data_referencia::timestamp, NOW()) AS movimentada_em,
          COALESCE(NULLIF(TRIM(i.descricao_material), ''), 'Material') AS descricao,
          i.total_item AS valor,
          2 AS ordem_tipo
        FROM prestacao_itens i
        INNER JOIN prestacoes p ON p.id = i.prestacao_id
        WHERE ${statusExpr} = 'ABERTA'

        UNION ALL

        SELECT
          pg.prestacao_id,
          CASE WHEN pg.credito_origem_id IS NULL THEN 'PAGAMENTO' ELSE 'CREDITO' END AS tipo,
          pg.id AS registro_id,
          COALESCE(pg.data_pagamento::timestamp, p.data_referencia::timestamp, NOW()) AS movimentada_em,
          COALESCE(
            NULLIF(TRIM(pg.observacao), ''),
            CASE WHEN pg.credito_origem_id IS NULL THEN 'Pagamento' ELSE 'Crédito de prestação anterior' END
          ) AS descricao,
          pg.valor AS valor,
          1 AS ordem_tipo
        FROM prestacao_pagamentos pg
        INNER JOIN prestacoes p ON p.id = pg.prestacao_id
        WHERE ${statusExpr} = 'ABERTA'
      ),
      ranqueados AS (
        SELECT
          movimentos.*,
          ROW_NUMBER() OVER (
            PARTITION BY prestacao_id
            ORDER BY movimentada_em DESC, ordem_tipo DESC, registro_id DESC
          ) AS posicao
        FROM movimentos
      )
      SELECT
        prestacao_id,
        tipo,
        registro_id,
        movimentada_em,
        descricao,
        valor
      FROM ranqueados
      WHERE posicao <= 5
      ORDER BY
        prestacao_id ASC,
        movimentada_em ASC,
        ordem_tipo ASC,
        registro_id ASC
    `);

    const movimentosPorPrestacao = new Map();
    for (const movimento of movimentosRes.rows) {
      const chave = String(movimento.prestacao_id);
      if (!movimentosPorPrestacao.has(chave)) movimentosPorPrestacao.set(chave, []);
      movimentosPorPrestacao.get(chave).push(movimento);
    }

    return prestacoesRes.rows.map((prestacao) => ({
      ...prestacao,
      movimentacoes: movimentosPorPrestacao.get(String(prestacao.id)) || []
    }));
  }

  async buscarPorId(id) {
    await this._ensureSchema();
    const result = await pool.query(`
      SELECT p.*, f.nome AS fornecedor_nome
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.id = $1
    `, [id]);
    return result.rows[0] || null;
  }

  async criar(data) {
    await this._ensureSchema();
    const { titulo, data_referencia, fornecedor_id } = data;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const result = await client.query(`
        INSERT INTO prestacoes (titulo, data_referencia, fornecedor_id, total_material, total_pago, saldo_restante, status)
        VALUES ($1, $2, $3, 0, 0, 0, 'ABERTA')
        RETURNING *
      `, [titulo, this._parseDate(data_referencia), fornecedor_id]);

      const prestacao = result.rows[0];
      await this._registrarLog(prestacao.id, 'CRIAR_PRESTACAO', `Prestação criada: ${titulo}`, client);

      const creditosAplicados = await this._aplicarCreditosPendentes(prestacao, client);
      if (creditosAplicados.length) {
        await this._recalcular(prestacao.id, client);
      }

      const finalRes = await client.query(`SELECT * FROM prestacoes WHERE id = $1`, [prestacao.id]);
      await client.query('COMMIT');

      return {
        ...finalRes.rows[0],
        creditos_aplicados: creditosAplicados
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async atualizar(id, data) {
    await this._ensureSchema();
    await this._assertAberta(id);

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
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await this._assertAberta(id, client);

      const vinculadosRes = await client.query(`
        SELECT COUNT(*)::integer AS total
        FROM prestacao_pagamentos
        WHERE prestacao_id = $1
          AND origem_sistema = 'PEDIDO_LEGADO'
          AND origem_pagamento_codigo IS NOT NULL
      `, [id]);

      if (Number(vinculadosRes.rows[0]?.total || 0) > 0) {
        const err = new Error('Esta prestação possui pagamentos vinculados a pedidos. Exclua os pagamentos pela tela de pagamentos dos pedidos antes de apagar a prestação.');
        err.statusCode = 409;
        throw err;
      }

      await this._devolverCreditosConsumidosPelaPrestacao(id, client);
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

  async concluir(id) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const prestacao = await this._assertAberta(id, client);
      await this._recalcular(id, client);

      const atualizadaRes = await client.query(`
        SELECT p.*, f.nome AS fornecedor_nome
        FROM prestacoes p
        LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
        WHERE p.id = $1
        FOR UPDATE OF p
      `, [id]);
      const atualizada = atualizadaRes.rows[0];
      const saldo = this._toNumber(atualizada.saldo_restante);
      let creditoGerado = null;

      if (saldo < -0.004) {
        const valorCredito = Math.abs(saldo);
        const creditoRes = await client.query(`
          INSERT INTO prestacao_creditos_fornecedor
            (fornecedor_id, prestacao_origem_id, valor, status, observacao, criado_em)
          VALUES
            ($1, $2, $3, 'PENDENTE', $4, NOW())
          ON CONFLICT (prestacao_origem_id) DO UPDATE
          SET fornecedor_id = EXCLUDED.fornecedor_id,
              valor = EXCLUDED.valor,
              status = 'PENDENTE',
              prestacao_destino_id = NULL,
              pagamento_destino_id = NULL,
              utilizado_em = NULL,
              cancelado_em = NULL,
              observacao = EXCLUDED.observacao,
              criado_em = NOW()
          WHERE prestacao_creditos_fornecedor.status <> 'UTILIZADO'
          RETURNING *
        `, [
          atualizada.fornecedor_id,
          id,
          valorCredito,
          `Crédito gerado por pagamento a maior na prestação #${id}`
        ]);
        creditoGerado = creditoRes.rows[0] || null;
        if (creditoGerado) {
          await this._registrarLog(id, 'GERAR_CREDITO', `Crédito gerado para próxima prestação: R$ ${valorCredito.toFixed(2)}`, client);
        }
      }

      const conclRes = await client.query(`
        UPDATE prestacoes
        SET status = 'CONCLUIDA', concluida_em = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);

      await this._registrarLog(id, 'CONCLUIR_PRESTACAO', 'Prestação concluída e arquivada.', client);
      await client.query('COMMIT');

      return {
        prestacao: conclRes.rows[0],
        credito_gerado: creditoGerado
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reabrir(id) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const prestacao = await this._buscarPrestacaoForUpdate(id, client);
      if (!prestacao) {
        const err = new Error('Prestação não encontrada');
        err.statusCode = 404;
        throw err;
      }
      if (this._statusPrestacao(prestacao) !== 'CONCLUIDA') {
        throw new Error('Prestação não está concluída.');
      }

      const creditoRes = await client.query(`
        SELECT *
        FROM prestacao_creditos_fornecedor
        WHERE prestacao_origem_id = $1
        FOR UPDATE
      `, [id]);

      const credito = creditoRes.rows[0] || null;
      if (credito && credito.status === 'UTILIZADO') {
        throw new Error('Não é possível reabrir: o crédito desta prestação já foi usado em outra prestação.');
      }

      if (credito && credito.status === 'PENDENTE') {
        await client.query(`
          UPDATE prestacao_creditos_fornecedor
          SET status = 'CANCELADO', cancelado_em = NOW()
          WHERE id = $1
        `, [credito.id]);
        await this._registrarLog(id, 'CANCELAR_CREDITO', `Crédito pendente cancelado ao reabrir prestação: R$ ${this._toNumber(credito.valor).toFixed(2)}`, client);
      }

      const result = await client.query(`
        UPDATE prestacoes
        SET status = 'ABERTA', concluida_em = NULL
        WHERE id = $1
        RETURNING *
      `, [id]);

      await this._registrarLog(id, 'REABRIR_PRESTACAO', 'Prestação reaberta.', client);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── ITENS ────────────────────────────────────────────────────

  async criarItem(prestacao_id, data) {
    await this._ensureSchema();
    await this._assertAberta(prestacao_id);

    const { material, peso_kg, preco_por_kg } = data;
    const peso = this._validarNumeroPositivo(peso_kg, 'peso_kg');
    const preco = this._validarNumeroNaoNegativo(preco_por_kg, 'preco_por_kg');
    const total_item = peso * preco;

    const result = await pool.query(`
      INSERT INTO prestacao_itens (prestacao_id, descricao_material, peso_kg, preco_por_kg, total_item)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [prestacao_id, material, peso, preco, total_item]);

    const item = result.rows[0];
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'CRIAR_ITEM', `Item adicionado: ${material}`);
    return item;
  }

  async atualizarItem(prestacao_id, itemId, data) {
    await this._ensureSchema();
    await this._assertAberta(prestacao_id);

    const { material, peso_kg, preco_por_kg } = data;
    const peso = this._validarNumeroPositivo(peso_kg, 'peso_kg');
    const preco = this._validarNumeroNaoNegativo(preco_por_kg, 'preco_por_kg');
    const total_item = peso * preco;

    const result = await pool.query(`
      UPDATE prestacao_itens
      SET descricao_material = $1, peso_kg = $2, preco_por_kg = $3, total_item = $4, movimentado_em = NOW()
      WHERE id = $5 AND prestacao_id = $6
      RETURNING *
    `, [material, peso, preco, total_item, itemId, prestacao_id]);

    const item = result.rows[0] || null;
    if (item) {
      await this._recalcular(prestacao_id);
      await this._registrarLog(prestacao_id, 'ATUALIZAR_ITEM', `Item atualizado: ${material}`);
    }
    return item;
  }

  async deletarItem(prestacao_id, itemId) {
    await this._ensureSchema();
    await this._assertAberta(prestacao_id);

    await pool.query(`DELETE FROM prestacao_itens WHERE id = $1 AND prestacao_id = $2`, [itemId, prestacao_id]);
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'DELETAR_ITEM', `Item removido: id=${itemId}`);
    return true;
  }

  // ─── PAGAMENTOS ───────────────────────────────────────────────

  async criarPagamento(prestacao_id, data) {
    await this._ensureSchema();
    await this._assertAberta(prestacao_id);

    const { data: dataPag, valor, observacao } = data;
    const valorNumber = this._validarNumeroPositivo(valor, 'valor');

    const result = await pool.query(`
      INSERT INTO prestacao_pagamentos (prestacao_id, data_pagamento, valor, observacao)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [prestacao_id, this._parseDate(dataPag), valorNumber, observacao || null]);

    const pagamento = result.rows[0];
    await this._recalcular(prestacao_id);
    await this._registrarLog(prestacao_id, 'CRIAR_PAGAMENTO', `Pagamento registrado: R$ ${valorNumber.toFixed(2)}`);
    return pagamento;
  }

  async deletarPagamento(prestacao_id, pagamentoId) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await this._assertAberta(prestacao_id, client);

      const pagRes = await client.query(`
        SELECT *
        FROM prestacao_pagamentos
        WHERE id = $1 AND prestacao_id = $2
        FOR UPDATE
      `, [pagamentoId, prestacao_id]);
      const pagamento = pagRes.rows[0] || null;

      if (pagamento && pagamento.origem_sistema === 'PEDIDO_LEGADO' && pagamento.origem_pagamento_codigo) {
        const err = new Error('Este pagamento veio da tela de pagamentos de pedidos. Exclua-o naquela tela para manter os dois módulos sincronizados.');
        err.statusCode = 409;
        throw err;
      }

      if (pagamento && pagamento.credito_origem_id) {
        await client.query(`
          UPDATE prestacao_creditos_fornecedor
          SET status = 'PENDENTE',
              prestacao_destino_id = NULL,
              pagamento_destino_id = NULL,
              utilizado_em = NULL
          WHERE id = $1 AND status = 'UTILIZADO'
        `, [pagamento.credito_origem_id]);
        await this._registrarLog(prestacao_id, 'DEVOLVER_CREDITO', `Crédito automático devolvido ao remover pagamento id=${pagamentoId}`, client);
      }

      await client.query(`DELETE FROM prestacao_pagamentos WHERE id = $1 AND prestacao_id = $2`, [pagamentoId, prestacao_id]);
      await this._recalcular(prestacao_id, client);
      await this._registrarLog(prestacao_id, 'DELETAR_PAGAMENTO', `Pagamento removido: id=${pagamentoId}`, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return true;
  }

  async listarVinculosPagamentosPedido(codigos = []) {
    await this._ensureSchema();

    const ids = Array.from(new Set((Array.isArray(codigos) ? codigos : [])
      .map((codigo) => Number(codigo))
      .filter((codigo) => Number.isInteger(codigo) && codigo > 0)));

    if (!ids.length) return [];

    const result = await pool.query(`
      SELECT
        pg.id AS prestacao_pagamento_id,
        pg.prestacao_id,
        pg.origem_pagamento_codigo,
        pg.origem_empresa,
        pg.origem_saida,
        pg.origem_pdv,
        p.titulo AS prestacao_titulo,
        p.status AS prestacao_status,
        f.nome AS fornecedor_nome
      FROM prestacao_pagamentos pg
      INNER JOIN prestacoes p ON p.id = pg.prestacao_id
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE pg.origem_sistema = 'PEDIDO_LEGADO'
        AND pg.origem_pagamento_codigo = ANY($1::bigint[])
    `, [ids]);

    return result.rows;
  }

  async buscarPagamentoVinculadoPedido(codigoPagamento, client = pool) {
    await this._ensureSchema();
    const codigo = Number(codigoPagamento);

    if (!Number.isInteger(codigo) || codigo <= 0) return null;

    const result = await client.query(`
      SELECT
        pg.*,
        p.status AS prestacao_status,
        p.titulo AS prestacao_titulo,
        f.nome AS fornecedor_nome
      FROM prestacao_pagamentos pg
      INNER JOIN prestacoes p ON p.id = pg.prestacao_id
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE pg.origem_sistema = 'PEDIDO_LEGADO'
        AND pg.origem_pagamento_codigo = $1
      LIMIT 1
    `, [codigo]);

    return result.rows[0] || null;
  }

  async criarPagamentoVinculadoPedido(data = {}) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const prestacaoId = Number(data.prestacaoId);
      const codigoPagamento = Number(data.codigoPagamento);

      if (!Number.isInteger(prestacaoId) || prestacaoId <= 0) {
        const err = new Error('Prestação inválida para o vínculo do pagamento.');
        err.statusCode = 400;
        throw err;
      }
      if (!Number.isInteger(codigoPagamento) || codigoPagamento <= 0) {
        const err = new Error('Código do pagamento do pedido inválido.');
        err.statusCode = 400;
        throw err;
      }

      await this._assertAberta(prestacaoId, client);
      const existente = await this.buscarPagamentoVinculadoPedido(codigoPagamento, client);
      if (existente) {
        const err = new Error('Este pagamento já está vinculado a uma prestação.');
        err.statusCode = 409;
        throw err;
      }

      const valor = this._validarNumeroPositivo(data.valor, 'valor');
      const result = await client.query(`
        INSERT INTO prestacao_pagamentos (
          prestacao_id,
          data_pagamento,
          valor,
          observacao,
          origem_sistema,
          origem_pagamento_codigo,
          origem_empresa,
          origem_saida,
          origem_pdv,
          origem_atualizado_em
        )
        VALUES ($1, $2, $3, $4, 'PEDIDO_LEGADO', $5, $6, $7, $8, NOW())
        RETURNING *
      `, [
        prestacaoId,
        this._parseDate(data.data),
        valor,
        data.observacao || null,
        codigoPagamento,
        data.empresa ?? null,
        data.saida ?? null,
        data.pdv ?? null
      ]);

      await this._recalcular(prestacaoId, client);
      await this._registrarLog(
        prestacaoId,
        'CRIAR_PAGAMENTO_PEDIDO',
        `Pagamento do pedido vinculado: código ${codigoPagamento}, valor R$ ${valor.toFixed(2)}`,
        client
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async criarPagamentosVinculadosDistribuicao(prestacaoId, pagamentos = []) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const idPrestacao = Number(prestacaoId);

      if (!Number.isInteger(idPrestacao) || idPrestacao <= 0) {
        const err = new Error('Prestação inválida para o vínculo do pagamento distribuído.');
        err.statusCode = 400;
        throw err;
      }

      if (!Array.isArray(pagamentos) || !pagamentos.length) {
        const err = new Error('Nenhum pagamento distribuído foi informado para vincular à prestação.');
        err.statusCode = 400;
        throw err;
      }

      await this._assertAberta(idPrestacao, client);

      const normalizados = pagamentos.map((item, indice) => {
        const codigoPagamento = Number(item?.codigoPagamento);
        if (!Number.isInteger(codigoPagamento) || codigoPagamento <= 0) {
          const err = new Error(`Código inválido no pagamento distribuído ${indice + 1}.`);
          err.statusCode = 400;
          throw err;
        }

        return {
          codigoPagamento,
          valor: this._validarNumeroPositivo(item?.valor, `valor do pagamento ${indice + 1}`),
          data: this._parseDate(item?.data),
          observacao: item?.observacao || null,
          empresa: item?.empresa ?? null,
          saida: item?.saida ?? null,
          pdv: item?.pdv ?? null
        };
      });

      const codigos = normalizados.map((item) => item.codigoPagamento);
      if (new Set(codigos).size !== codigos.length) {
        const err = new Error('Há código de pagamento repetido na distribuição.');
        err.statusCode = 400;
        throw err;
      }

      const existentes = await client.query(`
        SELECT origem_pagamento_codigo
        FROM prestacao_pagamentos
        WHERE origem_sistema = 'PEDIDO_LEGADO'
          AND origem_pagamento_codigo = ANY($1::bigint[])
      `, [codigos]);

      if (existentes.rows.length) {
        const err = new Error('Um dos pagamentos distribuídos já está vinculado a uma prestação.');
        err.statusCode = 409;
        throw err;
      }

      const criados = [];
      let valorTotal = 0;

      for (const item of normalizados) {
        const result = await client.query(`
          INSERT INTO prestacao_pagamentos (
            prestacao_id,
            data_pagamento,
            valor,
            observacao,
            origem_sistema,
            origem_pagamento_codigo,
            origem_empresa,
            origem_saida,
            origem_pdv,
            origem_atualizado_em
          )
          VALUES ($1, $2, $3, $4, 'PEDIDO_LEGADO', $5, $6, $7, $8, NOW())
          RETURNING *
        `, [
          idPrestacao,
          item.data,
          item.valor,
          item.observacao,
          item.codigoPagamento,
          item.empresa,
          item.saida,
          item.pdv
        ]);

        valorTotal += item.valor;
        criados.push(result.rows[0]);
      }

      await this._recalcular(idPrestacao, client);
      await this._registrarLog(
        idPrestacao,
        'CRIAR_PAGAMENTO_DISTRIBUIDO',
        `Pagamento distribuído vinculado: ${criados.length} lançamento(s), total R$ ${valorTotal.toFixed(2)}`,
        client
      );
      await client.query('COMMIT');
      return criados;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async atualizarPagamentoVinculadoPedido(codigoPagamento, data = {}) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const vinculo = await this.buscarPagamentoVinculadoPedido(codigoPagamento, client);
      if (!vinculo) {
        const err = new Error('Vínculo do pagamento com a prestação não encontrado.');
        err.statusCode = 404;
        throw err;
      }

      await this._assertAberta(vinculo.prestacao_id, client);
      const valor = this._validarNumeroPositivo(data.valor, 'valor');
      const result = await client.query(`
        UPDATE prestacao_pagamentos
        SET data_pagamento = $1,
            valor = $2,
            observacao = $3,
            origem_empresa = $4,
            origem_saida = $5,
            origem_pdv = $6,
            origem_atualizado_em = NOW()
        WHERE id = $7
        RETURNING *
      `, [
        this._parseDate(data.data),
        valor,
        data.observacao || null,
        data.empresa ?? vinculo.origem_empresa,
        data.saida ?? vinculo.origem_saida,
        data.pdv ?? vinculo.origem_pdv,
        vinculo.id
      ]);

      await this._recalcular(vinculo.prestacao_id, client);
      await this._registrarLog(
        vinculo.prestacao_id,
        'ATUALIZAR_PAGAMENTO_PEDIDO',
        `Pagamento do pedido atualizado: código ${codigoPagamento}, valor R$ ${valor.toFixed(2)}`,
        client
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deletarPagamentoVinculadoPedido(codigoPagamento) {
    await this._ensureSchema();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const vinculo = await this.buscarPagamentoVinculadoPedido(codigoPagamento, client);
      if (!vinculo) {
        await client.query('COMMIT');
        return null;
      }

      await this._assertAberta(vinculo.prestacao_id, client);
      await client.query(`DELETE FROM prestacao_pagamentos WHERE id = $1`, [vinculo.id]);
      await this._recalcular(vinculo.prestacao_id, client);
      await this._registrarLog(
        vinculo.prestacao_id,
        'DELETAR_PAGAMENTO_PEDIDO',
        `Pagamento do pedido removido: código ${codigoPagamento}`,
        client
      );
      await client.query('COMMIT');
      return vinculo;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async atualizarOrigemPagamentoVinculado(codigoPagamentoAtual, data = {}) {
    await this._ensureSchema();
    const codigoAtual = Number(codigoPagamentoAtual);
    const novoCodigo = Number(data.novoCodigoPagamento);

    if (!Number.isInteger(codigoAtual) || codigoAtual <= 0 || !Number.isInteger(novoCodigo) || novoCodigo <= 0) {
      const err = new Error('Código inválido ao restaurar o vínculo do pagamento.');
      err.statusCode = 400;
      throw err;
    }

    const result = await pool.query(`
      UPDATE prestacao_pagamentos
      SET origem_pagamento_codigo = $1,
          origem_empresa = $2,
          origem_saida = $3,
          origem_pdv = $4,
          origem_atualizado_em = NOW()
      WHERE origem_sistema = 'PEDIDO_LEGADO'
        AND origem_pagamento_codigo = $5
      RETURNING *
    `, [
      novoCodigo,
      data.empresa ?? null,
      data.saida ?? null,
      data.pdv ?? null,
      codigoAtual
    ]);

    return result.rows[0] || null;
  }


  async sincronizarParticaoPagamentosPedido({ pagamentos = {}, pedidoOriginal = {}, pedidoNovo = {} } = {}) {
    await this._ensureSchema();

    const movidos = Array.isArray(pagamentos?.movidos) ? pagamentos.movidos : [];
    const divididos = Array.isArray(pagamentos?.divididos) ? pagamentos.divididos : [];

    if (!movidos.length && !divididos.length) {
      return { atualizados: 0, divididos: 0, prestacoesRecalculadas: 0 };
    }

    const client = await pool.connect();
    const prestacoesAfetadas = new Set();
    let atualizados = 0;
    let quantidadeDivididos = 0;

    try {
      await client.query('BEGIN');

      for (const movimento of movidos) {
        const codigo = Number(movimento?.codigo);
        if (!Number.isInteger(codigo) || codigo <= 0) continue;

        const result = await client.query(
          `
            UPDATE prestacao_pagamentos
               SET origem_empresa = $1,
                   origem_saida = $2,
                   origem_pdv = $3,
                   origem_atualizado_em = NOW()
             WHERE origem_sistema = 'PEDIDO_LEGADO'
               AND origem_pagamento_codigo = $4
            RETURNING prestacao_id
          `,
          [
            pedidoNovo?.empresa ?? null,
            pedidoNovo?.saida ?? pedidoNovo?.idMestre ?? null,
            pedidoNovo?.pdv ?? null,
            codigo
          ]
        );

        result.rows.forEach((row) => prestacoesAfetadas.add(Number(row.prestacao_id)));
        atualizados += result.rowCount || 0;
      }

      for (const divisao of divididos) {
        const codigoOriginal = Number(divisao?.codigoOriginal);
        const codigoNovo = Number(divisao?.codigoNovo);
        const valorOriginal = Number(divisao?.valorOriginal);
        const valorNovo = Number(divisao?.valorNovo);
        const observacaoOriginal = String(divisao?.observacaoOriginal || '').trim();
        const observacaoNovo = String(divisao?.observacaoNovo || '').trim();

        if (
          !Number.isInteger(codigoOriginal) || codigoOriginal <= 0
          || !Number.isInteger(codigoNovo) || codigoNovo <= 0
          || !Number.isFinite(valorOriginal) || valorOriginal <= 0
          || !Number.isFinite(valorNovo) || valorNovo <= 0
        ) {
          continue;
        }

        const atualResult = await client.query(
          `
            SELECT *
            FROM prestacao_pagamentos
            WHERE origem_sistema = 'PEDIDO_LEGADO'
              AND origem_pagamento_codigo = $1
            FOR UPDATE
          `,
          [codigoOriginal]
        );

        const atual = atualResult.rows[0];
        if (!atual) continue;

        await client.query(
          `
            UPDATE prestacao_pagamentos
               SET valor = $1,
                   observacao = $2,
                   origem_empresa = $3,
                   origem_saida = $4,
                   origem_pdv = $5,
                   origem_atualizado_em = NOW()
             WHERE id = $6
          `,
          [
            valorOriginal,
            observacaoOriginal || atual.observacao,
            pedidoOriginal?.empresa ?? atual.origem_empresa,
            pedidoOriginal?.saida ?? pedidoOriginal?.idMestre ?? atual.origem_saida,
            pedidoOriginal?.pdv ?? atual.origem_pdv,
            atual.id
          ]
        );

        await client.query(
          `
            INSERT INTO prestacao_pagamentos (
              prestacao_id,
              data_pagamento,
              valor,
              observacao,
              credito_origem_id,
              origem_sistema,
              origem_pagamento_codigo,
              origem_empresa,
              origem_saida,
              origem_pdv,
              origem_atualizado_em
            ) VALUES ($1, $2, $3, $4, $5, 'PEDIDO_LEGADO', $6, $7, $8, $9, NOW())
          `,
          [
            atual.prestacao_id,
            atual.data_pagamento,
            valorNovo,
            observacaoNovo || atual.observacao,
            atual.credito_origem_id,
            codigoNovo,
            pedidoNovo?.empresa ?? null,
            pedidoNovo?.saida ?? pedidoNovo?.idMestre ?? null,
            pedidoNovo?.pdv ?? null
          ]
        );

        prestacoesAfetadas.add(Number(atual.prestacao_id));
        quantidadeDivididos += 1;
      }

      for (const prestacaoId of prestacoesAfetadas) {
        if (Number.isInteger(prestacaoId) && prestacaoId > 0) {
          await this._recalcular(prestacaoId, client);
        }
      }

      await client.query('COMMIT');
      return {
        atualizados,
        divididos: quantidadeDivididos,
        prestacoesRecalculadas: prestacoesAfetadas.size
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ─── WHATSAPP ─────────────────────────────────────────────────

  async enviarResumoWhatsapp(prestacao_id) {
    await this._ensureSchema();
    await this._recalcular(prestacao_id);

    const cabecalhoRes = await pool.query(`
      SELECT
        p.*,
        f.nome AS fornecedor_nome,
        f.telefone AS fornecedor_telefone
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.id = $1
    `, [prestacao_id]);

    const cabecalho = cabecalhoRes.rows[0] || null;
    if (!cabecalho) {
      const err = new Error('Prestação não encontrada');
      err.statusCode = 404;
      throw err;
    }

    if (this._statusPrestacao(cabecalho) !== 'ABERTA') {
      const err = new Error('O resumo do WhatsApp só pode ser enviado para uma prestação aberta.');
      err.statusCode = 400;
      throw err;
    }

    if (!String(cabecalho.fornecedor_telefone || '').trim()) {
      const err = new Error('O fornecedor desta prestação não possui telefone cadastrado.');
      err.statusCode = 400;
      throw err;
    }

    const pagamentosRes = await pool.query(`
      SELECT *
      FROM prestacao_pagamentos
      WHERE prestacao_id = $1
      ORDER BY data_pagamento DESC, id DESC
      LIMIT 5
    `, [prestacao_id]);

    const pagamentos = pagamentosRes.rows.reverse();
    const mensagem = this._montarMensagemResumoWhatsapp(cabecalho, pagamentos);
    const envio = await envioWhatsappService.enviarMensagem({
      telefone: cabecalho.fornecedor_telefone,
      mensagem
    });

    await this._registrarLog(
      prestacao_id,
      'ENVIAR_WHATSAPP_RESUMO',
      `Resumo enviado ao fornecedor com ${pagamentos.length} pagamento(s).`
    );

    return {
      fornecedor: cabecalho.fornecedor_nome,
      telefone: envio.telefone,
      quantidade_pagamentos: pagamentos.length,
      mensagem
    };
  }

  async enviarPdfWhatsapp(prestacao_id) {
    await this._ensureSchema();
    await this._recalcular(prestacao_id);

    const cabecalhoRes = await pool.query(`
      SELECT
        p.*,
        f.nome AS fornecedor_nome,
        f.telefone AS fornecedor_telefone
      FROM prestacoes p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.id = $1
    `, [prestacao_id]);

    const cabecalho = cabecalhoRes.rows[0] || null;
    if (!cabecalho) {
      const err = new Error('Prestação não encontrada');
      err.statusCode = 404;
      throw err;
    }

    if (this._statusPrestacao(cabecalho) !== 'ABERTA') {
      const err = new Error('O PDF do WhatsApp só pode ser enviado para uma prestação aberta.');
      err.statusCode = 400;
      throw err;
    }

    if (!String(cabecalho.fornecedor_telefone || '').trim()) {
      const err = new Error('O fornecedor desta prestação não possui telefone cadastrado.');
      err.statusCode = 400;
      throw err;
    }

    const resumo = await this.gerarResumoPrestacao(prestacao_id);
    resumo.cabecalho = {
      ...resumo.cabecalho,
      fornecedor_telefone: cabecalho.fornecedor_telefone
    };

    const pdfBuffer = prestacaoPdfService.gerarPdfPrestacao(resumo);
    const nomeArquivo = this._montarNomeArquivoPdf(cabecalho);
    const legenda = `Prestação ${cabecalho.titulo || `#${cabecalho.id}`} - ${cabecalho.fornecedor_nome || 'Fornecedor'}`;

    const envio = await envioWhatsappService.enviarDocumentoPdf({
      telefone: cabecalho.fornecedor_telefone,
      documentoBase64: pdfBuffer.toString('base64'),
      nomeArquivo,
      legenda
    });

    await this._registrarLog(
      prestacao_id,
      'ENVIAR_WHATSAPP_PDF',
      `PDF da prestação enviado ao fornecedor: ${nomeArquivo}`
    );

    return {
      fornecedor: cabecalho.fornecedor_nome,
      telefone: envio.telefone,
      nome_arquivo: nomeArquivo
    };
  }

  // ─── RESUMO ───────────────────────────────────────────────────

  async gerarResumoPrestacao(prestacao_id) {
    await this._ensureSchema();

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
      SELECT * FROM prestacao_pagamentos WHERE prestacao_id = $1 ORDER BY data_pagamento ASC, id ASC
    `, [prestacao_id]);

    const creditosOrigemRes = await pool.query(`
      SELECT *
      FROM prestacao_creditos_fornecedor
      WHERE prestacao_origem_id = $1
      ORDER BY id ASC
    `, [prestacao_id]);

    const creditosDestinoRes = await pool.query(`
      SELECT *
      FROM prestacao_creditos_fornecedor
      WHERE prestacao_destino_id = $1
      ORDER BY id ASC
    `, [prestacao_id]);

    const total_material = parseFloat(cabecalho ? cabecalho.total_material : 0);
    const total_pago = parseFloat(cabecalho ? cabecalho.total_pago : 0);
    const saldo_restante = parseFloat(cabecalho ? cabecalho.saldo_restante : 0);
    const peso_total = materiaisRes.rows.reduce((acc, i) => acc + parseFloat(i.peso_kg || 0), 0);

    return {
      cabecalho,
      materiais: materiaisRes.rows,
      pagamentos: pagamentosRes.rows,
      creditos_origem: creditosOrigemRes.rows,
      creditos_destino: creditosDestinoRes.rows,
      totais: {
        peso_total,
        total_material,
        total_pago,
        saldo_restante
      }
    };
  }

  // ─── HELPERS PRIVADOS ─────────────────────────────────────────

  async _ensureSchema() {
    if (!this._schemaReady) {
      this._schemaReady = this._runEnsureSchema().catch((error) => {
        this._schemaReady = null;
        throw error;
      });
    }
    return this._schemaReady;
  }

  async _runEnsureSchema() {
    await pool.query(`ALTER TABLE prestacoes ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ABERTA'`);
    await pool.query(`UPDATE prestacoes SET status = 'ABERTA' WHERE status IS NULL OR TRIM(status) = ''`);
    await pool.query(`ALTER TABLE prestacoes ALTER COLUMN status SET DEFAULT 'ABERTA'`);
    await pool.query(`ALTER TABLE prestacoes ADD COLUMN IF NOT EXISTS concluida_em TIMESTAMP NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS credito_origem_id INTEGER NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS origem_sistema VARCHAR(30) NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS origem_pagamento_codigo BIGINT NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS origem_empresa INTEGER NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS origem_saida BIGINT NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS origem_pdv INTEGER NULL`);
    await pool.query(`ALTER TABLE prestacao_pagamentos ADD COLUMN IF NOT EXISTS origem_atualizado_em TIMESTAMP NULL`);
    await pool.query(`ALTER TABLE prestacao_itens ADD COLUMN IF NOT EXISTS movimentado_em TIMESTAMP NULL`);
    await pool.query(`
      UPDATE prestacao_itens i
      SET movimentado_em = COALESCE(p.data_referencia::timestamp, NOW())
      FROM prestacoes p
      WHERE p.id = i.prestacao_id
        AND i.movimentado_em IS NULL
    `);
    await pool.query(`ALTER TABLE prestacao_itens ALTER COLUMN movimentado_em SET DEFAULT NOW()`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS prestacao_creditos_fornecedor (
        id SERIAL PRIMARY KEY,
        fornecedor_id INTEGER NOT NULL,
        prestacao_origem_id INTEGER NOT NULL UNIQUE,
        prestacao_destino_id INTEGER NULL,
        pagamento_destino_id INTEGER NULL,
        valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        utilizado_em TIMESTAMP NULL,
        cancelado_em TIMESTAMP NULL,
        observacao TEXT NULL
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prestacoes_status ON prestacoes(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prestacao_creditos_fornecedor_status ON prestacao_creditos_fornecedor(fornecedor_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prestacao_pagamentos_credito_origem ON prestacao_pagamentos(credito_origem_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prestacao_pagamentos_origem_pedido ON prestacao_pagamentos(origem_sistema, origem_pagamento_codigo)`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_prestacao_pagamentos_origem_pedido
      ON prestacao_pagamentos(origem_pagamento_codigo)
      WHERE origem_sistema = 'PEDIDO_LEGADO' AND origem_pagamento_codigo IS NOT NULL
    `);
  }

  async _aplicarCreditosPendentes(prestacao, client = pool) {
    const creditosRes = await client.query(`
      SELECT *
      FROM prestacao_creditos_fornecedor
      WHERE fornecedor_id = $1 AND status = 'PENDENTE'
      ORDER BY criado_em ASC, id ASC
      FOR UPDATE
    `, [prestacao.fornecedor_id]);

    const aplicados = [];
    for (const credito of creditosRes.rows) {
      const valor = this._toNumber(credito.valor);
      const obs = `Crédito transferido da prestação #${credito.prestacao_origem_id}`;
      const pagRes = await client.query(`
        INSERT INTO prestacao_pagamentos
          (prestacao_id, data_pagamento, valor, observacao, credito_origem_id)
        VALUES
          ($1, CURRENT_DATE, $2, $3, $4)
        RETURNING *
      `, [prestacao.id, valor, obs, credito.id]);
      const pagamento = pagRes.rows[0];

      await client.query(`
        UPDATE prestacao_creditos_fornecedor
        SET status = 'UTILIZADO',
            prestacao_destino_id = $1,
            pagamento_destino_id = $2,
            utilizado_em = NOW()
        WHERE id = $3
      `, [prestacao.id, pagamento.id, credito.id]);

      await this._registrarLog(prestacao.id, 'APLICAR_CREDITO', `${obs}: R$ ${valor.toFixed(2)}`, client);
      aplicados.push({ ...credito, pagamento_destino_id: pagamento.id });
    }

    return aplicados;
  }

  async _devolverCreditosConsumidosPelaPrestacao(prestacao_id, client = pool) {
    await client.query(`
      UPDATE prestacao_creditos_fornecedor c
      SET status = 'PENDENTE',
          prestacao_destino_id = NULL,
          pagamento_destino_id = NULL,
          utilizado_em = NULL
      FROM prestacao_pagamentos p
      WHERE p.prestacao_id = $1
        AND p.credito_origem_id = c.id
        AND c.status = 'UTILIZADO'
    `, [prestacao_id]);
  }

  async _recalcular(prestacao_id, client = pool) {
    const itensRes = await client.query(`
      SELECT COALESCE(SUM(total_item), 0) AS total_material
      FROM prestacao_itens
      WHERE prestacao_id = $1
    `, [prestacao_id]);
    const total_material = parseFloat(itensRes.rows[0].total_material);

    const pagRes = await client.query(`
      SELECT COALESCE(SUM(valor), 0) AS total_pago
      FROM prestacao_pagamentos
      WHERE prestacao_id = $1
    `, [prestacao_id]);
    const total_pago = parseFloat(pagRes.rows[0].total_pago);

    const saldo_restante = total_material - total_pago;

    await client.query(`
      UPDATE prestacoes
      SET total_material = $1, total_pago = $2, saldo_restante = $3
      WHERE id = $4
    `, [total_material, total_pago, saldo_restante, prestacao_id]);
  }

  async _registrarLog(prestacao_id, tipo, descricao, client = pool) {
    await client.query(`
      INSERT INTO prestacao_logs (prestacao_id, tipo, descricao)
      VALUES ($1, $2, $3)
    `, [prestacao_id, tipo, descricao]);
  }

  async _buscarPrestacaoForUpdate(id, client = pool) {
    const result = await client.query(`
      SELECT *
      FROM prestacoes
      WHERE id = $1
      FOR UPDATE
    `, [id]);
    return result.rows[0] || null;
  }

  async _assertAberta(id, client = pool) {
    const prestacao = await this._buscarPrestacaoForUpdate(id, client);
    if (!prestacao) {
      const err = new Error('Prestação não encontrada');
      err.statusCode = 404;
      throw err;
    }
    if (this._statusPrestacao(prestacao) !== 'ABERTA') {
      throw new Error('Prestação concluída. Reabra antes de alterar.');
    }
    return prestacao;
  }

  _statusPrestacao(prestacao) {
    const s = String((prestacao && prestacao.status) || 'ABERTA').trim().toUpperCase();
    return ['CONCLUIDA', 'CONCLUÍDA'].includes(s) ? 'CONCLUIDA' : 'ABERTA';
  }

  _normalizarStatusFiltro(status) {
    const s = String(status || 'ABERTA').trim().toUpperCase();
    if (s === 'TODAS') return 'TODAS';
    if (['CONCLUIDA', 'CONCLUÍDA'].includes(s)) return 'CONCLUIDA';
    return 'ABERTA';
  }

  _statusSql(columnExpression) {
    return `CASE WHEN UPPER(TRIM(COALESCE(${columnExpression}::text, ''))) IN ('CONCLUIDA', 'CONCLUÍDA') THEN 'CONCLUIDA' ELSE 'ABERTA' END`;
  }

  _validarNumeroPositivo(value, campo) {
    const n = this._toNumber(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${campo} deve ser maior que zero.`);
    }
    return n;
  }

  _validarNumeroNaoNegativo(value, campo) {
    const n = this._toNumber(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${campo} não pode ser negativo.`);
    }
    return n;
  }

  _montarMensagemResumoWhatsapp(cabecalho, pagamentos) {
    const linhas = [
      '*RESUMO DA PRESTAÇÃO - ALUMÍNIO JR*',
      `Fornecedor: ${String(cabecalho.fornecedor_nome || 'Não informado').trim()}`,
      `Prestação: ${String(cabecalho.titulo || `#${cabecalho.id}`).trim()}`,
      `Data de referência: ${this._formatarDataBr(cabecalho.data_referencia)}`,
      '',
      `Valor da compra: *${this._formatarMoedaBr(cabecalho.total_material)}*`,
      '',
      '*Últimos pagamentos (até 5):*'
    ];

    if (!pagamentos.length) {
      linhas.push('Nenhum pagamento registrado.');
    } else {
      pagamentos.forEach((pagamento, index) => {
        const observacao = String(pagamento.observacao || '').trim();
        const detalheObservacao = observacao ? ` - ${observacao}` : '';

        if (index > 0) linhas.push('');
        linhas.push(
          `${index + 1}. ${this._formatarDataBr(pagamento.data_pagamento)} - *${this._formatarMoedaBr(pagamento.valor)}*${detalheObservacao}`
        );
      });
    }

    linhas.push(
      '',
      `Total já pago: *${this._formatarMoedaBr(cabecalho.total_pago)}*`,
      `Saldo restante: *${this._formatarMoedaBr(cabecalho.saldo_restante)}*`
    );
    return linhas.join('\n');
  }

  _montarNomeArquivoPdf(cabecalho) {
    const partes = [cabecalho.id, cabecalho.fornecedor_nome, cabecalho.titulo]
      .filter(Boolean)
      .map((valor) => String(valor)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, ''))
      .filter(Boolean);

    const base = partes.join('_').slice(0, 100) || String(cabecalho.id || 'prestacao');
    return `Prestacao_${base}.pdf`;
  }

  _formatarMoedaBr(value) {
    const numero = this._toNumber(value).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `R$ ${numero}`;
  }

  _formatarDataBr(value) {
    if (!value) return 'Não informada';

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const dia = String(value.getUTCDate()).padStart(2, '0');
      const mes = String(value.getUTCMonth() + 1).padStart(2, '0');
      const ano = value.getUTCFullYear();
      return `${dia}/${mes}/${ano}`;
    }

    const texto = String(value).substring(0, 10);
    const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : texto;
  }

  _toNumber(value) {
    if (typeof value === 'string') {
      return Number(value.replace(',', '.'));
    }
    return Number(value || 0);
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
