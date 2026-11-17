'use strict';
const express = require('express');
const crypto = require('crypto');
const pool = require('../../../db/connection');
const { chave, normalizarLinha, montarCamposTransportadora, classificar, combinarTelefones, combinarObservacao, escolherTransportadora } = require('../../services/logistica/importacaoExcursoesUtils');
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
    client.query('SELECT t.id, t.nome, t.telefone, t.telefone_principal, t.observacao, t.cidade_id, c.nome AS cidade_nome, c.estado AS cidade_estado FROM transportadoras t LEFT JOIN cidades c ON c.id = t.cidade_id'),
    client.query('SELECT id, nome, estado FROM cidades')
  ]);
  const porNomeUf = new Map(), porNome = new Map();
  for (const cidade of cidades.rows) {
    const nome = chave(cidade.nome), uf = String(cidade.estado || '').toUpperCase();
    const indice = nome + '|' + uf;
    if (!porNomeUf.has(indice)) porNomeUf.set(indice, []);
    porNomeUf.get(indice).push(cidade);
    if (!porNome.has(nome)) porNome.set(nome, []);
    porNome.get(nome).push(cidade);
  }
  const santaCruz = porNomeUf.get(chave('Santa Cruz do Capibaribe') + '|PE') || [];
  const cidadeCadastroId = santaCruz.length ? santaCruz[0].id : null;
  const itens = registros.map((registro, indice) => {
    const classificado = classificar(registro, transportadoras.rows);
    const existente = escolherTransportadora(registro, transportadoras.rows);
    const encontradas = [], criar = [], naoEncontradas = [], ufInferida = [];
    const vistas = new Set();
    function incluir(local) {
      const uf = String(local.uf || '').toUpperCase();
      const key = chave(local.nome) + '|' + uf;
      if (!local.nome || !/^[A-Z]{2}$/.test(uf) || vistas.has(key)) return;
      vistas.add(key);
      const coincidencias = porNomeUf.get(key) || [];
      if (coincidencias.length) {
        encontradas.push({ id: coincidencias[0].id, nome: local.nome, uf });
      } else {
        criar.push({ nome: local.nome, uf });
      }
    }
    for (const local of registro.cidades) incluir(local);
    for (const nome of registro.semUf) {
      const coincidencias = porNome.get(chave(nome)) || [];
      const estados = new Set(coincidencias.map(x => String(x.estado || '').toUpperCase()));
      if (estados.size === 1 && coincidencias.length) {
        incluir({ nome: coincidencias[0].nome, uf: coincidencias[0].estado });
      } else if (registro.origemLocalidade && registro.origemLocalidade.uf) {
        // UF ausente na rota: assume a UF da origem, e informa a inferencia na previa.
        incluir({ nome, uf: registro.origemLocalidade.uf });
        ufInferida.push(nome + ' - ' + registro.origemLocalidade.uf);
      } else {
        naoEncontradas.push(nome + ' (UF nao informada; necessario informar a UF no arquivo)');
      }
    }
    return {
      indice, ...registro,
      situacao: existente ? 'existente' : classificado.situacao,
      candidatos: classificado.candidatos,
      transportadoraIdSugerida: existente ? existente.id : null,
      cidadesEncontradas: encontradas,
      cidadesParaCriar: criar,
      cidadesNaoEncontradas: naoEncontradas,
      cidadesUfInferida: ufInferida,
      cidadeCadastroId
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
          !['automatico', 'criar', 'vincular'].includes(d.acao) || indices.has(d.indice) ||
          (d.acao === 'vincular' && !Number.isInteger(Number(d.transportadora_id)))) {
        return res.status(400).json({ erro: 'Selecao invalida ou duplicada.' });
      }
      indices.add(d.indice);
    }
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7051181)');
    const { itens, existentes } = await preparar(client, registros);
    const rCidades = await client.query('SELECT id, nome, estado FROM cidades');
    const idsCidades = new Map();
    for (const c of rCidades.rows) {
      const key = chave(c.nome) + '|' + String(c.estado || '').toUpperCase();
      if (!idsCidades.has(key)) idsCidades.set(key, c.id);
    }
    const resumo = {
      criadas: 0, vinculadas: 0, atualizadas: 0, telefonesAdicionados: 0,
      cidadesCriadas: 0, cidadesVinculadas: 0, puladas: 0,
      cidadesNaoLocalizadas: 0, registros: []
    };
    async function garantirCidade(nome, uf) {
      const key = chave(nome) + '|' + String(uf).toUpperCase();
      if (idsCidades.has(key)) return idsCidades.get(key);
      const criada = await client.query(
        'INSERT INTO cidades (nome, estado) VALUES ($1, $2) RETURNING id', [nome, uf]
      );
      const id = criada.rows[0].id;
      idsCidades.set(key, id);
      resumo.cidadesCriadas++;
      return id;
    }
    // A cidade fixa e criada uma unica vez se estiver ausente.
    const cidadeCadastroId = await garantirCidade('Santa Cruz do Capibaribe', 'PE');
    for (const decisao of decisoes) {
      const item = itens[decisao.indice];
      if (!item.nome || item.nome.length < 2) {
        resumo.puladas++;
        resumo.registros.push({ indice: item.indice, nome: item.nome, status: 'nome_invalido' });
        continue;
      }
      let cadastro = null;
      if (decisao.acao === 'vincular') {
        const idEscolhido = Number(decisao.transportadora_id);
        const permitido = item.candidatos.some(c => Number(c.id) === idEscolhido) ||
          Number(item.transportadoraIdSugerida) === idEscolhido;
        cadastro = permitido ? existentes.find(t => Number(t.id) === idEscolhido) : null;
        if (!cadastro) {
          const erro = new Error('Transportadora selecionada nao corresponde a previa: ' + item.nome);
          erro.status = 400; throw erro;
        }
      } else if (decisao.acao === 'automatico') {
        cadastro = escolherTransportadora(item, existentes);
      } else if (decisao.acao === 'criar') {
        // Evita duplicar correspondencias unicas, inclusive linhas repetidas da planilha.
        cadastro = escolherTransportadora(item, existentes);
      }
      let id, status, adicionados = 0;
      if (cadastro) {
        id = cadastro.id;
        const tels = combinarTelefones(cadastro, item.telefones);
        const obs = combinarObservacao(cadastro.observacao, item.destino);
        const cidadeId = cadastro.cidade_id || cidadeCadastroId;
        await client.query(
          'UPDATE transportadoras SET telefone = $1, telefone_principal = $2, observacao = $3, cidade_id = $4 WHERE id = $5',
          [tels.telefone, tels.telefone_principal, obs, cidadeId, id]
        );
        Object.assign(cadastro, { telefone: tels.telefone, telefone_principal: tels.telefone_principal,
          observacao: obs, cidade_id: cidadeId });
        adicionados = tels.adicionados;
        resumo.vinculadas++;
        resumo.atualizadas++;
        status = 'atualizada';
      } else {
        const dados = montarCamposTransportadora(item);
        const nova = await client.query(
          'INSERT INTO transportadoras (nome, telefone, telefone_principal, observacao, cidade_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [dados.nome, dados.telefone, dados.telefone_principal, dados.observacao, cidadeCadastroId]
        );
        id = nova.rows[0].id;
        existentes.push({ id, ...dados, cidade_id: cidadeCadastroId });
        adicionados = item.telefones.length;
        resumo.criadas++;
        status = 'criada';
      }
      resumo.telefonesAdicionados += adicionados;
      let vinculadas = 0;
      for (const cidade of [...item.cidadesEncontradas, ...item.cidadesParaCriar]) {
        const cidadeId = await garantirCidade(cidade.nome, cidade.uf);
        const vinculo = await client.query(
          'INSERT INTO transportadora_cidade (transportadora_id, cidade_id, observacao) VALUES ($1, $2, NULL) ON CONFLICT (transportadora_id, cidade_id) DO NOTHING RETURNING cidade_id',
          [id, cidadeId]
        );
        vinculadas += vinculo.rowCount;
      }
      resumo.cidadesVinculadas += vinculadas;
      resumo.cidadesNaoLocalizadas += item.cidadesNaoEncontradas.length;
      resumo.registros.push({
        indice: item.indice, nome: item.nome, status, transportadora_id: id,
        telefones_adicionados: adicionados, cidades_adicionadas: vinculadas,
        cidades_nao_localizadas: item.cidadesNaoEncontradas, cidades_uf_inferida: item.cidadesUfInferida
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
