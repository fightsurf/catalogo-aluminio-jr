'use strict';
// Intenções administrativas privadas, independentes das intenções de atendimento.
const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const pagamentos = require('../legado/pagamentos/pagamentos.service');
const clientesLegado = require('../legado/clientes/clientes.service');
const envio = require('./envio-whatsapp.service');
const classificador = require('./classificador-intencoes-admin.service');

const ACOES = Object.freeze({ localizar_cliente: 'Localizar cliente', etapa_futura: 'Etapa futura (sem execução)' });
const ACOES_EXECUTAVEIS = new Set(['localizar_cliente']);
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
          descricao TEXT NOT NULL DEFAULT '',
          acao VARCHAR(60) NOT NULL CHECK (acao IN ('localizar_cliente')),
          frases TEXT NOT NULL,
          ativo BOOLEAN NOT NULL DEFAULT TRUE,
          criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      // Migração compatível com cadastros anteriores.
      await pool.query("ALTER TABLE whatsapp_admin_intencoes ADD COLUMN IF NOT EXISTS descricao TEXT NOT NULL DEFAULT ''");
      await pool.query("ALTER TABLE whatsapp_admin_intencoes ADD COLUMN IF NOT EXISTS proximas_intencoes BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[]");
      // Migração compatível: etapas futuras são inativas até existir um executor.
      await pool.query("ALTER TABLE whatsapp_admin_intencoes DROP CONSTRAINT IF EXISTS whatsapp_admin_intencoes_acao_check");
      await pool.query("ALTER TABLE whatsapp_admin_intencoes ADD CONSTRAINT whatsapp_admin_intencoes_acao_check CHECK (acao IN ('localizar_cliente','etapa_futura'))");
      await pool.query(`UPDATE whatsapp_admin_intencoes SET descricao =
        'Localiza os clientes cadastrados na Alumínio JR pelo nome completo ou parcial e retorna a lista por WhatsApp. Não modifica cadastros.'
        WHERE acao = 'localizar_cliente' AND TRIM(descricao) = ''`);
      await pool.query(`
        INSERT INTO whatsapp_admin_intencoes (chave, nome, descricao, acao, frases, ativo)
        VALUES ('localizar_cliente', 'Localizar cliente',
                'Localiza os clientes cadastrados pelo nome ou parte do nome e devolve a lista por WhatsApp. Não altera clientes.',
                'localizar_cliente',
                'localize cliente\nlocalizar cliente\nprocure cliente\nbusque cliente', TRUE)
        ON CONFLICT (chave) DO NOTHING`);
    })().catch(error => { preparando = null; throw error; });
  }
  await preparando;
}

