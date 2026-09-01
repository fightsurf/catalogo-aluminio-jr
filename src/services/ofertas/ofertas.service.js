const crypto = require('crypto');
const pool = require('../../../db/connection');
const produtoService = require('../produto/produto.service');
const schemaService = require('./ofertasSchema.service');
const arteOfertaService = require('./arteOferta.service');
const cloudflareR2Service = require('../cloudflare/cloudflareR2.service');
const zapiService = require('../integracoes/zapi.service');
const instagramService = require('../integracoes/instagram.service');
const facebookService = require('../integracoes/facebook.service');

function numeroPositivo(valor, nome) {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) throw new Error(`${nome} inválido.`);
  return numero;
}

function inteiroPositivo(valor, nome) {
  const numero = Number.parseInt(valor, 10);
  if (!Number.isInteger(numero) || numero <= 0) throw new Error(`${nome} inválida.`);
  return numero;
}

function corHex(valor, nome) {
  const texto = String(valor || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(texto)) throw new Error(`${nome} inválida.`);
  return texto.toUpperCase();
}

function normalizarTemaArte(payload = {}) {
  const temas = new Set([...Object.keys(arteOfertaService.TEMAS || {}), 'personalizado']);
  const tema = String(payload.tema_arte || 'claro').trim().toLowerCase();
  if (!temas.has(tema)) throw new Error('Tema da arte inválido.');

  if (tema !== 'personalizado') {
    return { tema_arte: tema, cores_arte: {} };
  }

  const cores = payload.cores_arte && typeof payload.cores_arte === 'object' ? payload.cores_arte : {};
  return {
    tema_arte: 'personalizado',
    cores_arte: {
      fundoInicio: corHex(cores.fundoInicio, 'Cor inicial do fundo'),
      fundoFim: corHex(cores.fundoFim, 'Cor final do fundo'),
      destaque: corHex(cores.destaque, 'Cor de destaque'),
      texto: corHex(cores.texto, 'Cor do texto'),
    },
  };
}

