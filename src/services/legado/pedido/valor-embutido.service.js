'use strict';

const { randomUUID } = require('node:crypto');
const pool = require('../../../../db/connection');

let estruturaPromise;
const vinculosPendentes = new Map();
const tolerancia = 0.000001;

function falhar(mensagem) {
  const erro = new Error(mensagem);
  erro.isValidation = true;
  erro.pedidoNaoGravado = true;
  throw erro;
}

function numero(valor, campo, minimo = 0) {
  const n = Number(valor);
  if (valor === null || valor === '' || typeof valor === 'boolean'
      || !Number.isFinite(n) || n < minimo || n > Number.MAX_SAFE_INTEGER / 1000) {
    falhar(`Valor embutido: ${campo} inválido.`);
  }
  return n;
}

function inteiro(valor, campo) {
  const n = numero(valor, campo, 1);
  if (!Number.isSafeInteger(n)) falhar(`Valor embutido: ${campo} inválido.`);
  return n;
}

function arredondar(valor, casas = 6) {
  return Number(Number(valor).toFixed(casas));
}

function mesmoNumero(a, b) {
  return Number.isFinite(Number(a)) && Number.isFinite(Number(b))
    && Math.abs(Number(a) - Number(b)) <= tolerancia;
}

function snapshotItens(itens) {
  if (!Array.isArray(itens) || !itens.length) falhar('Informe os itens para distribuir o valor.');
  return itens.map((item, indice) => ({
    item: inteiro(item?.item, `item ${indice + 1}`),
    quantidade: numero(item?.quantidade, `quantidade do item ${indice + 1}`, Number.EPSILON),
    preco: numero(item?.preco, `preço do item ${indice + 1}`)
  }));
}

function itensConferem(esperados, atuais) {
  if (!Array.isArray(esperados) || !Array.isArray(atuais) || esperados.length !== atuais.length) return false;
  const restantes = [...atuais];
  return esperados.every(linha => {
    const indice = restantes.findIndex(atual => Number(linha.item) === Number(atual?.item)
      && mesmoNumero(linha.quantidade, atual?.quantidade) && mesmoNumero(linha.preco, atual?.preco));
    if (indice < 0) return false;
    restantes.splice(indice, 1);
    return true;
  });
}

