'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../../../../db/connection');
const semanasService = require('./semanas.service');
const whatsappService = require('../../whatsapp/envio-whatsapp.service');

let inicializacao;
function erro(mensagem, statusCode = 400) {
  const e = new Error(mensagem);
  e.statusCode = statusCode;
  return e;
}
function idPositivo(v, nome) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw erro(`${nome} inválido.`);
  return n;
}
async function garantirEstrutura() {
  if (!inicializacao) {
    inicializacao = (async () => {
      const arquivo = path.resolve(__dirname, '../../../../db/sql/20261023_produtos_fornecedores_semana.sql');
      await pool.query(fs.readFileSync(arquivo, 'utf8'));
    })().catch(e => { inicializacao = null; throw e; });
  }
  return inicializacao;
}
async function resumoExistente(semanaId) {
  const resumo = await semanasService.buscarResumoSemana(semanaId);
  if (!resumo) throw erro('Semana não encontrada.', 404);
  return resumo;
}
function codigoLegado(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function itensValidos(resumo) {
  return (Array.isArray(resumo.itens) ? resumo.itens : [])
    .filter(x => Number(x.quantidade_a_produzir) > 0)
    .map(x => ({ item: codigoLegado(x.item), descricao: String(x.descricao || '').trim(), quantidade: Number(x.quantidade_a_produzir) }));
}
async function montarResumoAssociado(semanaId) {
  await garantirEstrutura();
  const resumo = await resumoExistente(semanaId);
  const itens = itensValidos(resumo);
  const codigos = [...new Set(itens.map(x => x.item).filter(Boolean))];
  const [fornecedoresResult, produtosResult, enviosResult] = await Promise.all([
    pool.query(`SELECT f.id, f.nome, f.telefone FROM fornecedores f ORDER BY f.nome ASC, f.id ASC`),
    codigos.length ? pool.query(`
      SELECT p.id AS produto_id, p.item_legado, p.nome AS produto_nome,
             p.fornecedor_id, f.nome AS fornecedor_nome
      FROM produtos p
      LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.item_legado = ANY($1::bigint[])
      ORDER BY p.item_legado, p.id
    `, [codigos]) : Promise.resolve({ rows: [] }),
    pool.query(`
      SELECT DISTINCT ON (fornecedor_id) fornecedor_id, id, status, criado_em, erro
      FROM semanas_fornecedores_envios
      WHERE semana_id = $1
      ORDER BY fornecedor_id, criado_em DESC, id DESC
    `, [semanaId])
  ]);
  const porLegado = new Map();
  for (const p of produtosResult.rows) {
    const key = codigoLegado(p.item_legado);
    if (!porLegado.has(key)) porLegado.set(key, []);
    porLegado.get(key).push(p);
  }
  const itensAssociados = itens.map(item => {
    const produtos = porLegado.get(item.item) || [];
    const produto = produtos.length === 1 ? produtos[0] : null;
    return {
      ...item,
      produto_id: produto ? Number(produto.produto_id) : null,
      fornecedor_id: produto?.fornecedor_id == null ? null : Number(produto.fornecedor_id),
      fornecedor_nome: produto?.fornecedor_nome || null,
      situacao_vinculo: produtos.length > 1 ? 'ambiguo' : produto ? 'ok' : 'nao_encontrado'
    };
  });
  return {
    semana: resumo.semana,
    itens: itensAssociados,
    fornecedores: fornecedoresResult.rows.map(f => ({ id: Number(f.id), nome: f.nome, telefone: f.telefone })),
    envios: enviosResult.rows.map(e => ({ ...e, id: Number(e.id), fornecedor_id: Number(e.fornecedor_id) }))
  };
}

async function salvarAssociacoes(semanaId, dados) {
  const fornecedorId = idPositivo(dados?.fornecedor_id, 'Fornecedor');
  if (!Array.isArray(dados?.produtos_ids)) throw erro('Informe os produtos selecionados.');
  const selecionados = [...new Set(dados.produtos_ids.map(v => idPositivo(v, 'Produto')))];
  const atual = await montarResumoAssociado(semanaId);
  const fornecedor = atual.fornecedores.find(f => f.id === fornecedorId);
  if (!fornecedor) throw erro('Fornecedor não encontrado.', 404);
  const validos = new Set(atual.itens.filter(x => x.situacao_vinculo === 'ok').map(x => x.produto_id));
  if (selecionados.some(id => !validos.has(id))) {
    throw erro('Há produtos não presentes ou sem vínculo único no resumo da semana. Atualize o modal.', 409);
  }
  const atualDoFornecedor = atual.itens.filter(x => x.fornecedor_id === fornecedorId && x.produto_id).map(x => x.produto_id);
  // Cada salvamento altera somente os produtos deste fornecedor e os novos marcados.
  const idsAfetados = [...new Set([...atualDoFornecedor, ...selecionados])];
  if (!idsAfetados.length) return { alterados: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existe = await client.query('SELECT id FROM fornecedores WHERE id = $1 FOR KEY SHARE', [fornecedorId]);
    if (!existe.rowCount) throw erro('Fornecedor não encontrado.', 404);
    const encontrados = await client.query('SELECT id, fornecedor_id FROM produtos WHERE id = ANY($1::int[]) FOR UPDATE', [idsAfetados]);
    if (encontrados.rowCount !== idsAfetados.length) throw erro('Cadastro alterado por outra operação. Atualize o modal.', 409);
    // Não apagar a escolha de outro usuário que mudou o fornecedor após a abertura do modal.
    const esperado = new Map(atual.itens.filter(x => x.produto_id).map(x => [x.produto_id, x.fornecedor_id]));
    if (encontrados.rows.some(p => Number(p.fornecedor_id || 0) !== Number(esperado.get(Number(p.id)) || 0))) {
      throw erro('A associação de um produto mudou. Atualize o modal antes de salvar.', 409);
    }
    const marcados = new Set(selecionados);
    for (const produto of encontrados.rows) {
      const produtoId = Number(produto.id);
      const destino = marcados.has(produtoId) ? fornecedorId : null;
      if (Number(produto.fornecedor_id || 0) !== Number(destino || 0)) {
        await client.query('UPDATE produtos SET fornecedor_id = $1 WHERE id = $2', [destino, produtoId]);
      }
    }
    await client.query('COMMIT');
    return { alterados: idsAfetados.length, fornecedor_id: fornecedorId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
function formatarData(valor) {
  if (!valor) return '-';
  if (valor instanceof Date) return `${String(valor.getUTCDate()).padStart(2, '0')}/${String(valor.getUTCMonth()+1).padStart(2, '0')}/${valor.getUTCFullYear()}`;
  const s = String(valor);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function formatarQtd(n) { return Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }
function telefoneValido(telefone) {
  let numero = String(telefone || '').replace(/\D/g, '');
  if (/^\d{10,11}$/.test(numero)) numero = '55' + numero;
  if (!/^55\d{10,11}$/.test(numero)) throw erro('WhatsApp do fornecedor inválido. Corrija o cadastro com DDD (e DDI, se necessário).');
  return numero;
}
function mensagemFornecedor(resumo, fornecedor, itens) {
  const s = resumo.semana;
  const total = itens.reduce((sum,x) => sum+x.quantidade,0);
  return [
    '*ALUMÍNIO JR - NECESSIDADES DE PRODUÇÃO*',
    `Semana: ${formatarData(s.data_inicial)} a ${formatarData(s.data_final)}`,
    `Fornecedor: ${fornecedor.nome}`,
    '',
    '*Relação de produtos:*',
    ...itens.map((item,i) => `${String(i+1).padStart(2,'0')}. ${item.descricao || '-'}\nQuantidade: ${formatarQtd(item.quantidade)} unidades`),
    '',
    `Total: ${formatarQtd(total)} unidades`,
    '',
    'Aguardamos confirmação de disponibilidade.'
  ].join('\n');
}
async function prepararEnvio(semanaId, fornecedorId) {
  const resumo = await montarResumoAssociado(semanaId);
  const fornecedor = resumo.fornecedores.find(f => f.id === fornecedorId);
  if (!fornecedor) throw erro('Fornecedor não encontrado.', 404);
  const itens = resumo.itens.filter(x => x.fornecedor_id === fornecedorId)
    .sort((a,b) => a.descricao.localeCompare(b.descricao,'pt-BR'));
  if (!itens.length) throw erro('Nenhum produto associado a esse fornecedor nesta semana.');
  const telefone = telefoneValido(fornecedor.telefone);
  const mensagem = mensagemFornecedor(resumo, fornecedor, itens);
  const conteudo_hash = crypto.createHash('sha256').update(`${telefone}\n${mensagem}`).digest('hex');
  return { fornecedor, semana: resumo.semana, telefone, mensagem, conteudo_hash, itens: itens.length };
}
async function enviar(semanaId, fornecedorId, conteudoHashEsperado) {
  await garantirEstrutura();
  if (!/^[a-f0-9]{64}$/.test(String(conteudoHashEsperado || ''))) {
    throw erro('Solicite a prévia antes de confirmar o envio.');
  }
  const preparado = await prepararEnvio(semanaId, fornecedorId);
  if (preparado.conteudo_hash !== conteudoHashEsperado) {
    throw erro('A lista ou o telefone do fornecedor mudou após a prévia. Confira novamente antes de enviar.', 409);
  }
  // Criar reserva ANTES da chamada externa, sob lock, impedindo cliques duplos.
  const client = await pool.connect();
  let registro;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM fornecedores WHERE id=$1 FOR UPDATE', [fornecedorId]);
    const duplicados = await client.query(`
      SELECT status FROM semanas_fornecedores_envios
      WHERE semana_id=$1 AND fornecedor_id=$2
        AND (conteudo_hash=$3 OR status='enviando')
      ORDER BY id DESC LIMIT 1
    `, [semanaId,fornecedorId,preparado.conteudo_hash]);
    if (duplicados.rows.length) {
      throw erro(`Envio já registrado (${duplicados.rows[0].status}). Confira o WhatsApp antes de tentar novamente.`, 409);
    }
    const r = await client.query(`
      INSERT INTO semanas_fornecedores_envios
      (semana_id, fornecedor_id, conteudo_hash, telefone, mensagem, status)
      VALUES ($1,$2,$3,$4,$5,'enviando') RETURNING id
    `, [semanaId, fornecedorId, preparado.conteudo_hash, preparado.telefone, preparado.mensagem]);
    registro = Number(r.rows[0].id);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  try {
    const retorno = await whatsappService.enviarMensagem({ telefone: preparado.telefone, mensagem: preparado.mensagem });
    // A resposta 2xx é apenas aceitação da Z-API; não significa entrega/leitura.
    const zapi = retorno.zapi || null;
    if (zapi?.error || zapi?.success === false) throw new Error(`Z-API não confirmou aceitação: ${JSON.stringify(zapi).slice(0,400)}`);
    await pool.query(`UPDATE semanas_fornecedores_envios
       SET status='aceito', retorno_zapi=$1::jsonb, atualizado_em=NOW() WHERE id=$2`,
       [JSON.stringify(zapi), registro]);
    return { status: 'aceito', fornecedor: preparado.fornecedor.nome, telefone: preparado.telefone, total_itens: preparado.itens, registro_id: registro };
  } catch (e) {
    // Não reenviar automaticamente: a requisição pode ter sido aceita antes do erro.
    await pool.query(`UPDATE semanas_fornecedores_envios
      SET status='incerto', erro=$1, atualizado_em=NOW() WHERE id=$2`, [e.message, registro]).catch(dbErro => console.error('Falha ao registrar envio incerto:', dbErro));
    throw erro(`Envio não confirmado (registro ${registro}). Verifique a Z-API/WhatsApp antes de qualquer nova tentativa: ${e.message}`, 502);
  }
}
module.exports = { montarResumoAssociado, salvarAssociacoes, prepararEnvio, enviar };