function codigoOferta() {
  const data = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `OF-${data}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizarLinhaOferta(row) {
  const { imagem_url: _imagemUrl, r2_key: _r2Key, ...dados } = row;
  return {
    ...dados,
    id: Number(row.id),
    total: Number(row.total || 0),
    preco_medio: Number(row.preco_medio || 0),
    total_itens: Number(row.total_itens || 0),
    visualizacoes: Number(row.visualizacoes || 0),
    cliques_whatsapp: Number(row.cliques_whatsapp || 0),
    tema_arte: row.tema_arte || 'claro',
    cores_arte: row.cores_arte && typeof row.cores_arte === 'object' ? row.cores_arte : {},
    whatsapp_status: row.whatsapp_status || (row.status === 'publicada' ? 'publicado' : 'nao_publicado'),
    whatsapp_publicado_em: row.whatsapp_publicado_em || row.publicado_em || null,
    whatsapp_erro: row.whatsapp_erro || null,
    instagram_status: row.instagram_status || 'nao_publicado',
    instagram_publicado_em: row.instagram_publicado_em || null,
    instagram_media_id: row.instagram_media_id || null,
    instagram_container_id: row.instagram_container_id || null,
    instagram_erro: row.instagram_erro || null,
    facebook_story_status: row.facebook_story_status || 'nao_publicado',
    facebook_story_publicado_em: row.facebook_story_publicado_em || null,
    facebook_story_post_id: row.facebook_story_post_id || null,
    facebook_story_erro: row.facebook_story_erro || null,
    facebook_feed_status: row.facebook_feed_status || 'nao_publicado',
    facebook_feed_publicado_em: row.facebook_feed_publicado_em || null,
    facebook_feed_post_id: row.facebook_feed_post_id || null,
    facebook_feed_erro: row.facebook_feed_erro || null,
    arte_dinamica: true,
    imagem_armazenada: false,
  };
}

function normalizarItemReceita(item) {
  return {
    ...item,
    id: Number(item.id),
    oferta_id: Number(item.oferta_id),
    produto_id: item.produto_id ? Number(item.produto_id) : null,
    quantidade: Number(item.quantidade),
    preco_unitario: Number(item.preco_unitario || 0),
    preco_medio: Number(item.preco_medio || 0),
  };
}

async function obterItens(ofertaId) {
  const result = await pool.query('SELECT * FROM ofertas_itens WHERE oferta_id = $1 ORDER BY id ASC', [ofertaId]);
  return result.rows.map(normalizarItemReceita);
}

async function carregarMapaProdutosAtuais() {
  const produtos = await produtoService.listar({});
  return new Map(produtos.map(produto => [String(produto.id), produto]));
}

function fotoAtualProduto(produto) {
  return produto.foto || produto.fotos?.find(Boolean) || null;
}

function materializarOfertaAtual(row, receita, mapaProdutos, permitirIndisponiveis = false) {
  const problemas = [];

  const itens = receita.map(item => {
    const produto = mapaProdutos.get(String(item.produto_id));

    if (!produto) {
      problemas.push(`O produto ${item.produto_id || item.nome || 'sem identificação'} não existe mais no cadastro.`);
      return item;
    }

    if (produto.ativo !== true) {
      problemas.push(`${produto.nome} está inativo.`);
    }

    if (produto.perfil_kit_feirinha !== true) {
      problemas.push(`${produto.nome} não está mais habilitado para Kit Feirinha.`);
    }

    const preco = Number(produto.preco);
    if (!Number.isFinite(preco) || preco <= 0) {
      problemas.push(`${produto.nome} está sem preço atual válido.`);
    }

    const foto = fotoAtualProduto(produto);
    if (!foto) {
      problemas.push(`${produto.nome} está sem foto atual.`);
    }

    return {
      ...item,
      nome: produto.nome,
      preco_unitario: Number.isFinite(preco) ? preco : 0,
      foto_url: foto,
      produto_ativo: produto.ativo === true,
      produto_kit_feirinha: produto.perfil_kit_feirinha === true,
    };
  });

  if (problemas.length && !permitirIndisponiveis) {
    throw new Error(`A oferta não pode ser recriada com os dados atuais. ${problemas.join(' ')}`);
  }

  const totalItens = itens.reduce((soma, item) => soma + Number(item.quantidade || 0), 0);
  const total = itens.reduce((soma, item) => soma + (Number(item.preco_unitario || 0) * Number(item.quantidade || 0)), 0);
  const precoMedio = totalItens > 0 ? total / totalItens : 0;
  const oferta = normalizarLinhaOferta({
    ...row,
    total,
    preco_medio: precoMedio,
    total_itens: totalItens,
  });

  return {
    ...oferta,
    itens: itens.map(item => ({ ...item, preco_medio: precoMedio })),
    disponivel: problemas.length === 0,
    problemas,
    dados_produtos: 'atuais',
    arte_url: `/api/ofertas/${Number(row.id)}/arte.jpg`,
  };
}

async function buscarBasePorId(id) {
  await schemaService.criarEstrutura();
  const result = await pool.query('SELECT * FROM ofertas WHERE id = $1', [id]);
  if (!result.rows.length) throw new Error('Oferta não encontrada.');
  return { row: result.rows[0], receita: await obterItens(id) };
}

async function buscarPorId(id, opcoes = {}) {
  const { row, receita } = await buscarBasePorId(id);
  const mapaProdutos = opcoes.mapaProdutos || await carregarMapaProdutosAtuais();
  return materializarOfertaAtual(row, receita, mapaProdutos, opcoes.permitirIndisponiveis === true);
}

async function buscarPorCodigo(codigo, registrarVisualizacao = false) {
  await schemaService.criarEstrutura();
  const result = await pool.query('SELECT * FROM ofertas WHERE codigo = $1', [codigo]);
  if (!result.rows.length) throw new Error('Oferta não encontrada.');

  let row = result.rows[0];
  if (registrarVisualizacao) {
    const atualizado = await pool.query(
      'UPDATE ofertas SET visualizacoes = visualizacoes + 1 WHERE id = $1 RETURNING *',
      [row.id]
    );
    row = atualizado.rows[0];
  }

  const mapaProdutos = await carregarMapaProdutosAtuais();
  return materializarOfertaAtual(row, await obterItens(row.id), mapaProdutos, false);
}

async function listar(filtros = {}) {
  await schemaService.criarEstrutura();

  const precoMedioInformado = String(filtros.preco_medio ?? '').trim();
  let result;
  if (precoMedioInformado) {
    const precoMedio = numeroPositivo(precoMedioInformado.replace(',', '.'), 'Preço médio');
    result = await pool.query(
      `SELECT * FROM ofertas
       WHERE ABS(preco_medio - $1::numeric) < 0.005
       ORDER BY created_at DESC
       LIMIT 100`,
      [precoMedio]
    );
  } else {
    result = await pool.query('SELECT * FROM ofertas ORDER BY created_at DESC LIMIT 100');
  }
  const mapaProdutos = await carregarMapaProdutosAtuais();

  return Promise.all(result.rows.map(async row => {
    const receita = await obterItens(row.id);
    return materializarOfertaAtual(row, receita, mapaProdutos, true);
  }));
}

async function criar(payload) {
  await schemaService.criarEstrutura();
  const itensEntrada = Array.isArray(payload.itens) ? payload.itens : [];
  if (!itensEntrada.length) throw new Error('Selecione ao menos um produto.');

  const produtos = await produtoService.listar({ perfil: 'kit-feirinha', apenasAtivos: true });
  const mapa = new Map(produtos.map(produto => [String(produto.id), produto]));
  const itens = itensEntrada.map(item => {
    const produto = mapa.get(String(item.produto_id));
    if (!produto) throw new Error(`Produto ${item.produto_id} não está disponível para Kit Feirinha.`);

    const quantidade = inteiroPositivo(item.quantidade, 'Quantidade');
    const preco = numeroPositivo(produto.preco, 'Preço');
    const foto = fotoAtualProduto(produto);
    if (!foto) throw new Error(`${produto.nome} está sem foto cadastrada.`);

    return {
      produto_id: Number(produto.id),
      nome: produto.nome,
      quantidade,
      preco_unitario: preco,
      foto_url: foto,
    };
  });

  const totalItens = itens.reduce((soma, item) => soma + item.quantidade, 0);
  if (totalItens > arteOfertaService.MAX_ITENS) {
    throw new Error(`Selecione no máximo ${arteOfertaService.MAX_ITENS} peças no total para a arte.`);
  }

  const total = itens.reduce((soma, item) => soma + (item.preco_unitario * item.quantidade), 0);
  const precoMedio = total / totalItens;
  const titulo = String(payload.titulo || 'Kit Feirinha Especial').trim().slice(0, 160) || 'Kit Feirinha Especial';
  const expiraEm = payload.expira_em ? new Date(payload.expira_em) : null;
  if (expiraEm && Number.isNaN(expiraEm.getTime())) throw new Error('Data de expiração inválida.');
  const { tema_arte, cores_arte } = normalizarTemaArte(payload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ofertaResult = await client.query(
      `INSERT INTO ofertas
        (codigo,titulo,total,preco_medio,total_itens,expira_em,prompt_cenario,tema_arte,cores_arte,imagem_url,r2_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NULL,NULL)
       RETURNING *`,
      [
        codigoOferta(), titulo, total, precoMedio, totalItens, expiraEm,
        payload.prompt_cenario || null, tema_arte, JSON.stringify(cores_arte),
      ]
    );
    const oferta = ofertaResult.rows[0];

    for (const item of itens) {
      await client.query(
        `INSERT INTO ofertas_itens
          (oferta_id,produto_id,nome,quantidade,preco_unitario,preco_medio,foto_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [oferta.id, item.produto_id, item.nome, item.quantidade, item.preco_unitario, precoMedio, item.foto_url]
      );
    }

    await client.query('COMMIT');
    return buscarPorId(oferta.id);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function gerarArteBuffer(id) {
  const oferta = await buscarPorId(id);
  const buffer = await arteOfertaService.gerarArte(oferta);
  return { oferta, buffer };
}

