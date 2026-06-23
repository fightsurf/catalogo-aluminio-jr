const pool = require('../../../../db/connection');
const legadoBridgeService = require('../legadoBridge.service');

const TIPOS = {
  BAIXA_PARA_CREDITO: 'BAIXA_PARA_CREDITO',
  PAGAMENTO_CLIENTE: 'PAGAMENTO_CLIENTE',
  AJUSTE_DEBITO: 'AJUSTE_DEBITO',
  AJUSTE_CREDITO: 'AJUSTE_CREDITO',
  ESTORNO: 'ESTORNO'
};

class ClientesCreditosService {
  constructor() {
    this._schemaReady = null;
  }

  async _ensureSchema() {
    if (this._schemaReady) {
      return this._schemaReady;
    }

    this._schemaReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cliente_credito_lancamentos (
          id BIGSERIAL PRIMARY KEY,
          favorecido INTEGER NOT NULL,
          cliente_nome_snapshot VARCHAR(200),
          data_lancamento DATE NOT NULL DEFAULT CURRENT_DATE,
          tipo VARCHAR(40) NOT NULL CHECK (tipo IN ('BAIXA_PARA_CREDITO', 'PAGAMENTO_CLIENTE', 'AJUSTE_DEBITO', 'AJUSTE_CREDITO', 'ESTORNO')),
          descricao TEXT,
          numero_pedido VARCHAR(50),
          origem_tipo VARCHAR(60),
          origem_empresa INTEGER,
          origem_saida BIGINT,
          origem_pdv INTEGER,
          origem_id VARCHAR(80),
          valor_debito NUMERIC(14,2) NOT NULL DEFAULT 0,
          valor_credito NUMERIC(14,2) NOT NULL DEFAULT 0,
          observacao TEXT,
          cancelado_em TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);

      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_credito_baixa_pedido
        ON cliente_credito_lancamentos (origem_empresa, origem_saida, origem_pdv)
        WHERE tipo = 'BAIXA_PARA_CREDITO' AND cancelado_em IS NULL
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_cliente_credito_favorecido
        ON cliente_credito_lancamentos (favorecido, data_lancamento, id)
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_cliente_credito_origem_pedido
        ON cliente_credito_lancamentos (origem_empresa, origem_saida, origem_pdv)
      `);
    })();

    return this._schemaReady;
  }

  _erro(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  _texto(valor) {
    return String(valor ?? '').trim();
  }

  _inteiro(valor, campo, { positivo = false } = {}) {
    const numero = Number(valor);
    if (!Number.isInteger(numero) || (positivo && numero <= 0)) {
      throw this._erro(`Campo inválido: ${campo}`);
    }
    return numero;
  }

  _valor(valor, campo = 'valor') {
    const texto = this._texto(valor).replace(/\./g, '').replace(',', '.');
    const numero = Number(texto || valor);
    if (!Number.isFinite(numero) || numero <= 0) {
      throw this._erro(`Informe um ${campo} válido.`);
    }
    return Number(numero.toFixed(2));
  }

  _dataISO(valor, campo = 'data') {
    const texto = this._texto(valor);
    if (!texto) {
      return new Date().toISOString().slice(0, 10);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
      throw this._erro(`Campo inválido: ${campo}`);
    }
    return texto;
  }

  _chavePedido(item = {}) {
    const empresa = item.empresa ?? item.origem_empresa ?? -1;
    const saida = item.saida ?? item.origem_saida;
    const pdv = item.pdv ?? item.origem_pdv ?? 0;
    return `${empresa}|${saida}|${pdv}`;
  }

  _mapLancamento(row) {
    const debito = Number(row.valor_debito || 0);
    const credito = Number(row.valor_credito || 0);
    return {
      ...row,
      valor_debito: debito,
      valor_credito: credito,
      valorDebito: debito,
      valorCredito: credito,
      valor: debito > 0 ? debito : credito
    };
  }

  _aplicarBaixaNoResumo(detalhe, baixa) {
    if (!detalhe || !baixa) {
      return detalhe;
    }

    const resumo = detalhe.resumo || {};
    const saldoReal = Number(resumo.saldoRestante || 0);
    const valorBaixado = Number(baixa.valor_debito || 0);

    return {
      ...detalhe,
      pedido: {
        ...(detalhe.pedido || {}),
        baixadoParaCredito: true,
        valorBaixadoParaCredito: valorBaixado,
        statusFinanceiro: 'BAIXA_PARA_CREDITO',
        statusFinanceiroLabel: 'Baixa para crédito'
      },
      resumo: {
        ...resumo,
        saldoRestanteReal: saldoReal,
        saldoRestante: 0,
        baixadoParaCredito: true,
        baixaCreditoId: baixa.id,
        valorBaixadoParaCredito: valorBaixado,
        statusFinanceiro: 'BAIXA_PARA_CREDITO',
        statusFinanceiroLabel: 'Baixa para crédito'
      }
    };
  }

  async buscarBaixaPedido({ empresa = -1, saida, pdv = 0 }, client = pool) {
    await this._ensureSchema();
    if (saida === undefined || saida === null || saida === '') {
      return null;
    }

    const result = await client.query(
      `
        SELECT *
        FROM cliente_credito_lancamentos
        WHERE tipo = 'BAIXA_PARA_CREDITO'
          AND cancelado_em IS NULL
          AND origem_empresa = $1
          AND origem_saida = $2
          AND origem_pdv = $3
        ORDER BY id DESC
        LIMIT 1
      `,
      [Number(empresa ?? -1), Number(saida), Number(pdv ?? 0)]
    );

    return result.rows[0] ? this._mapLancamento(result.rows[0]) : null;
  }

  async buscarBaixasPedidos(pedidos = []) {
    await this._ensureSchema();
    const itens = (Array.isArray(pedidos) ? pedidos : [])
      .filter((pedido) => pedido?.saida !== undefined && pedido?.saida !== null && pedido?.saida !== '')
      .map((pedido) => ({
        empresa: Number(pedido.empresa ?? -1),
        saida: Number(pedido.saida),
        pdv: Number(pedido.pdv ?? 0)
      }));

    if (!itens.length) {
      return new Map();
    }

    const result = await pool.query(
      `
        SELECT *
        FROM cliente_credito_lancamentos
        WHERE tipo = 'BAIXA_PARA_CREDITO'
          AND cancelado_em IS NULL
          AND (origem_empresa, origem_saida, origem_pdv) IN (
            SELECT * FROM UNNEST($1::int[], $2::bigint[], $3::int[])
          )
        ORDER BY id DESC
      `,
      [itens.map((i) => i.empresa), itens.map((i) => i.saida), itens.map((i) => i.pdv)]
    );

    const mapa = new Map();
    result.rows.forEach((row) => {
      const lancamento = this._mapLancamento(row);
      const chave = this._chavePedido({
        empresa: lancamento.origem_empresa,
        saida: lancamento.origem_saida,
        pdv: lancamento.origem_pdv
      });
      if (!mapa.has(chave)) {
        mapa.set(chave, lancamento);
      }
    });

    return mapa;
  }

  async aplicarBaixaEmDetalhe(detalhe) {
    if (!detalhe?.pedido?.saida) {
      return detalhe;
    }
    const baixa = await this.buscarBaixaPedido({
      empresa: detalhe.pedido.empresa ?? -1,
      saida: detalhe.pedido.saida,
      pdv: detalhe.pedido.pdv ?? 0
    });
    return this._aplicarBaixaNoResumo(detalhe, baixa);
  }

  async aplicarBaixasEmPedidos(pedidos = []) {
    const lista = Array.isArray(pedidos) ? pedidos : [];
    if (!lista.length) {
      return [];
    }

    const mapa = await this.buscarBaixasPedidos(lista);
    return lista.map((pedido) => {
      const baixa = mapa.get(this._chavePedido(pedido));
      if (!baixa) {
        return pedido;
      }
      const saldoReal = Number(pedido.saldoRestante || 0);
      const valorBaixado = Number(baixa.valor_debito || 0);
      return {
        ...pedido,
        saldoRestanteReal: saldoReal,
        saldoRestante: 0,
        baixadoParaCredito: true,
        baixaCreditoId: baixa.id,
        valorBaixadoParaCredito: valorBaixado,
        statusFinanceiro: 'BAIXA_PARA_CREDITO',
        statusFinanceiroLabel: 'Baixa para crédito'
      };
    });
  }

  async criarBaixaParaCredito({ detalhePedido, valor, observacao }) {
    await this._ensureSchema();

    const pedido = detalhePedido?.pedido;
    if (!pedido?.saida) {
      throw this._erro('Pedido inválido para baixa para crédito.');
    }

    const valorBaixa = this._valor(valor, 'valor da baixa');
    const favorecido = this._inteiro(pedido.favorecido ?? pedido.cliente?.favorecido, 'favorecido', { positivo: true });
    const clienteNome = this._texto(pedido.cliente?.nome).slice(0, 200) || null;
    const numeroPedido = this._texto(pedido.numero).slice(0, 50) || null;
    const empresa = this._inteiro(pedido.empresa ?? -1, 'empresa');
    const saida = this._inteiro(pedido.saida, 'saida', { positivo: true });
    const pdv = this._inteiro(pedido.pdv ?? 0, 'pdv');

    const result = await pool.query(
      `
        INSERT INTO cliente_credito_lancamentos (
          favorecido,
          cliente_nome_snapshot,
          data_lancamento,
          tipo,
          descricao,
          numero_pedido,
          origem_tipo,
          origem_empresa,
          origem_saida,
          origem_pdv,
          valor_debito,
          valor_credito,
          observacao
        ) VALUES ($1, $2, CURRENT_DATE, 'BAIXA_PARA_CREDITO', $3, $4, 'PEDIDO', $5, $6, $7, $8, 0, $9)
        ON CONFLICT DO NOTHING
        RETURNING *
      `,
      [
        favorecido,
        clienteNome,
        `Baixa para crédito do pedido ${numeroPedido || saida}`,
        numeroPedido,
        empresa,
        saida,
        pdv,
        valorBaixa,
        this._texto(observacao) || null
      ]
    );

    if (result.rows[0]) {
      return this._mapLancamento(result.rows[0]);
    }

    const existente = await this.buscarBaixaPedido({ empresa, saida, pdv });
    if (existente) {
      return existente;
    }

    throw this._erro('Não foi possível registrar a baixa para crédito.');
  }

  async listarClientes() {
    await this._ensureSchema();
    const result = await pool.query(`
      SELECT
        favorecido,
        COALESCE(MAX(cliente_nome_snapshot), 'Cliente ' || favorecido::text) AS cliente_nome,
        COALESCE(SUM(valor_debito) FILTER (WHERE cancelado_em IS NULL), 0) AS total_debito,
        COALESCE(SUM(valor_credito) FILTER (WHERE cancelado_em IS NULL), 0) AS total_credito,
        COALESCE(SUM(valor_debito - valor_credito) FILTER (WHERE cancelado_em IS NULL), 0) AS saldo,
        MAX(data_lancamento) AS ultima_movimentacao
      FROM cliente_credito_lancamentos
      GROUP BY favorecido
      ORDER BY cliente_nome
    `);

    return result.rows.map((row) => {
      const saldo = Number(row.saldo || 0);
      return {
        favorecido: row.favorecido,
        clienteNome: row.cliente_nome,
        cliente_nome: row.cliente_nome,
        totalDebito: Number(row.total_debito || 0),
        totalCredito: Number(row.total_credito || 0),
        saldo,
        situacao: saldo > 0.004 ? 'DEVEDOR' : saldo < -0.004 ? 'COM_CREDITO' : 'ZERADO',
        ultimaMovimentacao: row.ultima_movimentacao
      };
    });
  }

  async buscarExtrato(favorecido) {
    await this._ensureSchema();
    const favorecidoId = this._inteiro(favorecido, 'favorecido', { positivo: true });
    const result = await pool.query(
      `
        SELECT *
        FROM cliente_credito_lancamentos
        WHERE favorecido = $1
          AND cancelado_em IS NULL
        ORDER BY data_lancamento ASC, id ASC
      `,
      [favorecidoId]
    );

    let saldo = 0;
    const lancamentos = result.rows.map((row) => {
      const lancamento = this._mapLancamento(row);
      saldo = Number((saldo + lancamento.valor_debito - lancamento.valor_credito).toFixed(2));
      return {
        ...lancamento,
        saldo
      };
    });

    const totalDebito = lancamentos.reduce((acc, item) => acc + item.valor_debito, 0);
    const totalCredito = lancamentos.reduce((acc, item) => acc + item.valor_credito, 0);
    const clienteNome = lancamentos[lancamentos.length - 1]?.cliente_nome_snapshot || `Cliente ${favorecidoId}`;

    return {
      favorecido: favorecidoId,
      clienteNome,
      cliente_nome: clienteNome,
      lancamentos,
      resumo: {
        totalDebito: Number(totalDebito.toFixed(2)),
        totalCredito: Number(totalCredito.toFixed(2)),
        saldo: Number(saldo.toFixed(2)),
        situacao: saldo > 0.004 ? 'DEVEDOR' : saldo < -0.004 ? 'COM_CREDITO' : 'ZERADO'
      }
    };
  }

  async _buscarNomeClienteSnapshot(favorecidoId) {
    await this._ensureSchema();
    const result = await pool.query(
      `
        SELECT cliente_nome_snapshot
        FROM cliente_credito_lancamentos
        WHERE favorecido = $1
          AND cliente_nome_snapshot IS NOT NULL
          AND TRIM(cliente_nome_snapshot) <> ''
        ORDER BY id DESC
        LIMIT 1
      `,
      [favorecidoId]
    );

    return this._texto(result.rows[0]?.cliente_nome_snapshot).slice(0, 200) || null;
  }

  async registrarAjusteCliente(favorecido, data = {}) {
    await this._ensureSchema();
    const favorecidoId = this._inteiro(favorecido, 'favorecido', { positivo: true });
    const valor = this._valor(data.valor);
    const natureza = this._texto(data.natureza || data.tipo).toUpperCase();

    if (!['DEBITO', 'CREDITO'].includes(natureza)) {
      throw this._erro('Natureza do ajuste inválida.');
    }

    const tipo = natureza === 'DEBITO' ? TIPOS.AJUSTE_DEBITO : TIPOS.AJUSTE_CREDITO;
    const descricaoPadrao = natureza === 'DEBITO' ? 'Ajuste de débito no crédito do cliente' : 'Ajuste de crédito no crédito do cliente';
    const descricao = this._texto(data.descricao).slice(0, 300) || descricaoPadrao;
    const observacao = this._texto(data.observacao).slice(0, 500) || null;
    const dataLancamento = this._dataISO(data.dataLancamento || data.data_lancamento, 'dataLancamento');
    const clienteNome = this._texto(data.clienteNome || data.cliente_nome).slice(0, 200) || await this._buscarNomeClienteSnapshot(favorecidoId);

    const result = await pool.query(
      `
        INSERT INTO cliente_credito_lancamentos (
          favorecido,
          cliente_nome_snapshot,
          data_lancamento,
          tipo,
          descricao,
          origem_tipo,
          valor_debito,
          valor_credito,
          observacao
        ) VALUES ($1, $2, $3, $4, $5, 'AJUSTE_MANUAL', $6, $7, $8)
        RETURNING *
      `,
      [
        favorecidoId,
        clienteNome,
        dataLancamento,
        tipo,
        descricao,
        natureza === 'DEBITO' ? valor : 0,
        natureza === 'CREDITO' ? valor : 0,
        observacao
      ]
    );

    return this._mapLancamento(result.rows[0]);
  }

  async registrarPagamentoCliente(favorecido, data = {}) {
    await this._ensureSchema();
    const favorecidoId = this._inteiro(favorecido, 'favorecido', { positivo: true });
    const valor = this._valor(data.valor);
    const condicao = this._texto(data.condicao).toUpperCase();

    if (!['V', 'C'].includes(condicao)) {
      throw this._erro('Condição de pagamento inválida.');
    }

    const payloadBridge = {
      favorecido: favorecidoId,
      condicao,
      valor,
      observacao: this._texto(data.observacao) || 'Pagamento de crédito do cliente'
    };

    let dataLancamento = null;

    if (condicao === 'C') {
      payloadBridge.dataVencimento = this._dataISO(data.dataVencimento || data.data_vencimento, 'dataVencimento');
      payloadBridge.numeroCheque = this._texto(data.numeroCheque || data.numero_cheque).slice(0, 10);
      payloadBridge.titularCheque = this._texto(data.titularCheque || data.titular_cheque).slice(0, 100);
      dataLancamento = payloadBridge.dataVencimento;
    } else {
      payloadBridge.dataPgto = this._dataISO(data.dataPgto || data.data_pgto, 'dataPgto');
      dataLancamento = payloadBridge.dataPgto;
    }

    const bridgeResponse = await legadoBridgeService.post('/api/pagamentos/credito-cliente', payloadBridge);
    const pagamento = bridgeResponse?.dado?.pagamento || null;
    const cliente = bridgeResponse?.dado?.cliente || null;
    const codigoPagamento = pagamento?.codigo || bridgeResponse?.dado?.codigo || null;

    const result = await pool.query(
      `
        INSERT INTO cliente_credito_lancamentos (
          favorecido,
          cliente_nome_snapshot,
          data_lancamento,
          tipo,
          descricao,
          origem_tipo,
          origem_id,
          valor_debito,
          valor_credito,
          observacao
        ) VALUES ($1, $2, $3, 'PAGAMENTO_CLIENTE', $4, 'GEORGE_VENDAS_PGTO', $5, 0, $6, $7)
        RETURNING *
      `,
      [
        favorecidoId,
        this._texto(cliente?.nome).slice(0, 200) || null,
        dataLancamento,
        condicao === 'C' ? 'Cheque recebido no crédito do cliente' : 'Pagamento recebido no crédito do cliente',
        codigoPagamento ? String(codigoPagamento) : null,
        valor,
        payloadBridge.observacao || null
      ]
    );

    return {
      lancamento: this._mapLancamento(result.rows[0]),
      pagamento
    };
  }
}

module.exports = new ClientesCreditosService();
module.exports.TIPOS = TIPOS;
