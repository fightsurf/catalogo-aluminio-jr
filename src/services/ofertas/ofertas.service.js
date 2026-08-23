const crypto = require('crypto');
const pool = require('../../../db/connection');
const produtoService = require('../produto/produto.service');
const schemaService = require('./ofertasSchema.service');
const arteOfertaService = require('./arteOferta.service');
const cloudflareR2Service = require('../cloudflare/cloudflareR2.service');
const zapiService = require('../integracoes/zapi.service');

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

async function publicar(id, baseUrl) {
  const { oferta, buffer } = await gerarArteBuffer(id);
  const link = `${basePublica(baseUrl)}/ofertas/${encodeURIComponent(oferta.codigo)}`;
  const legenda = link;
  const envio = await zapiService.enviarImagemStatus({ imagem: imagemBase64(buffer), legenda });

  await pool.query(
    `UPDATE ofertas
     SET status='publicada', publicado_em=NOW(), imagem_url=NULL, r2_key=NULL, updated_at=NOW()
     WHERE id=$1`,
    [id]
  );

  return { oferta: await buscarPorId(id), link, legenda, zapi: envio.zapi };
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
  const telefoneDestino = normalizarTelefoneDestino(telefone);
  const consulta = await listarIdsKitsPorPeriodo(periodo);
  const rotuloPeriodo = consulta.periodo === 'ontem' ? 'ontem' : 'hoje';

  if (!consulta.ofertas.length) {
    const mensagem = `Nenhum kit foi criado ${rotuloPeriodo} na Central de Ofertas.`;
    await zapiService.enviarTexto({ telefone: telefoneDestino, mensagem });
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

  for (const item of consulta.ofertas) {
    try {
      const resultado = await enviarWhatsapp(item.id, telefoneDestino, baseUrl);
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
      await zapiService.enviarTexto({ telefone: telefoneDestino, mensagem });
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