async function gerarArte(id) {
  const oferta = await buscarPorId(id);
  return {
    ...oferta,
    arte_url: `/api/ofertas/${oferta.id}/arte.jpg`,
  };
}

function imagemBase64(buffer) {
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

function basePublica(baseUrl) {
  return String(process.env.APP_PUBLIC_URL || baseUrl || '').replace(/\/+$/, '');
}

function normalizarTelefoneDestino(valor) {
  const telefone = zapiService.normalizarTelefone(valor);
  if (!telefone) throw new Error('Número do WhatsApp não informado.');
  if (telefone.length < 10) throw new Error('Número do WhatsApp inválido. Informe com DDI e DDD.');
  return telefone;
}

// Os comandos do n8n usam exatamente o identificador recebido da Z-API.
// Quando o WhatsApp entrega um LID (ex.: 123456789@lid), ele precisa chegar
// intacto ao campo `phone` da Z-API. Telefones comuns continuam passando pela
// normalização já existente, sem alterar o comportamento dos demais módulos.
function normalizarIdentificadorWhatsapp(valor) {
  const identificador = String(valor || '').trim();

  if (!identificador) {
    throw new Error('Número do WhatsApp não informado.');
  }

  if (/^\d+@lid$/i.test(identificador)) {
    return identificador;
  }

  return normalizarTelefoneDestino(identificador);
}

async function enviarTextoPorIdentificadorWhatsapp(identificador, mensagem) {
  const destino = normalizarIdentificadorWhatsapp(identificador);
  const texto = String(mensagem || '').trim();

  if (!texto) {
    throw new Error('Mensagem é obrigatória.');
  }

  return zapiService.postZapi('/send-text', {
    phone: destino,
    message: texto,
  });
}

async function enviarOfertaPorIdentificadorWhatsapp(id, identificador, baseUrl) {
  const destino = normalizarIdentificadorWhatsapp(identificador);
  const { oferta, buffer } = await gerarArteBuffer(id);
  const link = `${basePublica(baseUrl)}/ofertas/${encodeURIComponent(oferta.codigo)}`;
  const legenda = link;

  const envio = await zapiService.postZapi('/send-image', {
    phone: destino,
    image: imagemBase64(buffer),
    caption: legenda,
  });

  await pool.query(
    'UPDATE ofertas SET imagem_url=NULL, r2_key=NULL, updated_at=NOW() WHERE id=$1',
    [id]
  );

  return {
    oferta,
    telefone: destino,
    link,
    legenda,
    zapi: envio.zapi,
  };
}

function limitarErroPublicacao(error) {
  const mensagem = String(error?.message || error || 'Erro não informado.').trim();
  return mensagem.slice(0, 2000);
}

async function publicarStoryInstagram(oferta, buffer) {
  const diagnostico = instagramService.diagnosticarConfiguracao();
  if (!diagnostico.configurado) {
    return {
      status: 'nao_configurado',
      configurado: false,
      faltando: diagnostico.faltando,
      erro: `Configure no Render: ${diagnostico.faltando.join(', ')}.`,
    };
  }

  let arquivoTemporario = null;
  let limpezaTemporaria = null;

  try {
    arquivoTemporario = await cloudflareR2Service.uploadBuffer(buffer, {
      pasta: 'ofertas',
      nome: `instagram-story-${oferta.codigo}.jpg`,
      contentType: 'image/jpeg',
      metadata: {
        oferta_id: oferta.id,
        codigo: oferta.codigo,
        destino: 'instagram-story',
      },
    });

    const resultado = await instagramService.publicarStoryImagem({
      imageUrl: arquivoTemporario.url,
    });

    return {
      ...resultado,
      configurado: true,
      imagem_temporaria: arquivoTemporario.url,
    };
  } finally {
    if (arquivoTemporario?.key) {
      try {
        await cloudflareR2Service.excluirObjeto(arquivoTemporario.key);
        limpezaTemporaria = { excluido: true, key: arquivoTemporario.key };
      } catch (error) {
        limpezaTemporaria = { excluido: false, key: arquivoTemporario.key, erro: limitarErroPublicacao(error) };
        console.error('[Central de Ofertas] Não foi possível remover a arte temporária do Instagram:', limpezaTemporaria.erro);
      }
    }

    if (limpezaTemporaria && limpezaTemporaria.excluido === false) {
      // A falha de limpeza não invalida uma publicação que a Meta já concluiu.
      console.warn('[Central de Ofertas] Arte temporária preservada no R2 para limpeza posterior:', limpezaTemporaria.key);
    }
  }
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).replace(/\u00a0/g, ' ');
}