// A referência é o produto e sua posição: o bridge recria SAIDASITENS ao editar.
// SAIDAITEM é guardado apenas como informação, nunca como identidade persistente.
function normalizarValorEmbutido(entrada, itens, { preservarLegado = false } = {}) {
  if (entrada === null) return null;
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) || entrada.versao !== 1) {
    falhar('Registro do valor embutido inválido. Reaplique o produto antes de salvar.');
  }
  const atuais = snapshotItens(itens);
  if (!Array.isArray(entrada.linhas) || entrada.linhas.length !== atuais.length) {
    falhar('O rateio não corresponde aos itens do pedido. Recalcule antes de salvar.');
  }
  const valor = numero(entrada.valor, 'preço do produto', Number.EPSILON);
  const quantidadeTotal = arredondar(atuais.reduce((soma, item) => soma + item.quantidade, 0));
  const valorCentavos = Math.round(valor * 100);
  if (!mesmoNumero(valor * 100, valorCentavos)) falhar('Informe o valor do produto em centavos inteiros.');
  const acrescimoUnitario = arredondar(numero(entrada.acrescimoUnitario, 'acréscimo unitário'));
  const acrescimoCentavos = Math.floor(valorCentavos / quantidadeTotal);
  const unidadesCentavoExtra = valorCentavos % quantidadeTotal;
  const acrescimoCalculado = preservarLegado
    ? Math.round(valorCentavos / quantidadeTotal) / 100 : acrescimoCentavos / 100;
  if (!preservarLegado && (!Number.isSafeInteger(quantidadeTotal)
      || atuais.some(item => !Number.isSafeInteger(item.quantidade)))) {
    falhar('O rateio exato exige quantidades em unidades inteiras.');
  }
  if (!mesmoNumero(acrescimoUnitario, acrescimoCalculado)
      || !mesmoNumero(entrada.quantidadeTotal, quantidadeTotal)) {
    falhar('O rateio mudou. Recalcule o valor embutido antes de salvar.');
  }
  const linhas = entrada.linhas.map((linha, indice) => {
    const atual = atuais[indice];
    const precoBase = numero(linha?.precoBase, `preço original do item ${indice + 1}`);
    const precoAplicado = numero(linha?.precoAplicado, `preço final do item ${indice + 1}`);
    const acrescimoLinha = numero(linha?.acrescimoUnitario, `acréscimo do item ${indice + 1}`);
    const incrementoValido = preservarLegado ? mesmoNumero(acrescimoLinha, acrescimoUnitario)
      : (mesmoNumero(acrescimoLinha, acrescimoCentavos / 100)
        || (unidadesCentavoExtra > 0 && mesmoNumero(acrescimoLinha, (acrescimoCentavos + 1) / 100)));
    if (!preservarLegado && !mesmoNumero(precoBase * 100, Math.round(precoBase * 100))) {
      falhar('O rateio exato exige preços-base com no máximo duas casas decimais.');
    }
    if (Number(linha?.item) !== atual.item || !mesmoNumero(linha?.quantidade, atual.quantidade)
        || !incrementoValido
        || !mesmoNumero(precoAplicado, precoBase + acrescimoLinha)
        || !mesmoNumero(precoAplicado, atual.preco)) {
      falhar(`O valor embutido não corresponde ao item ${indice + 1}. Recalcule antes de salvar.`);
    }
    return {
      item: atual.item,
      ...(Number.isSafeInteger(Number(linha.saidaItem)) && Number(linha.saidaItem) > 0
        ? { saidaItem: Number(linha.saidaItem) } : {}),
      sequencia: indice + 1,
      quantidade: atual.quantidade,
      precoBase,
      precoAplicado,
      acrescimoUnitario: acrescimoLinha
    };
  });
  const totalCentavos = linhas.reduce((soma, linha) =>
    soma + linha.quantidade * Math.round(linha.acrescimoUnitario * 100), 0);
  if (!preservarLegado && (!Number.isSafeInteger(totalCentavos) || totalCentavos !== valorCentavos)) {
    falhar('O rateio deve distribuir exatamente o valor do produto, sem diferença de centavos.');
  }
  const totalPedidoCentavos = linhas.reduce((soma, linha) =>
    soma + linha.quantidade * Math.round(linha.precoAplicado * 100), 0);
  if (!preservarLegado && !Number.isSafeInteger(totalPedidoCentavos)) {
    falhar('O total do pedido ultrapassa o limite seguro para o rateio.');
  }
  const totalDistribuido = preservarLegado
    ? arredondar(quantidadeTotal * acrescimoUnitario, 2) : totalCentavos / 100;
  const diferenca = arredondar(totalDistribuido - valor, 2);
  if (!mesmoNumero(entrada.totalDistribuido, totalDistribuido)
      || !mesmoNumero(entrada.diferenca, diferenca)) {
    falhar('O total distribuído não confere. Recalcule antes de salvar.');
  }
  const acrescimoUnitarioMaximo = (acrescimoCentavos + (unidadesCentavoExtra > 0 ? 1 : 0)) / 100;
  if (!preservarLegado && ((entrada.unidadesCentavoExtra !== undefined
      && !mesmoNumero(entrada.unidadesCentavoExtra, unidadesCentavoExtra))
      || (entrada.acrescimoUnitarioMaximo !== undefined
      && !mesmoNumero(entrada.acrescimoUnitarioMaximo, acrescimoUnitarioMaximo)))) {
    falhar('A distribuição dos centavos restantes não confere. Recalcule antes de salvar.');
  }
  const nome = String(entrada.produto?.nome || '').trim();
  if (!nome || nome.length > 300) falhar('Produto embutido inválido.');
  return {
    versao: 1,
    produto: {
      id: inteiro(entrada.produto?.id, 'produto'),
      itemLegado: entrada.produto?.itemLegado == null ? null : inteiro(entrada.produto.itemLegado, 'item do produto'),
      nome
    },
    valor,
    quantidadeTotal,
    acrescimoUnitario,
    ...(!preservarLegado ? { acrescimoUnitarioMaximo, unidadesCentavoExtra } : {}),
    totalDistribuido,
    diferenca,
    linhas
  };
}

