'use strict';

const cheerio = require('cheerio');
const { chave, telefones } = require('./importacaoExcursoesUtils');

const BASE = 'https://omodacenter.com.br/c/excursoes';
const HOST = 'omodacenter.com.br';
const MAX_PAGINAS = 45;
const MAX_REGISTROS = 1000;
const PAUSA_MS = 400;
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

function textoLimpo(valor) {
  return String(valor || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function trechoEntre(texto, inicio, fim) {
  const pos = texto.toLowerCase().indexOf(inicio.toLowerCase());
  if (pos === -1) return '';
  let valor = texto.slice(pos + inicio.length);
  if (fim) {
    const limite = valor.toLowerCase().indexOf(fim.toLowerCase());
    if (limite >= 0) valor = valor.slice(0, limite);
  }
  return textoLimpo(valor);
}

// Apenas lista publica. Nunca envia os registros diretamente ao PostgreSQL.
function extrairPagina(html) {
  const $ = cheerio.load(html);
  const registros = [];
  for (const elemento of $('h3').toArray()) {
    const nome = textoLimpo($(elemento).text());
    if (!nome || nome.length > 150) continue;
    let card = null;
    let ancestral = $(elemento).parent();
    for (let nivel = 0; nivel < 9 && ancestral.length; nivel++, ancestral = ancestral.parent()) {
      if (ancestral.find('h3').length !== 1) break;
      const conteudo = textoLimpo(ancestral.text());
      if (conteudo.length > 15000) break;
      if (/Origem\s*:/i.test(conteudo) && /Destino\s*:/i.test(conteudo)) card = ancestral;
    }
    if (!card) continue;
    const texto = textoLimpo(card.text());
    const origem = trechoEntre(texto, 'Origem:', 'Destino:');
    const depoisDestino = texto.split(/Destino\s*:/i).slice(1).join('Destino:');
    const contatos = telefones(depoisDestino);
    let destino = textoLimpo(depoisDestino.split(/Conferir rota/i)[0]);
    const primeiroTelefone = destino.match(/(?:\+?55[\s-]*)?\(?\d{2}\)?[\s-]*9?\d{4}[\s-]*\d{4}/);
    if (primeiroTelefone) destino = textoLimpo(destino.slice(0, primeiroTelefone.index));
    const partesRota = texto.split(/Conferir rota/i);
    let rota = partesRota.length > 1 ? partesRota.at(-1) : '';
    rota = textoLimpo(rota.split(/Compartilhar/i)[0].replace(/^Fechar\s*/i, ''));
    if (!/\b[A-Z]{2}\b/.test(rota)) rota = '';
    if (!origem || !contatos.length) continue;
    registros.push({
      nome, origem, destino,
      telefones: contatos.map(n => n.length === 11
        ? '(' + n.slice(0, 2) + ') ' + n.slice(2, 7) + '-' + n.slice(7)
        : '(' + n.slice(0, 2) + ') ' + n.slice(2, 6) + '-' + n.slice(6)).join(' / '),
      rota, tipo: 'excursao/transportadora - tipo nao verificado'
    });
  }
  const unicos = [];
  const ids = new Set();
  for (const r of registros) {
    const id = identificador(r);
    if (!ids.has(id)) { ids.add(id); unicos.push(r); }
  }
  const total = html.match(/Encontramos\s+([\d.]+)\s+resultados/i);
  return { registros: unicos, total: total ? Number(total[1].replace(/\./g, '')) : null };
}

function identificador(r) {
  return chave(r.nome) + '|' + chave(r.origem) + '|' + String(r.telefones).replace(/\D/g, '');
}

function urlPermitida(endereco) {
  try {
    const url = new URL(endereco);
    return url.protocol === 'https:' && url.hostname === HOST && url.pathname === '/c/excursoes';
  } catch (_) { return false; }
}

async function baixarPagina(endereco, fetcher = fetch) {
  if (!urlPermitida(endereco)) throw new Error('Endereco fora do dominio e caminho autorizados.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const resposta = await fetcher(endereco, {
      signal: controller.signal, redirect: 'manual',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'AluminioJR/1.0 (importacao assistida de cadastro; acesso autorizado)'
      }
    });
    if (!resposta.ok) throw new Error('Resposta HTTP ' + resposta.status + ' do Moda Center.');
    const tipo = String(resposta.headers?.get('content-type') || '');
    if (tipo && !tipo.includes('text/html')) throw new Error('O site nao retornou HTML.');
    const tamanho = Number(resposta.headers?.get('content-length') || 0);
    if (tamanho > MAX_HTML_BYTES) throw new Error('Resposta do site maior que o permitido.');
    const html = await resposta.text();
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error('Pagina maior que o permitido.');
    return html;
  } finally { clearTimeout(timeout); }
}