function montarTextoFacebookOferta(oferta, link) {
  const precoMedio = formatarMoeda(oferta.preco_medio);
  const linhasItens = (oferta.itens || []).map((item) => {
    const quantidade = Number(item.quantidade || 0);
    return `• ${quantidade}x ${item.nome} — preço médio ${precoMedio} por peça`;
  });

  return [
    oferta.titulo || 'Oferta Alumínio JR',
    '',
    `PREÇO MÉDIO POR PEÇA: ${precoMedio}`,
    '',
    'ITENS DO KIT:',
    ...linhasItens,
    '',
    `Total do kit: ${formatarMoeda(oferta.total)}`,
    `Quantidade de peças: ${Number(oferta.total_itens || 0)}`,
    '',
    link,
  ].join('\n');
}

async function publicarFacebookComArte(oferta, buffer, destino, publicar) {
  const diagnostico = facebookService.diagnosticarConfiguracao();
  if (!diagnostico.configurado) {
    return {
      status: 'nao_configurado',
      configurado: false,
      faltando: diagnostico.faltando,
      erro: `Configure no Render: ${diagnostico.faltando.join(', ')}.`,
    };
  }

  let temporario = null;
  try {
    temporario = await cloudflareR2Service.uploadBuffer(buffer, {
      pasta: 'ofertas',
      nome: `facebook-${destino}-${oferta.codigo}.jpg`,
      contentType: 'image/jpeg',
      metadata: {
        oferta_id: oferta.id,
        codigo: oferta.codigo,
        destino: `facebook-${destino}`,
      },
    });

    const resultado = await publicar(temporario.url);
    return { ...resultado, configurado: true, imagem_temporaria: temporario.url };
  } finally {
    if (temporario?.key) {
      try {
        await cloudflareR2Service.excluirObjeto(temporario.key);
      } catch (error) {
        console.error(`[Central de Ofertas] Falha ao excluir arte temporária do Facebook (${destino}):`, limitarErroPublicacao(error));
      }
    }
  }
}

