'use strict';
const express = require('express');
const crypto = require('crypto');
const pool = require('../../../db/connection');
const { chave, normalizarLinha, classificar } = require('../../services/logistica/importacaoExcursoesUtils');
const router = express.Router();
const { coletarExcursoes } = require('../../services/logistica/coletorModaCenter.service');

let coletaEmAndamento = false;
let ultimaColeta = 0;
const INTERVALO_COLETA_MS = 90 * 1000;

// Nao ha crawler: a origem deve ser uma planilha obtida com autorizacao.
const FONTE = 'Moda Center - arquivo autorizado';
const MAX_LINHAS = 1000;
const MAX_BYTES = 1600000;
function validarLinhas(body) {
  const linhas = body && body.rows;
  if (!Array.isArray(linhas) || !linhas.length || linhas.length > MAX_LINHAS) {
    const e = new Error('Informe entre 1 e 1000 registros.'); e.status = 400; throw e;
  }
  if (Buffer.byteLength(JSON.stringify(linhas)) > MAX_BYTES) {
    const e = new Error('Arquivo excede o limite de importacao.'); e.status = 413; throw e;
  }
  return linhas.map(normalizarLinha);
}
function assinatura(registros, validade) {
  const segredo = process.env.ADMIN_SESSION_SECRET;
  if (!segredo) throw new Error('Segredo de sessao administrativa nao configurado.');
  const hash = crypto.createHash('sha256').update(JSON.stringify(registros)).digest('hex');
  return crypto.createHmac('sha256', segredo).update(validade + ':' + hash).digest('hex');
}
function tokenPreview(registros) {
  const validade = String(Date.now() + 20 * 60 * 1000);
  return validade + ':' + assinatura(registros, validade);
}
function validarToken(registros, token) {
  const partes = String(token || '').split(':');
  if (partes.length !== 2 || !/^\d{13}$/.test(partes[0]) ||
      Number(partes[0]) < Date.now() || Number(partes[0]) > Date.now() + 21 * 60000) return false;
  const esperado = assinatura(registros, partes[0]);
  const recebido = partes[1];
  if (!/^[a-f0-9]{64}$/.test(recebido)) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
}
async function preparar(client, registros) {
  const [transportadoras, cidades] = await Promise.all([
    client.query('SELECT t.id, t.nome, t.telefone, t.telefone_principal, c.nome AS cidade_nome, c.estado AS cidade_estado FROM transportadoras t LEFT JOIN cidades c ON c.id = t.cidade_id'),
    client.query('SELECT id, nome, estado FROM cidades')
  ]);
  const mapa = new Map();
  for (const c of cidades.rows) {
    const chaveCidade = chave(c.nome) + '|' + String(c.estado).toUpperCase();
    if (!mapa.has(chaveCidade)) mapa.set(chaveCidade, []);
    mapa.get(chaveCidade).push(c);
  }
  const vistos = new Set();
  const itens = registros.map((registro, indice) => {
    const encontrado = classificar(registro, transportadoras.rows);
    const identidade = chave(registro.nome) + '|' + chave(registro.origem);
    if (vistos.has(identidade)) encontrado.situacao = 'duplicado_arquivo';
    vistos.add(identidade);
    const encontradas = [], naoEncontradas = [];
    for (const local of registro.cidades) {
      const encontrados = mapa.get(chave(local.nome) + '|' + local.uf) || [];
      if (encontrados.length === 1) {
        encontradas.push({ id: encontrados[0].id, nome: local.nome, uf: local.uf });
      } else {
        naoEncontradas.push(local.nome + ' - ' + local.uf + (encontrados.length ? ' (ambiguo)' : ''));
      }
    }
    naoEncontradas.push(...registro.semUf.map(s => s + ' (UF ausente)'));
    const origemLocal = registro.origemLocalidade;
    const cidadesOrigem = origemLocal ? (mapa.get(chave(origemLocal.nome) + '|' + origemLocal.uf) || []) : [];
    return {
      indice, ...registro, situacao: encontrado.situacao, candidatos: encontrado.candidatos,
      cidadesEncontradas: encontradas, cidadesNaoEncontradas: naoEncontradas,
      origemCidadeId: cidadesOrigem.length === 1 ? cidadesOrigem[0].id : null
    };
  });
  return { itens, existentes: transportadoras.rows };
}
function responderErro(res, erro) {
  console.error('[importacao-logistica]', erro);
  res.status(erro.status || 500).json({ erro: erro.status ? erro.message : 'Erro ao processar a importacao.' });
}
// A coleta nao grava dados. A licenca para utilizacao comercial deve ser confirmada pelo administrador.
router.post('/coletar', async (req, res) => {
  if (req.body?.autorizaColeta !== true) {
    return res.status(400).json({
      erro: 'Confirme sua autorizacao do titular dos dados para copia e uso comercial.'
    });
  }
  if (coletaEmAndamento) {
    return res.status(409).json({ erro: 'Ja existe uma coleta em andamento. Aguarde.' });
  }
  if (Date.now() - ultimaColeta < INTERVALO_COLETA_MS) {
    return res.status(429).json({ erro: 'Aguarde 90 segundos entre coletas para reduzir requisicoes ao site.' });
  }
  coletaEmAndamento = true;
  ultimaColeta = Date.now();
  try {
    const resultado = await coletarExcursoes();
    res.set('Cache-Control', 'no-store');
    return res.json({
      origem: 'Moda Center - listagem publica',
      ...resultado,
      aviso_uso: 'Dados coletados para revisao; nao foram gravados no banco.'
    });
  } catch (erro) {
    return responderErro(res, erro);
  } finally {
    coletaEmAndamento = false;
  }
});

