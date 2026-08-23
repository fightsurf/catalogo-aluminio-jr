const produtoService = require('../../services/produto/produto.service');
const ofertasService = require('../../services/ofertas/ofertas.service');

function erro(res, error, status = 400) {
  return res.status(status).json({ success: false, message: error.message });
}

async function produtos(req, res) {
  try {
    res.json({ success: true, data: await produtoService.listar({ perfil: 'kit-feirinha', apenasAtivos: true }) });
  } catch (error) {
    erro(res, error, 500);
  }
}

async function listar(req, res) {
  try {
    res.json({ success: true, data: await ofertasService.listar({ preco_medio: req.query.preco_medio }) });
  } catch (error) {
    erro(res, error, 500);
  }
}

async function criar(req, res) {
  try {
    res.status(201).json({ success: true, data: await ofertasService.criar(req.body) });
  } catch (error) {
    erro(res, error);
  }
}

async function gerarArte(req, res) {
  try {
    res.json({ success: true, data: await ofertasService.gerarArte(req.params.id) });
  } catch (error) {
    erro(res, error, 422);
  }
}

async function imagemArte(req, res) {
  try {
    const { buffer } = await ofertasService.gerarArteBuffer(req.params.id);
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(buffer);
  } catch (error) {
    const status = /não encontrada/i.test(error.message) ? 404 : 422;
    erro(res, error, status);
  }
}

async function publicar(req, res) {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({ success: true, data: await ofertasService.publicar(req.params.id, base) });
  } catch (error) {
    erro(res, error, 502);
  }
}

async function enviarWhatsapp(req, res) {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      data: await ofertasService.enviarWhatsapp(req.params.id, req.body?.telefone, base),
    });
  } catch (error) {
    const status = /não informado|inválido|não pode ser recriada/i.test(error.message) ? 400 : 502;
    erro(res, error, status);
  }
}


async function enviarKitsComandoWhatsapp(req, res) {
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      data: await ofertasService.enviarKitsPorPeriodo(req.body?.periodo, req.body?.telefone, base),
    });
  } catch (error) {
    const status = /período inválido|não informado|inválido/i.test(error.message) ? 400 : 502;
    erro(res, error, status);
  }
}

async function duplicar(req, res) {
  try {
    res.status(201).json({ success: true, data: await ofertasService.duplicar(req.params.id) });
  } catch (error) {
    erro(res, error);
  }
}

async function limparArtesR2(req, res) {
  try {
    if (req.body?.confirmacao !== 'LIMPAR_ARTES_OFERTAS') {
      return erro(res, new Error('Confirmação de limpeza inválida.'), 400);
    }
    return res.json({ success: true, data: await ofertasService.limparArtesR2() });
  } catch (error) {
    return erro(res, error, 502);
  }
}

async function publica(req, res) {
  try {
    res.json({ success: true, data: await ofertasService.buscarPorCodigo(req.params.codigo, true) });
  } catch (error) {
    erro(res, error, 404);
  }
}

async function clique(req, res) {
  try {
    res.json({ success: true, data: await ofertasService.registrarClique(req.params.codigo) });
  } catch (error) {
    erro(res, error, 404);
  }
}

module.exports = {
  produtos,
  listar,
  criar,
  gerarArte,
  imagemArte,
  publicar,
  enviarWhatsapp,
  enviarKitsComandoWhatsapp,
  duplicar,
  limparArtesR2,
  publica,
  clique,
};