async function publicarStoryFacebook(oferta, buffer) {
  return publicarFacebookComArte(oferta, buffer, 'story', imageUrl => (
    facebookService.publicarStoryImagem({ imageUrl })
  ));
}

async function publicarFeedFacebook(oferta, buffer, link) {
  const mensagem = montarTextoFacebookOferta(oferta, link);
  const resultado = await publicarFacebookComArte(oferta, buffer, 'feed', imageUrl => (
    facebookService.publicarFeedImagem({ imageUrl, message: mensagem })
  ));
  return { ...resultado, mensagem };
}

function normalizarResultadoCanal(settled, canal) {
  if (settled.status === 'fulfilled') {
    const valor = settled.value || {};
    return {
      canal,
      ...valor,
      status: valor.status || 'publicado',
    };
  }

  return {
    canal,
    status: 'erro',
    erro: limitarErroPublicacao(settled.reason),
  };
}

function canalPublicado(canal) {
  return canal?.status === 'publicado';
}

function erroCanal(canal) {
  return ['erro', 'nao_configurado'].includes(canal?.status) ? (canal.erro || null) : null;
}

async function salvarResultadoPublicacao(id, whatsapp, instagram, facebookStory, facebookFeed) {
  const algumPublicado = [whatsapp, instagram, facebookStory, facebookFeed].some(canalPublicado);

  await pool.query(
    `UPDATE ofertas
     SET status=CASE WHEN $2::boolean THEN 'publicada' ELSE status END,
         publicado_em=CASE WHEN $2::boolean THEN COALESCE(publicado_em, NOW()) ELSE publicado_em END,
         whatsapp_status=$3::varchar(24),
         whatsapp_publicado_em=CASE WHEN $3::varchar(24)='publicado' THEN NOW() ELSE whatsapp_publicado_em END,
         whatsapp_erro=$4::text,
         instagram_status=$5::varchar(24),
         instagram_publicado_em=CASE WHEN $5::varchar(24)='publicado' THEN NOW() ELSE instagram_publicado_em END,
         instagram_media_id=COALESCE($6::text, instagram_media_id),
         instagram_container_id=COALESCE($7::text, instagram_container_id),
         instagram_erro=$8::text,
         facebook_story_status=$9::varchar(24),
         facebook_story_publicado_em=CASE WHEN $9::varchar(24)='publicado' THEN NOW() ELSE facebook_story_publicado_em END,
         facebook_story_post_id=COALESCE($10::text, facebook_story_post_id),
         facebook_story_erro=$11::text,
         facebook_feed_status=$12::varchar(24),
         facebook_feed_publicado_em=CASE WHEN $12::varchar(24)='publicado' THEN NOW() ELSE facebook_feed_publicado_em END,
         facebook_feed_post_id=COALESCE($13::text, facebook_feed_post_id),
         facebook_feed_erro=$14::text,
         imagem_url=NULL,
         r2_key=NULL,
         updated_at=NOW()
     WHERE id=$1`,
    [
      id,
      algumPublicado,
      whatsapp.status,
      whatsapp.status === 'erro' ? whatsapp.erro : null,
      instagram.status,
      instagram.media_id || null,
      instagram.container_id || null,
      erroCanal(instagram),
      facebookStory.status,
      facebookStory.post_id || null,
      erroCanal(facebookStory),
      facebookFeed.status,
      facebookFeed.post_id || null,
      erroCanal(facebookFeed),
    ]
  );
}

