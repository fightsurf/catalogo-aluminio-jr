'use strict';
// Intenções administrativas privadas, independentes das intenções de atendimento.
const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const pagamentos = require('../legado/pagamentos/pagamentos.service');
const envio = require('./envio-whatsapp.service');

const ACOES = Object.freeze({ localizar_cliente: 'Localizar cliente' });
const sessoes = new Map();
const SESSAO_MS = 10 * 60 * 1000;
let preparando = null;

async function preparar() {
  if (!preparando) {
    preparando = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_admin_intencoes (
          id BIGSERIAL PRIMARY KEY,
          chave VARCHAR(90) NOT NULL UNIQUE,
          nome VARCHAR(120) NOT NULL,
          acao VARCHAR(60) NOT NULL CHECK (acao IN ('localizar_cliente')),
          frases TEXT NOT NULL,
          ativo BOOLEAN NOT NULL DEFAULT TRUE,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await pool.query(`
        INSERT INTO whatsapp_admin_intencoes (chave, nome, acao, frases, ativo)
        VALUES ('localizar_cliente', 'Localizar cliente', 'localizar_cliente',
                'localize cliente\nlocalizar cliente\nprocure cliente\nbusque cliente', TRUE)
        ON CONFLICT (chave) DO NOTHING`);
    })().catch(error => { preparando = null; throw error; });
  }
  await preparando;
}

