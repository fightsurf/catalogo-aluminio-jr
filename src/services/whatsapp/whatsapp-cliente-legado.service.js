'use strict';
// O cadastro da fábrica é acessado pelo bridge do legado, não por Firebird local.
const clientes = require('../legado/clientes/clientes.service');
const cache = new Map();
const pendentes = new Map();
const CACHE_MS = 5 * 60 * 1000;
const ERRO_MS = 30 * 1000;
const TEMPO_MAXIMO_LISTA_MS = 1500;

function numerosEquivalentes(primeiro, segundo) {
  const a = String(primeiro || '').replace(/\D/g, '');
  const b = String(segundo || '').replace(/\D/g, '');
  if (!a || !b) return false;
  return a === b || (a.startsWith('55') && a.slice(2) === b) ||
    (b.startsWith('55') && b.slice(2) === a);
}

async function consultarCadastro(telefone) {
  // Limite evita que um eventual filtro não suportado devolva toda a base.
  const encontrados = await clientes.listarClientes({ telefone, limite: 5, status: 'todos' });
  if (!Array.isArray(encontrados)) return null;
  const correspondentes = encontrados.filter(c =>
    numerosEquivalentes(telefone, c.telefonePrincipal || c.telefone_principal || c.telefone || c.fone1));
  if (correspondentes.length !== 1) return null;
  const c = correspondentes[0];
  return {
    nome: c.nome || c.razao || '',
    cidade: c.cidade || '',
    uf: c.uf || ''
  };
}

function nomeCidade(telefone) {
  const n = String(telefone || '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(n)) return Promise.resolve(null);
  const cached = cache.get(n);
  if (cached && cached.expira > Date.now()) return Promise.resolve(cached.dados);
  if (pendentes.has(n)) return pendentes.get(n);

  const tarefa = consultarCadastro(n)
    .then(dados => {
      cache.set(n, { dados, expira: Date.now() + CACHE_MS });
      pendentes.delete(n);
      return dados;
    })
    .catch(erro => {
      // Falha do sistema legado jamais derruba a lista de telefones.
      console.warn('[Bot Admin] Cadastro legado indisponivel:', erro.message);
      cache.set(n, { dados: null, expira: Date.now() + ERRO_MS });
      pendentes.delete(n);
      return null;
    });
  pendentes.set(n, tarefa);
  return tarefa;
}

async function enriquecer(lista) {
  const saida = lista.map(c => ({
    ...c, cliente_nome: null, cliente_cidade: null, cliente_uf: null
  }));
  // Processar poucos telefones por vez para não sobrecarregar o bridge.
  const trabalho = (async () => {
    for (let i = 0; i < saida.length; i += 4) {
      await Promise.all(saida.slice(i, i + 4).map(async c => {
        const dados = await nomeCidade(c.telefone);
        c.cliente_nome = dados?.nome || null;
        c.cliente_cidade = dados?.cidade || null;
        c.cliente_uf = dados?.uf || null;
      }));
    }
  })();
  // O PostgreSQL é fonte da lista. Nomes/cidades são enriquecimento opcional
  // que não pode atrasar o recebimento dos números em caso de bridge lento.
  await Promise.race([
    trabalho,
    new Promise(resolve => setTimeout(resolve, TEMPO_MAXIMO_LISTA_MS))
  ]);
  return saida;
}

module.exports = { enriquecer };