async function publicar(id, baseUrl) {
  const { oferta, buffer } = await gerarArteBuffer(id);
  const link = `${basePublica(baseUrl)}/ofertas/${encodeURIComponent(oferta.codigo)}`;
  const legenda = link;

  // Uma única arte é gerada. Os quatro destinos são independentes: uma falha
  // não cancela os canais que já conseguiram publicar.
  const resultados = await Promise.allSettled([
    zapiService.enviarImagemStatus({ imagem: imagemBase64(buffer), legenda }),
    publicarStoryInstagram(oferta, buffer),
    publicarStoryFacebook(oferta, buffer),
    publicarFeedFacebook(oferta, buffer, link),
  ]);

  const whatsapp = normalizarResultadoCanal(resultados[0], 'whatsapp');
  const instagram = normalizarResultadoCanal(resultados[1], 'instagram');
  const facebookStory = normalizarResultadoCanal(resultados[2], 'facebook_story');
  const facebookFeed = normalizarResultadoCanal(resultados[3], 'facebook_feed');

  if (canalPublicado(whatsapp)) whatsapp.zapi = resultados[0].value?.zapi || null;

  await salvarResultadoPublicacao(id, whatsapp, instagram, facebookStory, facebookFeed);

  const canais = { whatsapp, instagram, facebook_story: facebookStory, facebook_feed: facebookFeed };
  const listaCanais = Object.values(canais);
  const algumPublicado = listaCanais.some(canalPublicado);
  const publicacaoCompleta = listaCanais.every(canalPublicado);

  if (!algumPublicado) {
    const detalhes = [
      `WhatsApp: ${whatsapp.erro || whatsapp.status}`,
      `Instagram: ${instagram.erro || instagram.status}`,
      `Facebook Story: ${facebookStory.erro || facebookStory.status}`,
      `Facebook Feed: ${facebookFeed.erro || facebookFeed.status}`,
    ].join(' | ');
    throw new Error(`Não foi possível publicar a oferta. ${detalhes}`);
  }

  return {
    oferta: await buscarPorId(id),
    link,
    legenda,
    publicacao_completa: publicacaoCompleta,
    publicacao_parcial: !publicacaoCompleta,
    canais,
    zapi: whatsapp.zapi || null,
    instagram: canalPublicado(instagram) ? instagram : null,
    facebook_story: canalPublicado(facebookStory) ? facebookStory : null,
    facebook_feed: canalPublicado(facebookFeed) ? facebookFeed : null,
  };
}