function validar(dados) {
  const nome = String(dados?.nome || '').trim();
  const acao = String(dados?.acao || '').trim();
  const descricao = String(dados?.descricao || '').trim();
  const frases = String(dados?.frases || '').replace(/\r/g, '').trim();
  if (nome.length < 3 || nome.length > 120) throw new Error('Nome deve ter de 3 a 120 caracteres.');
  if (descricao.length < 12 || descricao.length > 800) throw new Error('Descreva a intenção em 12 a 800 caracteres.');
  if (!Object.hasOwn(ACOES, acao)) throw new Error('Ação administrativa indisponível.');
  if (!ACOES_EXECUTAVEIS.has(acao) && dados?.ativo !== false) {
    throw new Error('Uma etapa sem ação implementada deve permanecer inativa.');
  }
  const proximas = dados?.proximas_intencoes ?? [];
  if (!Array.isArray(proximas) || proximas.length > 20 ||
      proximas.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
    throw new Error('Vincule até 20 próximas intenções válidas.');
  }
  const proximasIntencoes = [...new Set(proximas.map(Number))];
  const lista = frases.split('\n').map(x => x.trim()).filter(Boolean);
  if (!lista.length || lista.length > 20 || lista.some(x => x.length < 5 || x.length > 100)) {
    throw new Error('Informe de 1 a 20 frases, uma por linha, com 5 a 100 caracteres.');
  }
  return { nome, descricao, acao, frases: lista.join('\n'), ativo: dados.ativo !== false, proximasIntencoes };
}
async function listar() {
  await preparar();
  const r = await pool.query(`
    SELECT id, chave, nome, descricao, acao, frases, ativo, proximas_intencoes, criado_em, atualizado_em
    FROM whatsapp_admin_intencoes ORDER BY id ASC`);
  return r.rows;
}
async function validarVinculos(ids, idAtual = null) {
  if (!ids.length) return;
  if (idAtual && ids.includes(Number(idAtual))) throw new Error('Uma intenção não pode apontar para ela mesma.');
  const r = await pool.query('SELECT id FROM whatsapp_admin_intencoes WHERE id = ANY($1::BIGINT[])', [ids]);
  if (r.rows.length !== ids.length) throw new Error('Uma das próximas intenções não existe mais. Atualize a lista.');
}
async function cadastrar(dados) {
  const d = validar(dados);
  await preparar();
  await validarVinculos(d.proximasIntencoes);
  const chave = 'int_' + crypto.randomUUID().replace(/-/g, '');
  const r = await pool.query(`
    INSERT INTO whatsapp_admin_intencoes (chave, nome, descricao, acao, frases, ativo, proximas_intencoes)
    VALUES ($1,$2,$3,$4,$5,$6,$7::BIGINT[]) RETURNING *`,
    [chave, d.nome, d.descricao, d.acao, d.frases, d.ativo, d.proximasIntencoes]);
  return r.rows[0];
}
async function atualizar(id, dados) {
  const d = validar(dados);
  await preparar();
  await validarVinculos(d.proximasIntencoes, id);
  const r = await pool.query(`
    UPDATE whatsapp_admin_intencoes
    SET nome=$2, descricao=$3, acao=$4, frases=$5, ativo=$6, proximas_intencoes=$7::BIGINT[], atualizado_em=NOW()
    WHERE id=$1 RETURNING *`,
    [id, d.nome, d.descricao, d.acao, d.frases, d.ativo, d.proximasIntencoes]);
  if (!r.rows.length) throw new Error('Intenção não encontrada.');
  return r.rows[0];
}
async function excluir(id) {
  await preparar();
  const r = await pool.query('DELETE FROM whatsapp_admin_intencoes WHERE id=$1 RETURNING id', [id]);
  if (!r.rows.length) throw new Error('Intenção não encontrada.');
  await pool.query('UPDATE whatsapp_admin_intencoes SET proximas_intencoes = array_remove(proximas_intencoes, $1::BIGINT) WHERE $1::BIGINT = ANY(proximas_intencoes)', [id]);
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
    if (!intencao.ativo || !ACOES_EXECUTAVEIS.has(intencao.acao)) continue;
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
const LIMITE_CLIENTES_RESPOSTA = 5;
function telefoneCliente(cliente) {
  return String(cliente?.telefonePrincipal || cliente?.telefone_principal ||
    cliente?.telefone1 || cliente?.telefone || cliente?.fone1 || cliente?.fOne1 ||
    cliente?.celular || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function telefoneExibicao(valor) {
  const telefone = String(valor || '').replace(/\D/g, '');
  const nacional = telefone.startsWith('55') && (telefone.length === 12 || telefone.length === 13)
    ? telefone.slice(2) : telefone;
  const prefixo = nacional !== telefone ? '+55 ' : '';
  if (nacional.length === 11) {
    return prefixo + '(' + nacional.slice(0, 2) + ') ' + nacional.slice(2, 7) +
      '-' + nacional.slice(7);
  }
  if (nacional.length === 10) {
    return prefixo + '(' + nacional.slice(0, 2) + ') ' + nacional.slice(2, 6) +
      '-' + nacional.slice(6);
  }
  return String(valor || '').trim() || 'Não informado';
}
async function completarTelefones(lista, buscarCliente) {
  // A consulta de pagamentos pode retornar apenas nome e cidade. Busca detalhes
  // exclusivamente dos cinco clientes exibidos, sem alterar qualquer cadastro.
  return Promise.all(lista.slice(0, LIMITE_CLIENTES_RESPOSTA).map(async cliente => {
    if (telefoneCliente(cliente) || !cliente?.favorecido) return cliente;
    try {
      const detalhe = await buscarCliente(cliente.favorecido);
      if (!detalhe || Number(detalhe.favorecido) !== Number(cliente.favorecido)) return cliente;
      return { ...cliente, telefonePrincipal: telefoneCliente(detalhe) };
    } catch (_) {
      // A indisponibilidade de um telefone não impede a resposta aos demais.
      return cliente;
    }
  }));
}
function respostasClientes(nome, clientes) {
  if (!clientes.length) return ['Não encontrei clientes com o nome "' + nome + '". Informe outro nome.'];
  const linhas = clientes.slice(0, LIMITE_CLIENTES_RESPOSTA).map((c, i) => {
    const nomeCliente = String(c.nome || 'Sem nome').replace(/\s+/g, ' ').trim()
      .replace(/\*/g, '').slice(0, 120);
    const cidade = [c.cidade, c.uf].filter(Boolean)
      .map(x => String(x).replace(/\s+/g, ' ').trim().slice(0, 55)).join('/');
    const telefone = telefoneExibicao(telefoneCliente(c));
    return (i + 1) + '. *' + nomeCliente + '*\n' +
      'Cidade: ' + (cidade || 'Não informada') + '\n' +
      'Telefone: ' + telefone;
  });
  return ['Clientes encontrados para "' + nome + '":\n\n' + linhas.join('\n\n')];
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
  // Mensagem transcrita + todas as intenções ativas e suas descrições vão à IA.
  // A IA apenas seleciona uma chave existente; não executa comandos.
  const cadastradas = (await buscarIntencoes()).filter(i => i.ativo && Object.hasOwn(ACOES, i.acao));
  const classificar = deps.classificar || classificador.classificar;
  const encontrado = await classificar(frase, cadastradas);
  if (!encontrado?.intencao && !pendente) return { reconhecido: false, motivo: 'intencao_nao_reconhecida' };
  if (encontrado?.intencao && encontrado.intencao.acao !== 'localizar_cliente') {
    return { reconhecido: false, motivo: 'acao_indisponivel' };
  }
  const resposta = [];
  if (encontrado?.intencao) sessoes.delete(telefone);
  const nome = normalizarNome(encontrado?.intencao ? encontrado.argumento : frase);
  if (!nome) {
    sessoes.set(telefone, { acao: 'localizar_cliente', expira: Date.now() + SESSAO_MS });
    resposta.push('Qual é o nome do cliente que deseja localizar?');
  } else {
    sessoes.delete(telefone);
    const encontrados = await busca(nome);
    const primeiros = Array.isArray(encontrados) ? encontrados.slice(0, LIMITE_CLIENTES_RESPOSTA) : [];
    const comTelefones = await completarTelefones(primeiros, deps.buscarCliente || clientesLegado.buscarCliente);
    resposta.push(...respostasClientes(nome, comTelefones));
  }
  for (const mensagem of resposta) await enviar({ telefone, mensagem });
  return { reconhecido: true, intencao: encontrado?.intencao?.nome || 'Localizar cliente', acao: 'localizar_cliente', resposta: resposta.join('\n\n') };
}
module.exports = { ACOES, preparar, listar, cadastrar, atualizar, excluir, identificar,
  respostasClientes, processarMensagem };