router.post('/previa', async (req, res) => {
  try {
    const registros = validarLinhas(req.body);
    const dados = await preparar(pool, registros);
    res.set('Cache-Control', 'no-store');
    return res.json({
      fonte: FONTE,
      total: dados.itens.length,
      token: tokenPreview(registros),
      itens: dados.itens
    });
  } catch (erro) { return responderErro(res, erro); }
});
router.post('/confirmar', async (req, res) => {
  let client;
  try {
    const registros = validarLinhas(req.body);
    if (!validarToken(registros, req.body.token)) {
      return res.status(409).json({ erro: 'Previa vencida ou planilha modificada. Gere uma nova previa.' });
    }
    const decisoes = Array.isArray(req.body.decisoes) ? req.body.decisoes : [];
    if (!decisoes.length || decisoes.length > registros.length) {
      return res.status(400).json({ erro: 'Selecione registros na previa.' });
    }
    const indices = new Set();
    for (const d of decisoes) {
      if (!Number.isInteger(d.indice) || d.indice < 0 || d.indice >= registros.length ||
          !['criar', 'vincular'].includes(d.acao) || indices.has(d.indice)) {
        return res.status(400).json({ erro: 'Selecao invalida ou duplicada.' });
      }
      indices.add(d.indice);
    }
    client = await pool.connect();
    await client.query('BEGIN');
    // Serializa importacoes simultaneas para evitar duplicacao na mesma origem.
    await client.query('SELECT pg_advisory_xact_lock(7051181)');
    const { itens, existentes } = await preparar(client, registros);
    const resumo = { criadas: 0, vinculadas: 0, cidadesVinculadas: 0, puladas: 0, cidadesNaoLocalizadas: 0, registros: [] };
    for (const decisao of decisoes) {
      const item = itens[decisao.indice];
      let id = null;
      let acao = decisao.acao;
      if (item.situacao === 'invalido' || item.situacao === 'duplicado_arquivo') {
        resumo.puladas++; resumo.registros.push({ indice: item.indice, nome: item.nome, status: 'ignorado' }); continue;
      }
      // Sugestoes por prefixo nao sao duplicatas confirmadas. Aceita criacao revisada
      // apenas se nao houver outro cadastro com nome exato ou telefone igual.
      const candidatosAtuais = classificar(item, existentes).candidatos;
      const duplicadoForte = candidatosAtuais.some(c => c.tipo === 'nome' || c.tipo === 'telefone');
      const criarPermitido = acao === 'criar' && !duplicadoForte &&
        (item.situacao === 'novo' ||
          (item.situacao === 'revisar' && decisao.revisao_confirmada === true));
      if (criarPermitido) {
        const nota = [
          'Origem: ' + FONTE,
          item.origem ? 'Cidade de origem: ' + item.origem : '',
          item.destino ? 'Destino/estacionamento: ' + item.destino : '',
          item.tipo ? 'Categoria informada: ' + item.tipo : ''
        ].filter(Boolean).join('\n');
        const criacao = await client.query(
          'INSERT INTO transportadoras (nome, telefone, telefone_principal, observacao, cidade_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [item.nome, item.telefones.join(' / ') || null, item.telefones[0] || null, nota, item.origemCidadeId]
        );
        id = criacao.rows[0].id;
        existentes.push({ id, nome: item.nome, telefone: item.telefones.join(' / '), telefone_principal: item.telefones[0] || '' });
        resumo.criadas++;
      } else if (acao === 'vincular') {
        const selecionado = Number(decisao.transportadora_id);
        if (item.candidatos.some(c => Number(c.id) === selecionado) &&
            existentes.some(t => Number(t.id) === selecionado)) {
          id = selecionado;
          resumo.vinculadas++;
        }
      }
      if (!id) {
        resumo.puladas++; resumo.registros.push({ indice: item.indice, nome: item.nome, status: 'revisar' }); continue;
      }
      let quantidade = 0;
      for (const cidade of item.cidadesEncontradas) {
        const insercao = await client.query(
          'INSERT INTO transportadora_cidade (transportadora_id, cidade_id, observacao) VALUES ($1, $2, NULL) ON CONFLICT (transportadora_id, cidade_id) DO NOTHING RETURNING cidade_id',
          [id, cidade.id]
        );
        quantidade += insercao.rowCount;
      }
      resumo.cidadesVinculadas += quantidade;
      resumo.cidadesNaoLocalizadas += item.cidadesNaoEncontradas.length;
      resumo.registros.push({
        indice: item.indice, nome: item.nome, status: acao, transportadora_id: id,
        cidades_adicionadas: quantidade, cidades_nao_localizadas: item.cidadesNaoEncontradas
      });
    }
    await client.query(
      "CREATE TABLE IF NOT EXISTS logistica_importacoes_autorizadas (id BIGSERIAL PRIMARY KEY, origem TEXT NOT NULL, usuario TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), resumo JSONB NOT NULL)"
    );
    const gravacao = await client.query(
      'INSERT INTO logistica_importacoes_autorizadas (origem, usuario, resumo) VALUES ($1, $2, $3::jsonb) RETURNING id',
      [FONTE, req.adminUser || 'admin', JSON.stringify(resumo)]
    );
    await client.query('COMMIT');
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, importacao_id: gravacao.rows[0].id, resumo });
  } catch (erro) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return responderErro(res, erro);
  } finally { if (client) client.release(); }
});
router.get('/historico', async (_req, res) => {
  try {
    const existe = await pool.query("SELECT to_regclass('public.logistica_importacoes_autorizadas') AS tabela");
    if (!existe.rows[0].tabela) return res.json([]);
    const r = await pool.query('SELECT id, origem, usuario, criado_em, resumo FROM logistica_importacoes_autorizadas ORDER BY id DESC LIMIT 20');
    return res.json(r.rows);
  } catch (erro) { return responderErro(res, erro); }
});
module.exports = router;
