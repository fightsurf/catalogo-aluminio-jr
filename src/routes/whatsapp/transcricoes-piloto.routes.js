'use strict';
const express = require('express');
const path = require('path');
const { requireAuth } = require('../../middlewares/adminAuth.middleware');
const piloto = require('../../services/whatsapp/transcricoes-piloto.service');
const intencoes = require('../../services/whatsapp/intencoes-admin.service');
const acoes = require('../../services/whatsapp/acoes-admin.service');
const router = express.Router();

router.use(requireAuth);
router.get('/', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '../../../views/whatsapp/transcricoes-piloto.html'));
});
router.get('/api', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, ...piloto.listar() });
});
// Cadastro próprio; não altera as intenções do bot de atendimento.
function idValido(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'Identificador inválido.' });
    return null;
  }
  return id;
}
function mesmaOrigem(req, res, next) {
  const origem = req.get('origin');
  if (origem) {
    try {
      if (new URL(origem).host !== req.get('host')) {
        return res.status(403).json({ success: false, message: 'Origem não autorizada.' });
      }
    } catch (_) { return res.status(403).json({ success: false }); }
  }
  next();
}
router.get('/intencoes', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, acoes: intencoes.ACOES, dados: await intencoes.listar() });
  } catch (e) {
    console.error('[Intenções administrativas] Falha ao listar:', e.message);
    res.status(503).json({ success: false, message: 'Cadastro administrativo indisponível.' });
  }
});
router.post('/intencoes', mesmaOrigem, async (req, res) => {
  try { res.status(201).json({ success: true, dado: await intencoes.cadastrar(req.body) }); }
  catch (e) { res.status(/indisponível|relation|connect|timeout/i.test(e.message) ? 503 : 400)
    .json({ success: false, message: e.message }); }
});
router.put('/intencoes/:id', mesmaOrigem, async (req, res) => {
  const id = idValido(req,res); if (!id) return;
  try { res.json({ success: true, dado: await intencoes.atualizar(id, req.body) }); }
  catch (e) { res.status(400).json({ success: false, message: e.message }); }
});
router.delete('/intencoes/:id', mesmaOrigem, async (req, res) => {
  const id = idValido(req,res); if (!id) return;
  try { await intencoes.excluir(id); res.json({ success: true }); }
  catch (e) { res.status(400).json({ success: false, message: e.message }); }
});


// Catálogo de entidades expõe apenas campos explicitamente autorizados pelo código.
router.get('/acoes/catalogo', (_req,res) => {
  res.set('Cache-Control','no-store');
  res.json({success:true,entidades:acoes.ENTIDADES});
});
router.get('/acoes', async (_req,res) => {
  try {
    res.set('Cache-Control','no-store');
    res.json({success:true,dados:await acoes.listar()});
  } catch(e) {
    console.error('[Ações administrativas] Falha ao listar:',e.message);
    res.status(503).json({success:false,message:'Cadastro de ações indisponível.'});
  }
});
router.post('/acoes',mesmaOrigem,async(req,res)=>{
  try {res.status(201).json({success:true,dado:await acoes.cadastrar(req.body)});}
  catch(e){res.status(/connect|timeout|relation|indisponível/i.test(e.message)?503:400).json({success:false,message:e.message});}
});
router.put('/acoes/:id',mesmaOrigem,async(req,res)=>{
  const id=idValido(req,res); if(!id)return;
  try{res.json({success:true,dado:await acoes.atualizar(id,req.body)});}
  catch(e){res.status(400).json({success:false,message:e.message});}
});
router.delete('/acoes/:id',mesmaOrigem,async(req,res)=>{
  const id=idValido(req,res); if(!id)return;
  try{
    await intencoes.preparar(); // garante a coluna acao_id para verificar vínculos
    await acoes.excluir(id);
    res.json({success:true});
  }catch(e){res.status(400).json({success:false,message:e.message});}
});

// Server-Sent Events: mantém somente o painel de mensagens sincronizado.
// Não há polling nem recarregamento da página. Exige a sessão administrativa.
router.get('/eventos', (_req, res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');

  const enviar = registros => {
    if (res.destroyed || res.writableEnded) return;
    res.write('event: mensagens\ndata: ' + JSON.stringify({ registros }) + '\n\n');
    res.flush?.();
  };
  const cancelar = piloto.assinarMensagens(enviar);
  const manterConexao = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) {
      res.write(': conexao ativa\n\n');
      res.flush?.();
    }
  }, 25000);
  manterConexao.unref?.();
  const limparConexao = () => {
    clearInterval(manterConexao);
    cancelar();
  };
  res.once('close', limparConexao);
  res.once('error', limparConexao);
  enviar(piloto.listarMensagens());
});

module.exports = router;
