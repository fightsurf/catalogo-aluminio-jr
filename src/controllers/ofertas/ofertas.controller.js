const produtoService = require('../../services/produto/produto.service');
const ofertasService = require('../../services/ofertas/ofertas.service');

function erro(res, error, status=400) { return res.status(status).json({ success:false, message:error.message }); }

async function produtos(req,res){ try { res.json({success:true,data:await produtoService.listar({perfil:'kit-feirinha',apenasAtivos:true})}); } catch(e){ erro(res,e,500); } }
async function listar(req,res){ try { res.json({success:true,data:await ofertasService.listar()}); } catch(e){ erro(res,e,500); } }
async function criar(req,res){ try { res.status(201).json({success:true,data:await ofertasService.criar(req.body)}); } catch(e){ erro(res,e); } }
async function gerarArte(req,res){ try { res.json({success:true,data:await ofertasService.gerarArte(req.params.id)}); } catch(e){ erro(res,e,502); } }
async function publicar(req,res){ try { const base=`${req.protocol}://${req.get('host')}`; res.json({success:true,data:await ofertasService.publicar(req.params.id,base)}); } catch(e){ erro(res,e,502); } }
async function enviarWhatsapp(req,res){ try { const base=`${req.protocol}://${req.get('host')}`; res.json({success:true,data:await ofertasService.enviarWhatsapp(req.params.id,req.body?.telefone,base)}); } catch(e){ const status=/não informado|inválido|Gere a arte/i.test(e.message)?400:502; erro(res,e,status); } }
async function duplicar(req,res){ try { res.status(201).json({success:true,data:await ofertasService.duplicar(req.params.id)}); } catch(e){ erro(res,e); } }
async function publica(req,res){ try { res.json({success:true,data:await ofertasService.buscarPorCodigo(req.params.codigo,true)}); } catch(e){ erro(res,e,404); } }
async function clique(req,res){ try { res.json({success:true,data:await ofertasService.registrarClique(req.params.codigo)}); } catch(e){ erro(res,e,404); } }
module.exports={produtos,listar,criar,gerarArte,publicar,enviarWhatsapp,duplicar,publica,clique};