async function enviarWhatsapp(id, telefone, baseUrl) {
  const telefoneDestino = normalizarTelefoneDestino(telefone);
  const { oferta, buffer } = await gerarArteBuffer(id);
  const link = `${basePublica(baseUrl)}/ofertas/${encodeURIComponent(oferta.codigo)}`;
  const legenda = link;
  const envio = await zapiService.enviarImagem({
    telefone: telefoneDestino,
    imagem: imagemBase64(buffer),
    legenda,
  });

  await pool.query(
    'UPDATE ofertas SET imagem_url=NULL, r2_key=NULL, updated_at=NOW() WHERE id=$1',
    [id]
  );

  return {
    oferta,
    telefone: telefoneDestino,
    link,
    legenda,
    zapi: envio.zapi,
  };
}

async function duplicar(id) {
  const original = await buscarPorId(id);
  return criar({
    titulo: `${original.titulo} - cópia`,
    itens: original.itens.map(item => ({ produto_id: item.produto_id, quantidade: item.quantidade })),
    prompt_cenario: original.prompt_cenario,
    expira_em: original.expira_em,
    tema_arte: original.tema_arte,
    cores_arte: original.cores_arte,
  });
}

async function limparArtesR2() {
  await schemaService.criarEstrutura();
  const limpeza = await cloudflareR2Service.limparPrefixo('ofertas/');
  const atualizado = await pool.query(`
    UPDATE ofertas
    SET imagem_url=NULL,
        r2_key=NULL,
        status=CASE WHEN status='arte_pronta' THEN 'rascunho' ELSE status END,
        updated_at=NOW()
    WHERE imagem_url IS NOT NULL OR r2_key IS NOT NULL OR status='arte_pronta'
  `);

  return {
    ...limpeza,
    referencias_limpas: atualizado.rowCount,
    aviso: 'Somente objetos do prefixo ofertas/ foram removidos. As fotos dos produtos foram preservadas.',
  };
}

async function registrarClique(codigo) {
  await schemaService.criarEstrutura();
  await pool.query('UPDATE ofertas SET cliques_whatsapp=cliques_whatsapp+1 WHERE codigo=$1', [codigo]);
  return { ok: true };
}


function normalizarPeriodoKits(valor) {
  const periodo = String(valor || '').trim().toLowerCase();
  if (!['hoje', 'ontem'].includes(periodo)) {
    throw new Error('Período inválido. Use hoje ou ontem.');
  }
  return periodo;
}

