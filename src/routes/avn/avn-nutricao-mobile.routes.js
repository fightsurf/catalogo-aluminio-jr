'use strict';
// Rotas de nutrição do Android: autenticadas pelo pareamento do dispositivo.
// O usuário vem exclusivamente de req.avnm; não aceitar usuarioId do cliente.
const express = require('express');
const pool = require('../../../db/connection');
const router = express.Router();

/*
 * Carimbo de alteração mantido por trigger: cobre também os PUTs do AVN Web.
 * A DDL é idempotente e executada antes de servir o diário mobile.
 */
const diaryReady=(async()=>{
  await pool.query('ALTER TABLE public.avn_diario_alimentar ADD COLUMN IF NOT EXISTS modificado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  await pool.query(`CREATE OR REPLACE FUNCTION public.avn_diario_carimbar_modificacao()
    RETURNS trigger LANGUAGE plpgsql AS $
    BEGIN NEW.modificado_em = clock_timestamp(); RETURN NEW; END $`);
  await pool.query(`DO $
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.avn_diario_alimentar'::regclass AND tgname='avn_diario_modificacao_mobile') THEN
        CREATE TRIGGER avn_diario_modificacao_mobile
        BEFORE UPDATE ON public.avn_diario_alimentar
        FOR EACH ROW EXECUTE FUNCTION public.avn_diario_carimbar_modificacao();
      END IF;
    END $`);
})().catch(e=>{console.error('[AVN diario sync] Falha ao preparar controle de versão',e);throw e});

const REFEICOES = new Set(['cafe', 'lanche_manha', 'almoco', 'lanche_tarde', 'jantar', 'ceia', 'outros']);
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const wrap = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    console.error('[AVN dieta Android]', e.status || 500, e.message);
    res.status(e.status || 500).json({ erro: e.status ? e.message : 'Falha ao acessar a dieta.' });
  }
};
function id(value) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) throw bad('Identificador inválido.');
  return String(value);
}
function dia(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad('Data inválida.');
  const date = new Date(value + 'T12:00:00Z');
  if (Number.isNaN(+date) || date.toISOString().slice(0, 10) !== value) throw bad('Data inválida.');
  return value;
}
function refeicao(value) {
  if (!REFEICOES.has(value)) throw bad('Refeição inválida.');
  return value;
}
function gramas(value) {
  if (typeof value === 'boolean' || value === null || value === undefined || typeof value === 'object' || String(value).trim() === '') throw bad('Peso inválido.');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) throw bad('Peso deve ser maior que zero e até 10.000 g.');
  return amount;
}
async function planoAtivo(db, usuarioId) {
  const result = await db.query(
    'SELECT id, nome FROM public.avn_dieta_planos WHERE usuario_id=$1 AND ativo ORDER BY id DESC LIMIT 1',
    [usuarioId]
  );
  return result.rows[0] || null;
}

// Usa a mesma dieta padrão, os perfis ativos e os alimentos da versão web.
router.get('/dieta', wrap(async (req, res) => {
  const usuarioId = req.avnm.usuario_id;
  const plano = await planoAtivo(pool, usuarioId);
  if (!plano) return res.set('Cache-Control', 'no-store').json({ plano: null, itens: [] });
  const r = await pool.query(`SELECT i.id AS plano_item_id, i.refeicao, i.ordem,
    i.quantidade_g, a.nome AS alimento_nome,
    COALESCE(i.composicao_100g,
      jsonb_build_object('kcal',a.kcal_100g,'proteinas_g',a.proteinas_g_100g,
        'carboidratos_g',a.carboidratos_g_100g,'gorduras_g',a.gorduras_g_100g,
        'fibras_g',a.fibras_g_100g,'micros',a.micronutrientes_100g)) AS composicao_100g
    FROM public.avn_dieta_itens i
    JOIN public.avn_alimentos a ON a.id=i.alimento_id
    JOIN public.avn_dieta_refeicao_perfis pf ON pf.id=i.perfil_id AND pf.ativo
    WHERE i.plano_id=$1
      AND i.dia_semana=(SELECT MIN(dia_semana) FROM public.avn_dieta_itens WHERE plano_id=$1)
      AND a.ativo AND (a.usuario_id IS NULL OR a.usuario_id=$2)
    ORDER BY i.refeicao, i.ordem, i.id`, [plano.id, usuarioId]);
  res.set('Cache-Control', 'no-store').json({ plano, itens: r.rows });
}));

router.get('/diario', wrap(async (req, res) => {
  await diaryReady;
  const data = dia(req.query.data);
  const r = await pool.query(
    'SELECT id, data_consumo, refeicao, alimento_nome, quantidade_g, composicao_100g, plano_item_id, modificado_em FROM public.avn_diario_alimentar WHERE usuario_id=$1 AND data_consumo=$2 ORDER BY id',
    [req.avnm.usuario_id, data]
  );
  res.set('Cache-Control', 'no-store').json({ data, itens: r.rows });
}));

// O registro é transacional e idempotente pela chave (usuario_id, data, plano_item_id).
// O plano fica intacto: somente a quantidade realmente consumida vai para o diário.
router.post('/diario/registrar-refeicao', wrap(async (req, res) => {
  await diaryReady;
  const usuarioId = req.avnm.usuario_id;
  const data = dia(req.body?.data);
  const ref = refeicao(req.body?.refeicao);
  const recebidos = req.body?.itens;
  if (!Array.isArray(recebidos) || recebidos.length < 1 || recebidos.length > 60)
    throw bad('Selecione de 1 a 60 alimentos.');
  const vistos = new Set();
  const itens = recebidos.map(row => {
    const planoItemId = id(row?.plano_item_id);
    const quantidade = gramas(row?.quantidade_g);
    if (vistos.has(planoItemId)) throw bad('Alimento duplicado na solicitação.');
    vistos.add(planoItemId);
    return { planoItemId, quantidade };
  });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const plano = await planoAtivo(db, usuarioId);
    if (!plano) throw bad('Não existe uma dieta programada ativa.', 404);
    const r = await db.query(`SELECT i.id, i.alimento_id, i.composicao_100g,
      a.nome AS alimento_nome, a.kcal_100g, a.proteinas_g_100g,
      a.carboidratos_g_100g, a.gorduras_g_100g, a.fibras_g_100g,
      a.micronutrientes_100g
      FROM public.avn_dieta_itens i
      JOIN public.avn_alimentos a ON a.id=i.alimento_id
      JOIN public.avn_dieta_refeicao_perfis pf ON pf.id=i.perfil_id AND pf.ativo
      WHERE i.plano_id=$1
        AND i.dia_semana=(SELECT MIN(dia_semana) FROM public.avn_dieta_itens WHERE plano_id=$1)
        AND i.refeicao=$2 AND a.ativo
        AND (a.usuario_id IS NULL OR a.usuario_id=$3)
      FOR SHARE OF i, a`, [plano.id, ref, usuarioId]);
    const permitidos = new Map(r.rows.map(row => [String(row.id), row]));
    if (itens.some(item => !permitidos.has(item.planoItemId)))
      throw bad('A dieta programada foi alterada. Atualize a tela e tente novamente.', 409);
    let inseridos = 0;
    for (const item of itens) {
      const food = permitidos.get(item.planoItemId);
      const composicao = food.composicao_100g || {
        kcal: food.kcal_100g,
        proteinas_g: food.proteinas_g_100g,
        carboidratos_g: food.carboidratos_g_100g,
        gorduras_g: food.gorduras_g_100g,
        fibras_g: food.fibras_g_100g,
        micros: food.micronutrientes_100g || {}
      };
      const saved = await db.query(`INSERT INTO public.avn_diario_alimentar
        (usuario_id,data_consumo,refeicao,alimento_id,alimento_nome,quantidade_g,composicao_100g,plano_item_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
        ON CONFLICT DO NOTHING RETURNING id`,
        [usuarioId, data, ref, food.alimento_id, food.alimento_nome,
          item.quantidade, JSON.stringify(composicao), item.planoItemId]);
      inseridos += saved.rowCount;
    }
    await db.query('COMMIT');
    res.set('Cache-Control', 'no-store').json({
      ok: true, data, refeicao: ref, inseridos,
      ja_registrados: itens.length - inseridos
    });
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { db.release(); }
}));

// Permite corrigir um peso do diário depois da pesagem, sem modificar o plano.

/*
 * Sincronização de edições/exclusões feitas offline, exclusiva do Diário.
 * Última alteração vence, sem confiar cegamente em relógios adiantados.
 * O SELECT FOR UPDATE impede sobrescrita concorrente entre duas sincronizações.
 * Remoção feita na Web prevalece sobre edição de item inexistente no celular.
 */
router.post('/diario/sincronizar-registro',wrap(async(req,res)=>{
  await diaryReady;
  const userId=req.avnm.usuario_id;
  const entryId=id(req.body?.id);
  const action=req.body?.acao;
  if(!['editar','excluir'].includes(action))throw bad('Ação inválida.');
  const weight=action==='editar'?gramas(req.body?.quantidade_g):null;
  const changedAt=new Date(req.body?.alterado_em);
  if(Number.isNaN(changedAt.getTime()))throw bad('Horário da alteração inválido.');
  if(changedAt.getTime()>Date.now()+10*60*1000)
    return res.json({resultado:'conflito',motivo:'Relógio do celular está adiantado. Ajuste data/hora antes de sincronizar.'});
  const base=req.body?.versao_base==null?null:new Date(req.body.versao_base);
  if(base&&Number.isNaN(base.getTime()))throw bad('Versão base inválida.');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const found=await db.query('SELECT id,modificado_em FROM public.avn_diario_alimentar WHERE id=$1 AND usuario_id=$2 FOR UPDATE',[entryId,userId]);
    if(!found.rowCount){
      await db.query('COMMIT');
      return res.json({resultado:'remoto',motivo:'Registro removido no servidor.'});
    }
    const serverAt=found.rows[0].modificado_em.getTime();
    // Quando o registro foi alterado no servidor após a versão vista pelo celular,
    // preserva a alteração mais recente. Empate ou dúvida: não sobrescrever.
    if(base&&serverAt>base.getTime()&&serverAt>=changedAt.getTime()){
      await db.query('COMMIT');
      return res.json({resultado:'remoto',motivo:'Alteração mais recente no AVN Web.'});
    }
    if(!base){
      await db.query('COMMIT');
      return res.json({resultado:'conflito',motivo:'Não foi possível comparar a versão original.'});
    }
    if(action==='editar'){
      await db.query('UPDATE public.avn_diario_alimentar SET quantidade_g=$3 WHERE id=$1 AND usuario_id=$2',[entryId,userId,weight]);
    }else{
      await db.query('DELETE FROM public.avn_diario_alimentar WHERE id=$1 AND usuario_id=$2',[entryId,userId]);
    }
    await db.query('COMMIT');
    return res.json({resultado:'aplicado'});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
}));

router.put('/diario/:id', wrap(async (req, res) => {
  await diaryReady;
  const diarioId = id(req.params.id);
  const quantidade = gramas(req.body?.quantidade_g);
  const r = await pool.query(
    'UPDATE public.avn_diario_alimentar SET quantidade_g=$3 WHERE id=$1 AND usuario_id=$2 RETURNING id, quantidade_g',
    [diarioId, req.avnm.usuario_id, quantidade]
  );
  if (!r.rowCount) throw bad('Registro não encontrado.', 404);
  res.set('Cache-Control', 'no-store').json({ ok: true, item: r.rows[0] });
}));

router.delete('/diario/:id', wrap(async (req, res) => {
  await diaryReady;
  const diarioId = id(req.params.id);
  const r = await pool.query('DELETE FROM public.avn_diario_alimentar WHERE id=$1 AND usuario_id=$2 RETURNING id', [diarioId, req.avnm.usuario_id]);
  if (!r.rowCount) throw bad('Registro não encontrado.', 404);
  res.set('Cache-Control', 'no-store').json({ ok: true });
}));

module.exports = router;
