// Envio manual de todas as mídias cadastradas de um produto para a conversa ativa do bot.
const produtoService = require('../produto/produto.service');
const zapi = require('../integracoes/zapi.service');

const requisicoes = new Map();
const TEMPO_CACHE_MS = 30 * 60 * 1000;

function inteiroPositivo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) throw new Error(nome + ' inválido.');
  return numero;
}

function telefoneValido(valor) {
  const telefone = String(valor || '').trim();
  // Não converter @lid nem tentar deduzir telefone; exigir DDI 55 + DDD.
  if (!/^55\d{10,11}$/.test(telefone)) {
    throw new Error('Selecione uma conversa com telefone brasileiro confirmado (55 + DDD).');
  }
  return telefone;
}

async function consultarProduto(produtoId, categoriaId) {
  const id = inteiroPositivo(produtoId, 'Produto');
  const categoria = inteiroPositivo(categoriaId, 'Categoria');
  const produto = await produtoService.buscar(id);
  if (!produto || !produto.ativo) throw new Error('Produto não encontrado ou inativo.');
  if (!(produto.categoria_ids || []).includes(categoria)) {
    throw new Error('O produto não pertence à categoria selecionada.');
  }

  const fotos = (produto.fotos || []).map((url, indice) => ({
    tipo: 'foto', posicao: indice + 1, url: String(url || '').trim()
  })).filter(midia => midia.url);
  const videos = [produto.video_url, produto.video_url_2, produto.video_url_3]
    .map((url, indice) => ({ tipo: 'video', posicao: indice + 1, url: String(url || '').trim() }))
    .filter(midia => midia.url);

  return {
    id: produto.id, nome: produto.nome, preco: produto.preco,
    fotos, videos, total_fotos: fotos.length, total_videos: videos.length
  };
}

async function listarMidias({ produtoId, categoriaId }) {
  const produto = await consultarProduto(produtoId, categoriaId);
  return {
    produto: { id: produto.id, nome: produto.nome, preco: produto.preco },
    midias: [...produto.fotos, ...produto.videos].map(({tipo, posicao}) => ({tipo, posicao})),
    total_fotos: produto.total_fotos,
    total_videos: produto.total_videos
  };
}

async function enviarMidia({ requestId, produtoId, categoriaId, telefone, tipo, posicao }) {
  const idEnvio = String(requestId || '').trim();
  if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(idEnvio)) throw new Error('Identificador do envio inválido.');
  const destino = telefoneValido(telefone);
  const idProduto = inteiroPositivo(produtoId, 'Produto');
  const idCategoria = inteiroPositivo(categoriaId, 'Categoria');
  const pos = inteiroPositivo(posicao, 'Posição da mídia');
  if (!['foto', 'video'].includes(tipo) || pos > (tipo === 'foto' ? 6 : 3)) {
    throw new Error('Tipo ou posição da mídia inválido.');
  }

  const assinatura = [idProduto, idCategoria, destino, tipo, pos].join(':');
  const anterior = requisicoes.get(idEnvio);
  if (anterior) {
    if (anterior.assinatura !== assinatura) throw new Error('Identificador reutilizado para outra mídia ou destinatário.');
    return { ...(await anterior.promessa), repetida: true };
  }

  const promessa = (async () => {
    // Consulta atual diretamente no servidor: nenhum URL vindo do navegador é enviado à Z-API.
    const produto = await consultarProduto(idProduto, idCategoria);
    const midia = [...produto.fotos, ...produto.videos]
      .find(item => item.tipo === tipo && item.posicao === pos);
    if (!midia) throw new Error('Esta mídia não está mais cadastrada no produto.');
    const valor = Number(produto.preco);
    const legenda = String(produto.nome || '').trim() +
      (Number.isFinite(valor) && valor > 0 ? '\n' + valor.toLocaleString('pt-BR', {style:'currency',currency:'BRL'}) : '');

    if (tipo === 'foto') {
      await zapi.enviarImagem({ telefone: destino, imagem: midia.url, legenda });
    } else {
      await zapi.enviarVideo({ telefone: destino, video: midia.url, legenda });
    }
    return { requestId: idEnvio, telefone: destino, produtoId: idProduto, tipo, posicao: pos, repetida: false };
  })();

  requisicoes.set(idEnvio, { assinatura, promessa });
  const temporizador = setTimeout(() => requisicoes.delete(idEnvio), TEMPO_CACHE_MS);
  temporizador.unref?.();
  // Falhas são preservadas temporariamente: timeout da Z-API pode significar entrega incerta.
  return promessa;
}

module.exports = { listarMidias, enviarMidia };