function mesmoRegistroLegado(a, b) {
  if (!a || !b || a.versao !== b.versao || !Array.isArray(a.linhas) || !Array.isArray(b.linhas)) return false;
  if (Number(a.produto?.id) !== Number(b.produto?.id)
      || Number(a.produto?.itemLegado || 0) !== Number(b.produto?.itemLegado || 0)
      || String(a.produto?.nome) !== String(b.produto?.nome)) return false;
  if (!['valor', 'quantidadeTotal', 'acrescimoUnitario', 'totalDistribuido', 'diferenca']
    .every(campo => mesmoNumero(a[campo], b[campo]))) return false;
  const restantes = [...b.linhas];
  return a.linhas.length === b.linhas.length && a.linhas.every(linha => {
    const indice = restantes.findIndex(outra => Number(linha.item) === Number(outra.item)
      && ['quantidade', 'precoBase', 'precoAplicado', 'acrescimoUnitario']
        .every(campo => mesmoNumero(linha[campo], outra[campo])));
    if (indice < 0) return false;
    restantes.splice(indice, 1);
    return true;
  });
}

async function prepararEstrutura() {
  if (!estruturaPromise) {
    estruturaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS pedido_valor_embutido_operacoes (
        id UUID PRIMARY KEY,
        ordem BIGSERIAL UNIQUE NOT NULL,
        pedido_ref BIGINT,
        pedido_numero TEXT,
        estado TEXT NOT NULL DEFAULT 'preparado',
        valor_embutido JSONB,
        itens JSONB NOT NULL,
        valor_embutido_anterior JSONB,
        itens_anteriores JSONB,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        aplicado_em TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_pedido_valor_embutido_ref
        ON pedido_valor_embutido_operacoes(pedido_ref, ordem DESC);
    `).catch(erro => { estruturaPromise = null; throw erro; });
  }
  return estruturaPromise;
}

async function prepararOperacao({ pedidoId = null, valorEmbutido, itens, valorEmbutidoAnterior = null, itensAnteriores = null }) {
  // Pedidos da primeira versão podem ter rateio aproximado ou preços de três
  // casas. Conservá-los apenas quando nada mudou; a retirada continua possível.
  const preservarLegado = mesmoRegistroLegado(valorEmbutido, valorEmbutidoAnterior)
    && itensConferem(itens, itensAnteriores)
    && (Math.abs(Number(valorEmbutidoAnterior?.diferenca || 0)) >= 0.005
      || valorEmbutidoAnterior.linhas.some(linha => !Number.isSafeInteger(Number(linha.quantidade))
        || !mesmoNumero(Number(linha.precoBase) * 100, Math.round(Number(linha.precoBase) * 100))));
  const normalizado = normalizarValorEmbutido(valorEmbutido, itens, { preservarLegado });
  const snapshot = snapshotItens(itens);
  const id = randomUUID();
  const pedidoRef = pedidoId == null ? null : inteiro(pedidoId, 'pedido');
  const anteriores = itensAnteriores == null ? null : snapshotItens(itensAnteriores);
  try {
    await prepararEstrutura();
    // O histórico original já está durável antes de qualquer gravação no Firebird.
    await pool.query(`
      INSERT INTO pedido_valor_embutido_operacoes(id,pedido_ref,valor_embutido,itens,valor_embutido_anterior,itens_anteriores)
      VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb)
    `, [id, pedidoRef, JSON.stringify(normalizado), JSON.stringify(snapshot),
      JSON.stringify(valorEmbutidoAnterior), JSON.stringify(anteriores)]);
  } catch (causa) {
    const erro = new Error('Não foi possível registrar os preços originais. Nenhum pedido foi gravado. Tente novamente.');
    erro.pedidoNaoGravado = true;
    erro.cause = causa;
    throw erro;
  }
  return { id, pedidoRef, valorEmbutido: normalizado, itens: snapshot };
}

async function marcarIncerto(operacao) {
  if (!operacao) return;
  await pool.query("UPDATE pedido_valor_embutido_operacoes SET estado='incerto' WHERE id=$1 AND estado='preparado'", [operacao.id])
    .catch(() => {});
}

function resultadoIncerto(operacao) {
  return {
    salvamentoIncerto: true,
    operacaoValorEmbutido: operacao?.id || null,
    aviso: 'Não foi possível confirmar o salvamento. Consulte o pedido antes de tentar novamente; ele pode já ter sido gravado.'
  };
}

async function concluirOperacao(operacao, pedido) {
  if (!operacao) return {};
  const pedidoRef = Number(pedido?.idMestre ?? pedido?.saida ?? pedido?.SAIDA ?? operacao.pedidoRef);
  const dados = { valorEmbutido: operacao.valorEmbutido };
  if (!Number.isSafeInteger(pedidoRef) || pedidoRef <= 0) {
    await marcarIncerto(operacao);
    return { ...dados, operacaoValorEmbutido: operacao.id,
      avisoValorEmbutido: 'Pedido salvo, mas o sistema não retornou seu código para vincular o valor embutido. Consulte o pedido antes de continuar; não o salve novamente.' };
  }
  const pendente = { ...operacao, pedidoRef, pedidoNumero: String(pedido?.numero || '') };
  vinculosPendentes.set(pedidoRef, pendente);
  try {
    const atualizacao = await pool.query(`
      UPDATE pedido_valor_embutido_operacoes
      SET pedido_ref=$2,pedido_numero=$3,estado='aplicado',aplicado_em=NOW()
      WHERE id=$1
    `, [operacao.id, pedidoRef, pendente.pedidoNumero]);
    if (atualizacao.rowCount !== 1) throw new Error('Histórico do valor embutido não localizado.');
    vinculosPendentes.delete(pedidoRef);
    return dados;
  } catch (_) {
    return { ...dados, operacaoValorEmbutido: operacao.id,
      avisoValorEmbutido: 'Pedido salvo. O histórico do valor embutido está registrado, mas sua vinculação ao pedido está pendente. Reabra o pedido para conferir; não repita o salvamento.' };
  }
}

async function obterValorEmbutido(pedidoId, itens) {
  const id = inteiro(pedidoId, 'pedido');
  await prepararEstrutura();
  const pendente = vinculosPendentes.get(id);
  if (pendente) {
    const vinculo = await concluirOperacao(pendente, { idMestre: id, numero: pendente.pedidoNumero });
    if (vinculo.avisoValorEmbutido) throw new Error(vinculo.avisoValorEmbutido);
  }
  const { rows } = await pool.query(`
    SELECT id,estado,valor_embutido,itens,valor_embutido_anterior,itens_anteriores FROM pedido_valor_embutido_operacoes
    WHERE pedido_ref=$1 AND estado IN ('aplicado','preparado','incerto')
    ORDER BY ordem DESC LIMIT 2
  `, [id]);
  const ultima = rows[0];
  if (!ultima) return null;
  if (ultima.estado === 'aplicado') {
    if (ultima.valor_embutido && itens && !itensConferem(ultima.itens, itens)) {
      throw new Error('Os itens ou preços foram alterados fora do rateio salvo. A retirada automática foi bloqueada; confira o pedido antes de editar.');
    }
    return ultima.valor_embutido;
  }
  // Em uma edição com resposta interrompida, a consulta do legado decide qual
  // snapshot está gravado; nunca repetimos a escrita do pedido para recuperar.
  if (itensConferem(ultima.itens, itens)) {
    await pool.query("UPDATE pedido_valor_embutido_operacoes SET estado='aplicado',aplicado_em=NOW() WHERE id=$1", [ultima.id]);
    return ultima.valor_embutido;
  }
  if (ultima.estado === 'incerto' && itensConferem(ultima.itens_anteriores, itens)) {
    await pool.query("UPDATE pedido_valor_embutido_operacoes SET estado='nao_aplicado' WHERE id=$1", [ultima.id]);
    return ultima.valor_embutido_anterior;
  }
  const anterior = rows.find(row => row.estado === 'aplicado');
  if (anterior && (!itens || itensConferem(anterior.itens, itens))) return anterior.valor_embutido;
  throw new Error('Há um salvamento do valor embutido sem confirmação. Reabra o pedido para conferir os itens antes de nova alteração.');
}

function conferirPreservacao(valorEmbutido, itens) {
  if (!valorEmbutido || !Array.isArray(itens)) return;
  const snapshot = valorEmbutido.linhas.map(linha => ({
    item: linha.item, quantidade: linha.quantidade, preco: linha.precoAplicado
  }));
  if (!itensConferem(snapshot, itens)) {
    falhar('Este pedido possui valor embutido. Altere os itens pela edição do pedido, mantendo ou retirando o produto embutido.');
  }
}

module.exports = {
  prepararOperacao,
  concluirOperacao,
  obterValorEmbutido,
  conferirPreservacao,
  marcarIncerto,
  resultadoIncerto,
  normalizarValorEmbutido
};
