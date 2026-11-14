'use strict';
const pool = require('../../../db/connection');

// Registros reais do treino (Web manual, Web em tempo real e Android).
// Mantemos a carga planejada intacta e devolvemos a última carga como campo separado.
async function aplicarUltimasCargas(usuarioId, dias, client=pool) {
  const {rows}=await client.query(`
    WITH cargas AS (
      SELECT i.exercicio_id,i.carga_kg,COALESCE(i.carga_unidade,'kg') AS carga_unidade,
             i.carga_placas,s.realizado_em AS data_carga,0 AS fonte
      FROM public.avn_treino_sessao_itens i
      JOIN public.avn_treino_sessoes s ON s.id=i.sessao_id
      WHERE s.usuario_id=$1
      UNION ALL
      SELECT e.exercicio_id,e.carga_kg,COALESCE(e.carga_unidade,'kg') AS carga_unidade,
             e.carga_placas,e.ocorrido_em AS data_carga,1 AS fonte
      FROM public.avn_treino_execucao_eventos e
      JOIN public.avn_treino_execucoes x ON x.id=e.execucao_id
      WHERE x.usuario_id=$1 AND e.tipo='SERIE_CONCLUIDA'
    )
    SELECT DISTINCT ON (exercicio_id) exercicio_id,carga_kg,carga_unidade,carga_placas,data_carga
    FROM cargas WHERE
      (carga_unidade='kg' AND carga_kg IS NOT NULL) OR
      (carga_unidade='placas' AND carga_placas IS NOT NULL)
    ORDER BY exercicio_id,data_carga DESC,fonte DESC
  `,[usuarioId]);
  const mapa=new Map(rows.map(r=>[String(r.exercicio_id),r]));
  for(const dia of dias)for(const item of dia.exercicios||[]) {
    const ultima=mapa.get(String(item.exercicio_id));
    if(ultima) {
      item.ultima_carga_unidade=ultima.carga_unidade;
      item.ultima_carga_kg=ultima.carga_kg;
      item.ultima_carga_placas=ultima.carga_placas;
      item.ultima_carga_em=ultima.data_carga;
    }
  }
  return dias;
}
module.exports={aplicarUltimasCargas};
