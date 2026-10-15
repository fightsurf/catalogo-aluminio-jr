'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('../../../db/connection');
const produtoService = require('../produto/produto.service');
const zapi = require('../integracoes/zapi.service');

const MIGRATION = path.join(__dirname, '../../../db/sql/20261015_perfis_preco_comissoes.sql');
const TOKEN_RE = /^[a-zA-Z0-9_-]{32,64}$/;
const FONE_FABRICA = () => process.env.PERFIL_PRECO_WHATSAPP_FABRICA || '558399792085';
let schemaPromise;
function preparar() {
  if (!schemaPromise) {
    schemaPromise = pool.query(fs.readFileSync(MIGRATION, 'utf8')).catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function key() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('Configure ADMIN_SESSION_SECRET para criptografar os links dos perfis.');
  return crypto.createHash('sha256').update(`aluminio-jr/perfil-preco/v1/${secret}`).digest();
}
function criptografar(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString('base64url')).join('.');
}
function descriptografar(blob) {
  const [iv, tag, data] = String(blob).split('.').map(v => Buffer.from(v, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function telefone(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  const formatted = digits.startsWith('55') ? digits : `55${digits}`;
  if (!/^55\d{10,11}$/.test(formatted)) throw new Error('Informe telefone válido com DDD (10 ou 11 dígitos).');
  return formatted;
}
function dadosValidos(body, isUpdate = false) {
  const nome = String(body?.nome || '').trim();
  const tipo = String(body?.tipo || '');
  const valor = Number(body?.valor);
  if (!nome || nome.length > 120) throw new Error('Informe a identificação do perfil (até 120 caracteres).');
  if (!['percentual', 'fixo'].includes(tipo)) throw new Error('Tipo de acréscimo inválido.');
  if (!Number.isFinite(valor) || valor < 0 || valor > 100000 || (tipo === 'percentual' && valor > 1000)) {
    throw new Error('Acréscimo inválido. Percentual até 1000%; fixo até R$ 100.000.');
  }
  if (Math.round(valor * 100) !== valor * 100 && Math.abs(valor * 100 - Math.round(valor * 100)) > 0.000001) {
    throw new Error('O acréscimo admite no máximo duas casas decimais.');
  }
  return { nome, tipo, valor, telefone_vendedor: telefone(body?.telefone_vendedor), ...(isUpdate ? { ativo: body.ativo === true } : {}) };
}
const CAMPOS = 'id,nome,tipo,valor,telefone_vendedor,ativo,token_criptografado,criado_em,atualizado_em';
function publicoAdmin(row) {
  return { id: row.id, nome: row.nome, tipo: row.tipo, valor: Number(row.valor),
    telefone_vendedor: row.telefone_vendedor, ativo: row.ativo,
    token: descriptografar(row.token_criptografado), criado_em: row.criado_em, atualizado_em: row.atualizado_em };
}
async function listarAdmin() {
  await preparar();
  const {rows} = await pool.query(`SELECT ${CAMPOS} FROM perfis_preco_vendedor WHERE excluido_em IS NULL ORDER BY id DESC`);
  return rows.map(publicoAdmin);
}
async function criarAdmin(body) {
  const d = dadosValidos(body);
  await preparar();
  const token = crypto.randomBytes(32).toString('base64url');
  const {rows} = await pool.query(`INSERT INTO perfis_preco_vendedor
    (nome,tipo,valor,telefone_vendedor,token_hash,token_criptografado)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${CAMPOS}`,
    [d.nome,d.tipo,d.valor,d.telefone_vendedor,hash(token),criptografar(token)]);
  return publicoAdmin(rows[0]);
}
async function atualizarAdmin(id, body) {
  const d = dadosValidos(body, true);
  await preparar();
  const {rows} = await pool.query(`UPDATE perfis_preco_vendedor SET nome=$2,tipo=$3,valor=$4,
    telefone_vendedor=$5,ativo=$6,atualizado_em=NOW() WHERE id=$1 AND excluido_em IS NULL RETURNING ${CAMPOS}`,
  [id,d.nome,d.tipo,d.valor,d.telefone_vendedor,d.ativo]);
  if (!rows.length) throw new Error('Perfil não encontrado.');
  return publicoAdmin(rows[0]);
}
async function regenerarToken(id) {
  await preparar();
  const token = crypto.randomBytes(32).toString('base64url');
  const {rows} = await pool.query(`UPDATE perfis_preco_vendedor SET token_hash=$2,token_criptografado=$3,
    atualizado_em=NOW() WHERE id=$1 AND excluido_em IS NULL RETURNING ${CAMPOS}`,
  [id,hash(token),criptografar(token)]);
  if (!rows.length) throw new Error('Perfil não encontrado.');
  return publicoAdmin(rows[0]);
}
async function excluirAdmin(id) {
  const perfilId = Number(id);
  if (!Number.isSafeInteger(perfilId) || perfilId < 1) {
    const erro = new Error('Identificação de perfil inválida.'); erro.status = 400; throw erro;
  }
  await preparar();
  // Exclusão lógica: invalida os três links, remove o perfil do painel,
  // mas preserva o histórico financeiro e a integridade das chaves estrangeiras.
  const {rows} = await pool.query(`UPDATE perfis_preco_vendedor
    SET ativo=FALSE, excluido_em=NOW(), atualizado_em=NOW()
    WHERE id=$1 AND excluido_em IS NULL RETURNING id,nome`, [perfilId]);
  if (!rows.length) {
    const erro = new Error('Perfil não encontrado ou já excluído.'); erro.status = 404; throw erro;
  }
  return {id:rows[0].id, nome:rows[0].nome, excluido:true};
}
async function localizar(token) {
  if (!TOKEN_RE.test(String(token || ''))) {
    const e = new Error('Link de perfil inválido.'); e.status = 404; throw e;
  }
  await preparar();
  const {rows} = await pool.query('SELECT id,nome,tipo,valor,telefone_vendedor,ativo FROM perfis_preco_vendedor WHERE token_hash=$1 AND excluido_em IS NULL', [hash(token)]);
  if (!rows.length || !rows[0].ativo) {
    const e = new Error('Link inexistente ou desativado. Solicite um novo link à fábrica.'); e.status = 404; throw e;
  }
  return rows[0];
}
function emCentavos(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error('Preço de produto inválido.');
  return Math.round(n * 100);
}
function precoAjustadoCentavos(precoBase, perfil) {
  const base = emCentavos(precoBase);
  if (perfil.tipo === 'fixo') return base + Math.round(Number(perfil.valor) * 100);
  return Math.round(base * (1 + Number(perfil.valor) / 100));
}
function listaTipo(tipo) {
  if (!['catalogo', 'kit-feirinha', 'orcamento'].includes(tipo)) {
    const e = new Error('Tipo de catálogo inválido.'); e.status = 400; throw e;
  }
  return { apenasAtivos: tipo !== 'catalogo', perfil: tipo === 'catalogo' ? undefined : tipo };
}
// Expõe apenas os campos necessários para as três páginas; jamais envia preço-base nem parâmetros da comissão.
function produtoPublico(p, perfil) {
  return { id: p.id, nome: p.nome, preco: precoAjustadoCentavos(p.preco, perfil) / 100,
    foto: p.foto, foto_2:p.foto_2, foto_3:p.foto_3, foto_4:p.foto_4,
    foto_5:p.foto_5, foto_6:p.foto_6, fotos: p.fotos,
    categoria: p.categoria, categorias: p.categorias };
}
async function listarProdutos(token, tipo) {
  const perfil = await localizar(token);
  const itens = await produtoService.listar(listaTipo(tipo));
  return {perfil: { nome: perfil.nome }, produtos: itens.map(p => produtoPublico(p, perfil))};
}
function moeda(cents) { return (cents / 100).toFixed(2).replace('.', ','); }
function montarRelatorio(itens, total, modulo) {
  const quantidade = itens.reduce((s,p) => s + p.qtd,0);
  let relatorio = `📦 RELATÓRIO ALUMÍNIO JR - ${quantidade} ${quantidade === 1 ? 'ITEM ESCOLHIDO' : 'ITENS ESCOLHIDOS'}\n\n`;
  const medio = modulo === 'kit-feirinha' ? Math.round(total / quantidade) : 0;
  itens.forEach((p, i) => {
    const preco = modulo === 'kit-feirinha' ? medio : p.preco_venda_centavos;
    relatorio += `• ${p.nome} | QTD: ${p.qtd}\n  UNIT: R$ ${moeda(preco)}\n  SUBTOTAL: R$ ${moeda(preco * p.qtd)}`;
    if (i < itens.length - 1) relatorio += '\n\n';
  });
  return `${relatorio}\n\nValor total: R$ ${moeda(total)}`;
}
function montarComissao(itens, total, modulo, perfilNome) {
  const linhas = [`💼 COMISSÃO PREVISTA - ${modulo === 'orcamento' ? 'ORÇAMENTO' : 'KIT FEIRINHA'}`,`Perfil: ${perfilNome}`, ''];
  itens.forEach((p, i) => {
    if (i > 0) linhas.push(''); // Uma linha em branco entre os produtos.
    linhas.push(`• ${p.nome} | QTD: ${p.qtd}`);
    linhas.push(`  Comissão unitária: R$ ${moeda(p.preco_venda_centavos - p.preco_base_centavos)}`);
    linhas.push(`  Comissão do item: R$ ${moeda(p.comissao_centavos)}`);
  });
  linhas.push('', `COMISSÃO TOTAL: R$ ${moeda(total)}`);
  return linhas.join('\n');
}
function validarItens(recebidos) {
  if (!Array.isArray(recebidos) || !recebidos.length || recebidos.length > 120) throw new Error('Selecione de 1 a 120 produtos.');
  const ids = new Set();
  return recebidos.map(item => {
    const id = Number(item?.id), qtd = Number(item?.qtd);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(qtd) || qtd < 1 || qtd > 10000 || ids.has(id)) {
      throw new Error('Itens do pedido inválidos, repetidos ou quantidade fora do limite.');
    }
    ids.add(id);
    return {id, qtd};
  });
}
async function construirPedido(token, modulo, recebidos) {
  const perfil = await localizar(token);
  const filtros = listaTipo(modulo);
  const produtos = await produtoService.listar(filtros);
  const porId = new Map(produtos.map(p => [Number(p.id), p]));
  let totalBase = 0, totalVenda = 0, totalComissao = 0;
  const itens = validarItens(recebidos).map(item => {
    const p = porId.get(item.id);
    if (!p) throw new Error('Produto indisponível neste módulo. Atualize a página.');
    const base = emCentavos(p.preco), venda = precoAjustadoCentavos(p.preco,perfil);
    const comissao = (venda - base) * item.qtd;
    totalBase += base * item.qtd;
    totalVenda += venda * item.qtd;
    totalComissao += comissao;
    return { id:p.id, nome:p.nome, qtd:item.qtd, preco_base_centavos:base,
      preco_venda_centavos:venda, comissao_centavos:comissao };
  });
  return { perfil, itens, totalBase, totalVenda, totalComissao,
    relatorioPedido: montarRelatorio(itens,totalVenda,modulo),
    relatorioComissao: montarComissao(itens,totalComissao,modulo,perfil.nome) };
}
async function criarOuCarregarEnvio(token, body) {
  const modulo = String(body?.modulo || '');
  if (!['orcamento','kit-feirinha'].includes(modulo)) throw new Error('Módulo de envio inválido.');
  const chave = String(body?.chave || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(chave)) throw new Error('Identificador de envio inválido.');
  const perfil = await localizar(token);
  const itensSolicitados = validarItens(body?.itens);
  const fingerprint = hash(JSON.stringify({modulo, itens:itensSolicitados.sort((a,b)=>a.id-b.id)}));
  await preparar();
  const existente = await pool.query('SELECT id,fingerprint FROM perfis_preco_envios WHERE perfil_id=$1 AND chave_cliente=$2',[perfil.id,chave]);
  if (existente.rows.length) {
    if (existente.rows[0].fingerprint !== fingerprint) throw new Error('Este envio já foi iniciado com outros itens. Não altere a seleção até concluir ou conferir o envio anterior.');
    return existente.rows[0].id;
  }
  // Apenas pedidos NOVOS consultam os preços atuais. Retries preservam o snapshot original.
  const p = await construirPedido(token, modulo, itensSolicitados);
  const client = await pool.connect();
  let envio;
  try {
    await client.query('BEGIN');
    // Bloqueio por perfil impede corrida na limitação de uso dos links públicos.
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [92816, Number(p.perfil.id)]);
    const repeticao = await client.query('SELECT id,fingerprint FROM perfis_preco_envios WHERE perfil_id=$1 AND chave_cliente=$2', [p.perfil.id,chave]);
    if (repeticao.rows.length) {
      if (repeticao.rows[0].fingerprint !== fingerprint) throw new Error('Identificador reutilizado com itens diferentes.');
      envio = repeticao.rows[0].id;
    } else {
      const {rows: [limite]} = await client.query(`SELECT
        COUNT(*) FILTER (WHERE criado_em > NOW() - INTERVAL '1 minute')::int AS minuto,
        COUNT(*) FILTER (WHERE criado_em > NOW() - INTERVAL '1 day')::int AS dia
        FROM perfis_preco_envios WHERE perfil_id=$1`,[p.perfil.id]);
      if (limite.minuto >= 5 || limite.dia >= 150) {
        const error = new Error('Limite de envios alcançado. Aguarde ou contate a fábrica.'); error.status = 429; throw error;
      }
      const {rows} = await client.query(`INSERT INTO perfis_preco_envios
        (perfil_id,chave_cliente,fingerprint,modulo,itens,preco_base_centavos,preco_venda_centavos,
        comissao_centavos,relatorio_pedido,relatorio_comissao)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING id`,
        [p.perfil.id,chave,fingerprint,modulo,JSON.stringify(p.itens),p.totalBase,p.totalVenda,
         p.totalComissao,p.relatorioPedido,p.relatorioComissao]);
      envio = rows[0].id;
      const destinos = [...new Set([telefone(FONE_FABRICA()), telefone(p.perfil.telefone_vendedor)])];
      for (const destino of destinos) {
        for (const [idx,mensagem] of [p.relatorioPedido,p.relatorioComissao].entries()) {
          await client.query(`INSERT INTO perfis_preco_entregas (envio_id,telefone,ordem,mensagem)
          VALUES ($1,$2,$3,$4)`,[envio,destino,idx+1,mensagem]);
        }
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally {client.release();}
  return envio;
}

async function realizarEnvio(id) {
  const {rows} = await pool.query(`SELECT id,telefone,ordem,mensagem,situacao FROM perfis_preco_entregas
    WHERE envio_id=$1 ORDER BY telefone,ordem`, [id]);
  const incompletas = [];
  for (const entrega of rows) {
    if (entrega.situacao !== 'pendente') {
      if (entrega.situacao !== 'aceito') incompletas.push(entrega);
      continue;
    }
    // Não tentar a comissão antes da confirmação de aceite do pedido para o mesmo destinatário.
    if (entrega.ordem === 2) {
      const {rows:[pedido]} = await pool.query('SELECT situacao FROM perfis_preco_entregas WHERE envio_id=$1 AND telefone=$2 AND ordem=1',[id,entrega.telefone]);
      if (pedido?.situacao !== 'aceito') { incompletas.push(entrega); continue; }
    }
    const {rows: claimed} = await pool.query(`UPDATE perfis_preco_entregas SET situacao='enviando',iniciado_em=NOW()
      WHERE id=$1 AND situacao='pendente' RETURNING id`,[entrega.id]);
    if (!claimed.length) { incompletas.push(entrega); continue; }
    try {
      await zapi.enviarTexto({telefone:entrega.telefone,mensagem:entrega.mensagem});
      await pool.query(`UPDATE perfis_preco_entregas SET situacao='aceito',concluido_em=NOW(),erro=NULL WHERE id=$1`,[entrega.id]);
    } catch (err) {
      // Um timeout pode ter sido aceito pelo provedor: não reenviar cegamente.
      await pool.query(`UPDATE perfis_preco_entregas SET situacao='incerto',erro=$2,concluido_em=NOW() WHERE id=$1`,[entrega.id,String(err.message).slice(0,400)]);
      incompletas.push(entrega);
    }
  }
  const {rows: situacoes} = await pool.query('SELECT telefone,ordem,situacao FROM perfis_preco_entregas WHERE envio_id=$1 ORDER BY telefone,ordem',[id]);
  return { id, concluido: situacoes.every(s => s.situacao === 'aceito'), entregas:situacoes };
}
async function enviar(token, body) {
  const id = await criarOuCarregarEnvio(token, body);
  return realizarEnvio(id);
}
async function historico() {
  await preparar();
  const {rows} = await pool.query(`SELECT e.id,e.criado_em,e.modulo,e.preco_venda_centavos,e.comissao_centavos,
    p.nome AS perfil, COALESCE(json_agg(json_build_object('telefone',d.telefone,'ordem',d.ordem,
    'situacao',d.situacao,'erro',d.erro) ORDER BY d.telefone,d.ordem) FILTER (WHERE d.id IS NOT NULL),'[]'::json) AS entregas
    FROM perfis_preco_envios e JOIN perfis_preco_vendedor p ON p.id=e.perfil_id
    LEFT JOIN perfis_preco_entregas d ON d.envio_id=e.id
    GROUP BY e.id,p.nome ORDER BY e.id DESC LIMIT 100`);
  return rows.map(r => ({...r, preco_venda: Number(r.preco_venda_centavos)/100,
    comissao: Number(r.comissao_centavos)/100}));
}
module.exports = {preparar,listarAdmin,criarAdmin,atualizarAdmin,regenerarToken,excluirAdmin,localizar,
  listarProdutos,enviar,historico,precoAjustadoCentavos,construirPedido};