function montarMensagemResumoKits(rotuloPeriodo, quantidade) {
  const periodo = String(rotuloPeriodo || '').trim().toLowerCase() === 'ontem' ? 'Ontem' : 'Hoje';
  const total = Number(quantidade || 0);

  if (total === 1) {
    return `${periodo} foi criado 1 kit.`;
  }

  return `${periodo} foram criados ${total} kits.`;
}

async function listarIdsKitsPorPeriodo(periodo) {
  await schemaService.criarEstrutura();
  const periodoNormalizado = normalizarPeriodoKits(periodo);
  const diasAtras = periodoNormalizado === 'ontem' ? 1 : 0;

  const result = await pool.query(
    `SELECT id, codigo, titulo, created_at
       FROM ofertas
      WHERE (created_at AT TIME ZONE 'America/Fortaleza')::date =
            ((NOW() AT TIME ZONE 'America/Fortaleza')::date - $1::integer)
      ORDER BY created_at ASC, id ASC`,
    [diasAtras]
  );

  return {
    periodo: periodoNormalizado,
    ofertas: result.rows.map(row => ({
      id: Number(row.id),
      codigo: row.codigo,
      titulo: row.titulo,
      created_at: row.created_at,
    })),
  };
}

async function enviarKitsPorPeriodo(periodo, telefone, baseUrl) {
  const telefoneDestino = normalizarIdentificadorWhatsapp(telefone);
  const consulta = await listarIdsKitsPorPeriodo(periodo);
  const rotuloPeriodo = consulta.periodo === 'ontem' ? 'ontem' : 'hoje';

  if (!consulta.ofertas.length) {
    const mensagem = `Nenhum kit foi criado ${rotuloPeriodo} na Central de Ofertas.`;
    await enviarTextoPorIdentificadorWhatsapp(telefoneDestino, mensagem);
    return {
      periodo: consulta.periodo,
      telefone: telefoneDestino,
      encontrados: 0,
      enviados: 0,
      falhas: [],
      mensagem,
    };
  }

  const enviados = [];
  const falhas = [];
  const mensagemResumo = montarMensagemResumoKits(rotuloPeriodo, consulta.ofertas.length);

  await enviarTextoPorIdentificadorWhatsapp(telefoneDestino, mensagemResumo);

  for (const item of consulta.ofertas) {
    try {
      const resultado = await enviarOfertaPorIdentificadorWhatsapp(item.id, telefoneDestino, baseUrl);
      enviados.push({
        id: item.id,
        codigo: item.codigo,
        titulo: item.titulo,
        link: resultado.link,
      });
    } catch (error) {
      falhas.push({
        id: item.id,
        codigo: item.codigo,
        titulo: item.titulo,
        erro: error.message,
      });
    }
  }

  if (falhas.length) {
    const mensagem = enviados.length
      ? `Foram enviados ${enviados.length} de ${consulta.ofertas.length} kit(s) de ${rotuloPeriodo}. ${falhas.length} não puderam ser enviados.`
      : `Não foi possível enviar os ${consulta.ofertas.length} kit(s) criados ${rotuloPeriodo}.`;

    try {
      await enviarTextoPorIdentificadorWhatsapp(telefoneDestino, mensagem);
    } catch (_) {
      // A resposta HTTP ainda informa as falhas mesmo se o aviso por texto não puder ser enviado.
    }
  }

  return {
    periodo: consulta.periodo,
    telefone: telefoneDestino,
    encontrados: consulta.ofertas.length,
    enviados: enviados.length,
    itens_enviados: enviados,
    falhas,
  };
}

module.exports = {
  listar,
  criar,
  buscarPorId,
  buscarPorCodigo,
  gerarArte,
  gerarArteBuffer,
  publicar,
  enviarWhatsapp,
  duplicar,
  limparArtesR2,
  registrarClique,
  listarIdsKitsPorPeriodo,
  enviarKitsPorPeriodo,
};