function validar(dados) {
  const nome = String(dados?.nome || '').trim();
  const acao = String(dados?.acao || '').trim();
  const frases = String(dados?.frases || '').replace(/\r/g, '').trim();
  if (nome.length < 3 || nome.length > 120) throw new Error('Nome deve ter de 3 a 120 caracteres.');
  if (!Object.hasOwn(ACOES, acao)) throw new Error('Ação administrativa indisponível.');
  const lista = frases.split('\n').map(x => x.trim()).filter(Boolean);
  if (!lista.length || lista.length > 20 || lista.some(x => x.length < 5 || x.length > 100)) {
    throw new Error('Informe de 1 a 20 frases, uma por linha, com 5 a 100 caracteres.');
  }
  return { nome, acao, frases: lista.join('\n'), ativo: dados.ativo !== false };
}
async function listar() {
  await preparar();
  const r = await pool.query(`
    SELECT id, chave, nome, acao, frases, ativo, criado_em, atualizado_em
    FROM whatsapp_admin_intencoes ORDER BY id ASC`);
  return r.rows;
}
async function cadastrar(dados) {
  const d = validar(dados);
  await preparar();
  const chave = 'int_' + crypto.randomUUID().replace(/-/g, '');
  const r = await pool.query(`
    INSERT INTO whatsapp_admin_intencoes (chave, nome, acao, frases, ativo)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [chave, d.nome, d.acao, d.frases, d.ativo]);
  return r.rows[0];
}
async function atualizar(id, dados) {
  const d = validar(dados);
  await preparar();
  const r = await pool.query(`
    UPDATE whatsapp_admin_intencoes
    SET nome=$2, acao=$3, frases=$4, ativo=$5, atualizado_em=NOW()
    WHERE id=$1 RETURNING *`,
    [id, d.nome, d.acao, d.frases, d.ativo]);
  if (!r.rows.length) throw new Error('Intenção não encontrada.');
  return r.rows[0];
}
async function excluir(id) {
  await preparar();
  const r = await pool.query('DELETE FROM whatsapp_admin_intencoes WHERE id=$1 RETURNING id', [id]);
  if (!r.rows.length) throw new Error('Intenção não encontrada.');
  return true;
}
function semAcentos(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function identificar(texto, intencoes) {
  let original = String(texto || '').trim().slice(0, 1000);
  original = original.replace(/^sistema\b\s*[,.:;!?\-]*\s*/i, '');
  const normal = semAcentos(original);
  for (const intencao of intencoes) {
    if (!intencao.ativo || !Object.hasOwn(ACOES, intencao.acao)) continue;
    const frases = String(intencao.frases || '').split('\n').map(x => x.trim()).filter(Boolean);
    frases.sort((a,b) => b.length - a.length);
    for (const frase of frases) {
      const esperada = semAcentos(frase);
      if (normal === esperada) return { intencao, argumento: '' };
      if (normal.startsWith(esperada + ' ')) {
        // Mantém os acentos do nome ditado, em vez de utilizar o texto normalizado.
        const palavras = frase.split(/\s+/).length;
        const argumento = original.split(/\s+/).slice(palavras).join(' ').replace(/^[,.:;\- ]+/, '').trim();
        return { intencao, argumento };
      }
    }
  }
  return null;
}
function normalizarNome(nome) {
  const resultado = String(nome || '').replace(/\s+/g, ' ').trim().replace(/[.,!?;]+$/, '');
  if (resultado.length < 2 || resultado.length > 100) return '';
  return resultado;
}
function respostasClientes(nome, clientes) {
  if (!clientes.length) return ['Não encontrei clientes com o nome "' + nome + '". Informe outro nome.'];
  const linhas = clientes.map((c, i) => {
    const nomeCliente = String(c.nome || 'Sem nome').trim().slice(0,120);
    const codigo = String(c.favorecido ?? '').trim();
    const local = [c.cidade, c.uf].filter(Boolean).map(x => String(x).trim().slice(0,55)).join('/');
    return (i+1) + '. ' + nomeCliente + (local ? ' — ' + local : '') + (codigo ? ' (cód. ' + codigo + ')' : '');
  });
  const paginas = [];
  let pagina = 'Clientes encontrados para "' + nome + '" (' + clientes.length + '):';
  for (const linha of linhas) {
    if (pagina.length + linha.length > 3000) { paginas.push(pagina); pagina = ''; }
    pagina += '\n' + linha.slice(0, 3000);
  }
  if (pagina) paginas.push(pagina);
  return paginas;
}
function limparSessoes() {
  const agora = Date.now();
  for (const [tel, s] of sessoes) if (s.expira < agora) sessoes.delete(tel);
}
async function processarMensagem({ telefone, texto, permitido = false }, deps = {}) {
  // O chamador precisa ter verificado número, instância, direção e LID, se houver.
  if (!permitido || !/^\d{10,15}$/.test(String(telefone || ''))) return { reconhecido: false };
  limparSessoes();
  const busca = deps.listarClientes || pagamentos.listarClientes;
  const enviar = deps.enviar || envio.enviarMensagem;
  const buscarIntencoes = deps.listarIntencoes || listar;
  const pendente = sessoes.get(telefone);
  const frase = String(texto || '').trim().slice(0,1000);
  const encontrado = identificar(frase, await buscarIntencoes());
  if (!encontrado && !pendente) return { reconhecido: false };
  if (encontrado && encontrado.intencao.acao !== 'localizar_cliente') return { reconhecido: false };
  const resposta = [];
  if (encontrado) sessoes.delete(telefone);
  const nome = normalizarNome(encontrado ? encontrado.argumento : frase);
  if (!nome) {
    sessoes.set(telefone, { acao: 'localizar_cliente', expira: Date.now() + SESSAO_MS });
    resposta.push('Qual é o nome do cliente que deseja localizar?');
  } else {
    sessoes.delete(telefone);
    const encontrados = await busca(nome);
    resposta.push(...respostasClientes(nome, Array.isArray(encontrados) ? encontrados : []));
  }
  for (const mensagem of resposta) await enviar({ telefone, mensagem });
  return { reconhecido: true, acao: 'localizar_cliente', resposta: resposta.join('\n\n') };
}
module.exports = { ACOES, preparar, listar, cadastrar, atualizar, excluir, identificar,
  respostasClientes, processarMensagem };
