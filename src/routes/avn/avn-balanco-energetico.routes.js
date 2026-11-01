'use strict';
const express=require('express');
const pool=require('../../../db/connection');
const {avaliarBalanco,valor,estimarCaloriasPassos}=require('../../services/avn/avn-balanco-energetico.service');
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
  " peso.valor AS peso_kg, u.altura_cm,",
  " passos.valor AS passos, passos.disponiveis AS passos_disponiveis, ativas.valor AS ativas",
  "FROM periodos p",
  "CROSS JOIN (SELECT altura_cm FROM public.avn_usuario WHERE id=$1) u",
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
  " SELECT m.valor FROM public.avn_medicoes m",
  " JOIN public.avn_metricas mt ON mt.id=m.metrica_id AND mt.codigo='peso'",
  " WHERE m.usuario_id=$1 AND m.valor BETWEEN 20 AND 350 AND m.data_medicao<p.fim",
  " AND m.data_medicao>=p.fim-INTERVAL '180 days'",
  " ORDER BY m.data_medicao DESC,m.id DESC LIMIT 1",
  ") peso ON TRUE",
  // Para não contar passos já incluídos nas calorias ativas, descontamos
  // proporcionalmente os trechos dos registros de passos sobrepostos aos
  // intervalos de energia ativa do Health Connect.
  "LEFT JOIN LATERAL (",
  " SELECT SUM(s.passos_dia) AS valor,",
  "        SUM(s.passos_dia * (1-s.fracao_coberta)) AS disponiveis",
  " FROM (",
  "  SELECT m.valor * CASE",
  "   WHEN m.data_fim IS NULL OR m.data_fim=m.data_medicao THEN 1",
  "   ELSE GREATEST(0,EXTRACT(EPOCH FROM (LEAST(m.data_fim,p.fim)-GREATEST(m.data_medicao,p.inicio))))",
  "        / NULLIF(EXTRACT(EPOCH FROM (m.data_fim-m.data_medicao)),0) END AS passos_dia,",
  "   CASE WHEN m.data_fim IS NULL OR m.data_fim=m.data_medicao THEN",
  "     CASE WHEN EXISTS (",
  "       SELECT 1 FROM public.avn_medicoes a",
  "       JOIN public.avn_metricas am ON am.id=a.metrica_id AND am.codigo='calorias_ativas'",
  "       WHERE a.usuario_id=$1 AND a.data_medicao<=m.data_medicao",
  "       AND COALESCE(a.data_fim,a.data_medicao)>=m.data_medicao",
  "     ) THEN 1 ELSE 0 END",
  "   ELSE LEAST(1, COALESCE((",
  "     SELECT SUM(GREATEST(0, EXTRACT(EPOCH FROM (",
  "       LEAST(a.data_fim,m.data_fim,p.fim)-GREATEST(a.data_medicao,m.data_medicao,p.inicio)",
  "     ))))",
  "     FROM public.avn_medicoes a",
  "     JOIN public.avn_metricas am ON am.id=a.metrica_id AND am.codigo='calorias_ativas'",
  "     WHERE a.usuario_id=$1 AND a.data_fim>a.data_medicao",
  "       AND a.data_medicao<LEAST(m.data_fim,p.fim)",
  "       AND a.data_fim>GREATEST(m.data_medicao,p.inicio)",
  "   ),0) / NULLIF(EXTRACT(EPOCH FROM (LEAST(m.data_fim,p.fim)-GREATEST(m.data_medicao,p.inicio))),0))",
  "   END AS fracao_coberta",
  "  FROM public.avn_medicoes m",
  "  JOIN public.avn_metricas mt ON mt.id=m.metrica_id AND mt.codigo='passos'",
  "  WHERE m.usuario_id=$1 AND m.data_medicao<p.fim",
  "    AND (m.data_medicao>=p.inicio OR m.data_fim>p.inicio)",
  " ) s",
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
      const disponiveis=valor(x.passos_disponiveis);
      // Sem registros de passos, somente essa parcela vale zero (não é prova de inatividade).
      const estimadas=passos===null?0:estimarCaloriasPassos({
        passos:disponiveis,pesoKg:x.peso_kg,alturaCm:x.altura_cm
      });
      return {
        data:x.dia,
        ingestao:{valor:ingestao,itens,incompletos},
        tmb:{valor:basal,medida_em:x.tmb_data},
        passos:{valor:passos},
        calorias_ativas:{valor:ativas,sem_registros:semRegistrosAtivos},
        calorias_passos:{
          valor:estimadas,
          passos_considerados:disponiveis===null?0:Math.round(disponiveis),
          peso_kg:valor(x.peso_kg),altura_cm:valor(x.altura_cm),
          sem_registros:passos===null,estimativa:true
        },
        saldo:avaliarBalanco({
          ingestao,tmb:basal,ativas:x.ativas,caloriasPassos:estimadas,
          diarioCompleto:itens>0&&incompletos===0
        })
      };
    });
    res.set('Cache-Control','no-store').json({data,usuario_id:id,dias,
      metodo:'Saldo = calorias consumidas - (TMB + calorias ativas registradas + calorias líquidas estimadas dos passos não cobertos pelos registros de calorias ativas). Estimativa dos passos usa peso, altura e distância presumida, não uma medição do relógio. Pode haver imprecisão se os intervalos estiverem incompletos.'});
  }catch(e){console.error('[AVN Balanço Energético]',e);res.status(500).json({erro:'Não foi possível calcular o balanço energético.'});}
});
module.exports=router;
