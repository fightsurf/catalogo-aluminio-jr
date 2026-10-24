'use strict';
const service = require('../../services/whatsapp/status-agendamentos.service');

async function painel(req,res) {
  try { return res.json({success:true,data:await service.painel()}); }
  catch(e) {
    console.error('[Status agendado] Consulta:',e);
    return res.status(500).json({success:false,message:'Erro ao consultar agendamentos.'});
  }
}
async function salvar(req,res) {
  try { return res.json({success:true,data:await service.salvarConfiguracao(req.body)}); }
  catch(e) {
    if (e.status !== 400) console.error('[Status agendado] Gravação:',e);
    return res.status(e.status===400?400:500).json({
      success:false,message:e.status===400?e.message:'Erro ao salvar agendamento.'
    });
  }
}
module.exports={painel,salvar};
