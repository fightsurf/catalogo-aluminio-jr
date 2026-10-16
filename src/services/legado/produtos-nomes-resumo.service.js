// Nomes exibidos nos resumos: PostgreSQL (produtos.nome) prevalece sobre Firebird.
// A associação usa somente o codigo do item legado; nao altera os dados originais.
const pool = require('../../../db/connection');

function normalizarCodigoItem(valor) {
  const codigo = Number(valor);
  return Number.isSafeInteger(codigo) && codigo > 0 ? codigo : null;
}

async function aplicarNomesPostgresEmCarradas(carradas) {
  const lista = Array.isArray(carradas) ? carradas : [];
  const codigos = new Set();

  for (const carrada of lista) {
    for (const pedido of Array.isArray(carrada?.pedidos) ? carrada.pedidos : []) {
      for (const item of Array.isArray(pedido?.itens) ? pedido.itens : []) {
        const codigo = normalizarCodigoItem(item?.item);
        if (codigo) codigos.add(codigo);
      }
    }
  }

  if (!codigos.size) return lista;

  let rows;
  try {
    // Uma consulta em lote, sem N consultas por item/pedido e sem depender de nome do Firebird.
    const resultado = await pool.query(`
      SELECT item_legado, BTRIM(nome) AS nome
      FROM produtos
      WHERE item_legado = ANY($1::bigint[])
        AND NULLIF(BTRIM(nome), '') IS NOT NULL
      ORDER BY item_legado, id
    `, [Array.from(codigos)]);
    rows = resultado.rows;
  } catch (error) {
    // Nunca impedir a exibicao de uma carrada por indisponibilidade do catalogo.
    console.error('Falha ao consultar nomes PostgreSQL para resumo de producao:', error.message);
    return lista;
  }

  const nomes = new Map();
  for (const row of rows) {
    const codigo = normalizarCodigoItem(row.item_legado);
    const nome = String(row.nome || '').trim();
    if (codigo && nome && !nomes.has(codigo)) nomes.set(codigo, nome);
  }

  return lista.map((carrada) => ({
    ...carrada,
    pedidos: Array.isArray(carrada?.pedidos)
      ? carrada.pedidos.map((pedido) => ({
          ...pedido,
          itens: Array.isArray(pedido?.itens)
            ? pedido.itens.map((item) => {
                const nomePostgres = nomes.get(normalizarCodigoItem(item?.item));
                return nomePostgres ? { ...item, descricaoPostgres: nomePostgres } : item;
              })
            : pedido?.itens
        }))
      : carrada?.pedidos
  }));
}

module.exports = { aplicarNomesPostgresEmCarradas };