function linksPaginacao(html) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href], link[rel=next][href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let url;
    try { url = new URL(href, BASE); } catch (_) { return; }
    if (urlPermitida(url.href) && url.search && /[?&](?:page|pagina|p)=\d+/i.test(url.search)) {
      links.push(url.href);
    }
  });
  return [...new Set(links)];
}

function modeloPagina2(html) {
  for (const href of linksPaginacao(html)) {
    const url = new URL(href);
    for (const parametro of ['page', 'pagina', 'p']) {
      if (Number(url.searchParams.get(parametro)) === 2) return href;
    }
  }
  return null;
}

function proximaUrl(modelo, numero) {
  const url = new URL(modelo);
  for (const param of ['page', 'pagina', 'p', 'pageNumber', 'current_page']) {
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, String(numero));
      return url.href;
    }
  }
  return null;
}

function assinaturaPagina(dados) {
  return dados.registros.map(identificador).join(';');
}

async function coletarExcursoes(fetcher = fetch) {
  const primeiroHtml = await baixarPagina(BASE, fetcher);
  const primeira = extrairPagina(primeiroHtml);
  if (!primeira.registros.length) {
    throw new Error('Nao foi possivel identificar os cadastros na pagina publica. Estrutura do site pode ter mudado.');
  }
  const registros = [];
  const ids = new Set();
  const avisos = [];
  const paginas = [];
  function acrescentar(numero, dados) {
    paginas.push(numero);
    for (const item of dados.registros) {
      const id = identificador(item);
      if (!ids.has(id) && registros.length < MAX_REGISTROS) {
        ids.add(id);
        registros.push(item);
      }
    }
  }
  acrescentar(1, primeira);
  const totalInformado = primeira.total;
  if (totalInformado && registros.length >= totalInformado) {
    return { rows: registros, total_informado: totalInformado, paginas_visitadas: paginas,
      coleta_completa: true, avisos };
  }

  const candidatos = [modeloPagina2(primeiroHtml),
    '?page=2', '?pagina=2', '?p=2', '?pageNumber=2', '?current_page=2'
  ].filter(Boolean).map(c => new URL(c, BASE).href);
  let modelo = null;
  let segunda = null;
  const consultas = new Set();
  for (const url of candidatos) {
    if (consultas.has(url) || !urlPermitida(url)) continue;
    consultas.add(url);
    await esperar(PAUSA_MS);
    try {
      const pagina = extrairPagina(await baixarPagina(url, fetcher));
      if (pagina.registros.length && assinaturaPagina(pagina) !== assinaturaPagina(primeira)) {
        modelo = url;
        segunda = pagina;
        break;
      }
    } catch (erro) {
      avisos.push('Nao foi possivel testar a paginacao ' + new URL(url).search + ': ' + erro.message);
      if (/Resposta HTTP 429/.test(erro.message)) break;
    }
  }
  if (!modelo) {
    avisos.push('Paginacao nao identificada: apenas a primeira pagina foi obtida. Nao considere a coleta completa.');
    return { rows: registros, total_informado: totalInformado,
      paginas_visitadas: paginas, coleta_completa: false, avisos };
  }
  acrescentar(2, segunda);
  let paginaAnterior = assinaturaPagina(segunda);
  for (let numero = 3; numero <= MAX_PAGINAS && registros.length < MAX_REGISTROS; numero++) {
    if (totalInformado && registros.length >= totalInformado) break;
    const url = proximaUrl(modelo, numero);
    if (!url || !urlPermitida(url)) break;
    await esperar(PAUSA_MS);
    let dados;
    try {
      dados = extrairPagina(await baixarPagina(url, fetcher));
    } catch (erro) {
      avisos.push('Falha na pagina ' + numero + ': ' + erro.message);
      break;
    }
    const assinatura = assinaturaPagina(dados);
    if (!dados.registros.length || assinatura === paginaAnterior) {
      avisos.push('Paginacao encerrada na pagina ' + numero + ' (vazia ou repetida).');
      break;
    }
    const antes = registros.length;
    acrescentar(numero, dados);
    if (registros.length === antes) {
      avisos.push('Pagina ' + numero + ' nao trouxe novos registros.');
      break;
    }
    paginaAnterior = assinatura;
  }
  const coletaCompleta = totalInformado != null && registros.length >= totalInformado;
  if (!coletaCompleta) {
    avisos.push('Coleta parcial: ' + registros.length + ' registros unicos de ' +
      (totalInformado == null ? 'total desconhecido' : totalInformado) +
      '. Confira a paginacao do site antes de importar todos.');
  }
  return {
    rows: registros, total_informado: totalInformado,
    paginas_visitadas: paginas, coleta_completa: coletaCompleta, avisos
  };
}
module.exports = {
  extrairPagina, urlPermitida, linksPaginacao, modeloPagina2,
  proximaUrl, coletarExcursoes
};
