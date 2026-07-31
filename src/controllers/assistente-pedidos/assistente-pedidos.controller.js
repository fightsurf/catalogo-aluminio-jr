const service = require('../../services/assistente-pedidos/assistente-pedidos.service');

function responderErro(res, error, status = 400) {
  console.error('[assistente-pedidos]', error);
  return res.status(status).json({ success: false, message: error.message });
}

async function gerarLink(req, res) {
  try { return res.status(201).json({ success: true, data: await service.gerarLink(req.body || {}) }); }
  catch (error) { return responderErro(res, error); }
}
async function contexto(req, res) {
  try { return res.json({ success: true, data: await service.obterContextoPublico(req.params.token) }); }
  catch (error) { return responderErro(res, error, 404); }
}
async function produtos(req, res) {
  try { return res.json({ success: true, data: await service.listarProdutos(req.query.modalidade) }); }
  catch (error) { return responderErro(res, error); }
}
async function datas(req, res) {
  try { return res.json({ success: true, data: await service.listarDatasDisponiveis(req.query.quantidade) }); }
  catch (error) { return responderErro(res, error); }
}
async function transportadoras(req, res) {
  try { return res.json({ success: true, data: await service.listarTransportadoras(req.query.cidade) }); }
  catch (error) { return responderErro(res, error); }
}
async function concluir(req, res) {
  try { return res.status(201).json({ success: true, data: await service.criarPrePedido(req.params.token, req.body || {}) }); }
  catch (error) { return responderErro(res, error); }
}
async function listar(req, res) {
  try { return res.json({ success: true, data: await service.listarPrePedidos(req.query || {}) }); }
  catch (error) { return responderErro(res, error, 500); }
}
async function detalhe(req, res) {
  try { return res.json({ success: true, data: await service.buscarPrePedido(req.params.id) }); }
  catch (error) { return responderErro(res, error, 404); }
}
async function confirmar(req, res) {
  try { return res.json({ success: true, data: await service.confirmarPrePedido(req.params.id) }); }
  catch (error) { return responderErro(res, error, 500); }
}

module.exports = { gerarLink, contexto, produtos, datas, transportadoras, concluir, listar, detalhe, confirmar };
