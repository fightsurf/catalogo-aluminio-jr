'use strict';
const UNIDADES = new Set(['un','kg','g','m','cm','mm','l','ml','cx','pct','outro']);
function erro(mensagem, status = 400) {
  const e = new Error(mensagem); e.status = status; return e;
}
function numero(valor, campo, { minimo = 0, maximo = 999999999, casas = 2 } = {}) {
  if (valor === null || valor === undefined || String(valor).trim() === '') throw erro(campo + ' é obrigatório.');
  const n = Number(typeof valor === 'string' ? valor.trim().replace(',', '.') : valor);
  if (!Number.isFinite(n) || n < minimo || n > maximo || Math.round(n * 10 ** casas) / 10 ** casas !== n)
    throw erro(campo + ' inválido (máximo de ' + casas + ' casas decimais).');
  return n;
}
function inteiro(valor, campo, maximo = 2147483647) {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximo) throw erro(campo + ' inválido.');
  return n;
}
function validarCompra(dados = {}) {
  const fornecedor_id = inteiro(dados.fornecedor_id, 'Fornecedor');
  const numero_nf = String(dados.numero_nf || '').trim();
  if (!numero_nf || numero_nf.length > 60) throw erro('Informe o número da nota fiscal (até 60 caracteres).');
  const valor_nf = numero(dados.valor_nf, 'Valor da NF');
  const valor_frete = numero(dados.valor_frete ?? 0, 'Valor do frete');
  const icms_frete = numero(dados.icms_frete ?? 0, 'ICMS do frete');
  const data_nf = dados.data_nf ? String(dados.data_nf).trim() : null;
  if (data_nf && !/^\d{4}-\d{2}-\d{2}$/.test(data_nf)) throw erro('Data da NF inválida.');
  if (!Array.isArray(dados.itens) || !dados.itens.length || dados.itens.length > 500) throw erro('A nota precisa ter de 1 a 500 itens.');
  const itens = dados.itens.map((item, indice) => {
    const descricao = String(item?.descricao || '').trim();
    if (!descricao || descricao.length > 240) throw erro('Descrição inválida no item ' + (indice+1) + '.');
    const insumo_id = item.insumo_id ? inteiro(item.insumo_id, 'Insumo do item ' + (indice+1)) : null;
    const unidade = String(item.unidade || 'un').trim().toLowerCase();
    if (!UNIDADES.has(unidade)) throw erro('Unidade inválida no item ' + (indice+1) + '.');
    const quantidade = numero(item.quantidade, 'Quantidade do item ' + (indice+1), {minimo:0.001, maximo:999999999, casas:3});
    const preco_unitario = numero(item.preco_unitario, 'Preço unitário do item ' + (indice+1), {maximo:999999999,casas:4});
    const valor_total = Math.round((quantidade * preco_unitario + Number.EPSILON) * 100) / 100;
    if (valor_total > 999999999999.99) throw erro('Total do item excedeu o limite.');
    return { insumo_id, descricao, unidade, quantidade, preco_unitario, valor_total, posicao:indice+1 };
  });
  const quantidade_itens_nf = inteiro(dados.quantidade_itens_nf ?? itens.length, 'Quantidade de itens na NF', 500);
  return { fornecedor_id, numero_nf, valor_nf, quantidade_itens_nf, valor_frete, icms_frete,
    data_nf, origem: dados.origem === 'ia' ? 'ia' : 'manual', itens };
}
module.exports = { validarCompra, erro, numero };
