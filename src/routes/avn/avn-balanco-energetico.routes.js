'use strict';
const express=require('express');
const pool=require('../../../db/connection');
const {avaliarBalanco,valor}=require('../../services/avn/avn-balanco-energetico.service');
const router=express.Router();

const SQL=[
  "WITH dias AS (",
  " SELECT g.dia::date AS dia FROM generate_series($2::date - 6, $2::date, INTERVAL '1 day') AS g(dia)",
  "), periodos AS (",
  " SELECT dia, dia::timestamp AT TIME ZONE 'America/Sao_Paulo' AS inicio,",
  "        (dia+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS fim FROM dias",
  ")",
  "SELECT p.dia::text AS dia,",
  " diario.itens, diario.sem_kcal, diario.kcal AS ingeridas,",
  " tmb.valor AS tmb, tmb.data_medicao AS tmb_data,",
  " passos.valor AS passos, ativas.valor AS ativas",
  "FROM periodos p",
  "LEFT JOIN LATERAL (",
  " SELECT COUNT(*)::int AS itens,",
  "   COUNT(*) FILTER (WHERE composicao_100g->>'kcal' IS NULL OR composicao_100g->>'kcal'='')::int AS sem_kcal,",
  "   COALESCE(SUM(quantidade_g * (composicao_100g->>'kcal')::numeric / 100),0) AS kcal",
  " FROM public.avn_diario_alimentar WHERE usuario_id=$1 AND data_consumo=p.dia",
  ") diario ON TRUE",
  "LEFT JOIN LATERAL (",
  " SELECT m.valor, m.data_medicao FROM public.avn_medicoes m",
  " JOIN public.avn_metricas mt ON mt.id=m.metrica_id AND mt.codigo='tmb'",
  " WHERE m.usuario_id=$1 AND m.valor>0 AND m.data_medicao<p.fim",
  " AND m.data_medicao>=p.fim-INTERVAL '90 days'",
  " ORDER BY m.data_medicao DESC,m.id DESC LIMIT 1",
  ") tmb ON TRUE",
  "LEFT JOIN LATERAL (",
  " SELECT SUM(m.valor * CASE",
  "   WHEN m.data_fim IS NULL OR m.data_fim=m.data_medicao THEN 1",
  "   ELSE GREATEST(0,EXTRACT(EPOCH FROM (LEAST(m.data_fim,p.fim)-GREATEST(m.data_medicao,p.inicio))))",
  "        / NULLIF(EXTRACT(EPOCH FROM (m.data_fim-m.data_medicao)),0) END) AS valor",
  " FROM public.avn_medicoes m",
  " JOIN public.avn_metricas mt ON mt.id=m.metrica_id AND mt.codigo='passos'",
  " WHERE m.usuario_id=$1 AND m.data_medicao<p.fim",
  " AND (m.data_medicao>=p.inicio OR m.data_fim>p.inicio)",
  ") passos ON TRUE",
  "LEFT JOIN LATERAL (",
  " SELECT SUM(m.valor * CASE",
  "   WHEN m.data_fim IS NULL OR m.data_fim=m.data_medicao THEN 1",
  "   ELSE GREATEST(0,EXTRACT(EPOCH FROM (LEAST(m.data_fim,p.fim)-GREATEST(m.data_medicao,p.inicio))))",
  "        / NULLIF(EXTRACT(EPOCH FROM (m.data_fim-m.data_medicao)),0) END) AS valor",
  " FROM public.avn_medicoes m",
  " JOIN public.avn_metricas mt ON mt.id=m.metrica_id AND mt.codigo='calorias_ativas'",
  " WHERE m.usuario_id=$1 AND m.data_medicao<p.fim",
  " AND (m.data_medicao>=p.inicio OR m.data_fim>p.inicio)",
  ") ativas ON TRUE",
  "ORDER BY p.dia"
].join('\n');

function validarData(input) {
  const d=String(input||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;
  const parsed=new Date(d+'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10)===d;
}
router.get('/:usuarioId',async(req,res)=>{
  try {
    const id=String(req.params.usuarioId);
    const data=String(req.query.data||'');
    if(!/^[1-9]\d*$/.test(id)||!validarData(data))
      return res.status(400).json({erro:'Informe um usuário e uma data válida (AAAA-MM-DD).'});
    const usuario=await pool.query('SELECT 1 FROM public.avn_usuario WHERE id=$1',[id]);
    if(!usuario.rowCount)return res.status(404).json({erro:'Usuário não encontrado.'});
    const r=await pool.query(SQL,[id,data]);
    const dias=r.rows.map(x=>{
      const itens=Number(x.itens||0),incompletos=Number(x.sem_kcal||0);
      const ingestao=itens ? valor(x.ingeridas):null;
      const basal=valor(x.tmb),passos=valor(x.passos);
      const semRegistrosAtivos=x.ativas===null||x.ativas===undefined;
      const ativas=semRegistrosAtivos?0:valor(x.ativas);
      return {
        data:x.dia,
        ingestao:{valor:ingestao,itens,incompletos},
        tmb:{valor:basal,medida_em:x.tmb_data},
        passos:{valor:passos},
        calorias_ativas:{valor:ativas,sem_registros:semRegistrosAtivos},
        saldo:avaliarBalanco({ingestao,tmb:basal,ativas:x.ativas,diarioCompleto:itens>0&&incompletos===0})
      };
    });
    res.set('Cache-Control','no-store').json({data,usuario_id:id,dias,
      metodo:'TMB + calorias ativas (0 kcal quando não houver registros); os passos não são somados novamente. Digestão e atividades não registradas podem elevar o gasto real.'});
  }catch(e){console.error('[AVN Balanço Energético]',e);res.status(500).json({erro:'Não foi possível calcular o balanço energético.'});}
});
module.exports=router;
