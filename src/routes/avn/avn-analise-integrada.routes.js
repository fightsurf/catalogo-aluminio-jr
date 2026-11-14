'use strict';
// Relatório exportável: consultas somente de leitura. Nenhum dado é enviado a terceiros.
const express = require('express');
const pool = require('../../../db/connection');
const router = express.Router();
const ZONA = 'America/Sao_Paulo';
function dataISO(v) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(+d) && d.toISOString().slice(0,10) === s ? s : null;
}
function retroceder(dias, data) {
  const d = new Date(data + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0,10);
}
function hojeLocal() {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:ZONA,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const p = k => parts.find(x=>x.type===k).value;
  return p('year')+'-'+p('month')+'-'+p('day');
}
const consulta = {
  diario: [
    'SELECT id,data_consumo::text AS data,refeicao,alimento_id,alimento_nome,quantidade_g,composicao_100g',
    'FROM public.avn_diario_alimentar WHERE usuario_id=$1 AND data_consumo BETWEEN $2::date AND $3::date',
    'ORDER BY data_consumo,refeicao,id'
  ].join(' '),
  receitas: [
    'SELECT r.id AS receita_id,r.alimento_id,r.nome,r.rendimento_g,',
    'ri.id AS ingrediente_id,ri.alimento_id AS ingrediente_alimento_id,',
    'ri.nome_snapshot AS ingrediente_nome,ri.quantidade_g AS ingrediente_quantidade_g,ri.ordem',
    'FROM public.avn_receitas r LEFT JOIN public.avn_receita_ingredientes ri ON ri.receita_id=r.id',
    'WHERE r.usuario_id=$1 ORDER BY r.id,ri.ordem,ri.id'
  ].join(' '),
  agua: [
    "SELECT (ingerido_em AT TIME ZONE 'America/Sao_Paulo')::date::text AS data,",
    'SUM(quantidade_ml)::numeric AS quantidade_ml',
    'FROM public.avn_agua_registros WHERE usuario_id=$1 AND removido_em IS NULL',
    "AND (ingerido_em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date",
    'GROUP BY 1 ORDER BY 1'
  ].join(' '),
  sono: [
    'SELECT s.id,s.inicio,s.fim,s.duracao_min,s.pontuacao,s.sessoes_quantidade,s.origem,',
    'e.tipo AS fase_tipo,e.inicio AS fase_inicio,e.fim AS fase_fim',
    'FROM public.avn_sono_sessoes s LEFT JOIN public.avn_sono_estagios e ON e.sessao_id=s.id',
    'WHERE s.usuario_id=$1',
    "AND (s.fim AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date AND $3::date",
    'ORDER BY s.fim,e.posicao'
  ].join(' '),
  medicoes: [
    'SELECT m.id,mt.codigo,mt.nome,mt.unidade,m.valor,m.data_medicao,m.data_fim,m.origem,m.aplicativo_origem,m.qualidade',
    'FROM public.avn_medicoes m JOIN public.avn_metricas mt ON mt.id=m.metrica_id',
    'WHERE m.usuario_id=$1 AND m.data_medicao>=($2::date::timestamp AT TIME ZONE \'America/Sao_Paulo\')',
    'AND m.data_medicao<(($3::date+1)::timestamp AT TIME ZONE \'America/Sao_Paulo\')',
    "AND mt.codigo IN ('peso','imc','gordura_corporal','massa_magra','agua_corporal','massa_ossea','gordura_visceral','tmb')",
    'ORDER BY m.data_medicao,m.id'
  ].join(' '),
  treinos: [
    'SELECT s.id AS sessao_id,s.realizado_em,s.observacoes AS sessao_observacoes,p.nome AS plano_nome,',
    'i.id AS item_id,e.nome AS exercicio,g.nome AS grupo_muscular,',
    'i.series_realizadas,i.repeticoes_realizadas,i.carga_kg,i.carga_unidade,i.carga_placas,i.observacoes',
    'FROM public.avn_treino_sessoes s JOIN public.avn_planos_treino p ON p.id=s.plano_id',
    'LEFT JOIN public.avn_treino_sessao_itens i ON i.sessao_id=s.id',
    'LEFT JOIN public.avn_exercicios e ON e.id=i.exercicio_id',
    'LEFT JOIN public.avn_exercicio_grupos g ON g.id=e.grupo_id',
    'WHERE s.usuario_id=$1 AND s.realizado_em>=($2::date::timestamp AT TIME ZONE \'America/Sao_Paulo\')',
    'AND s.realizado_em<(($3::date+1)::timestamp AT TIME ZONE \'America/Sao_Paulo\')',
    'ORDER BY s.realizado_em,s.id,i.posicao,i.id'
  ].join(' '),
  atividades: [
    'SELECT inicio,fim,tipo_atividade,titulo,calorias_kcal,origem,aplicativo_origem',
    'FROM public.avn_atividades WHERE usuario_id=$1',
    "AND inicio<(($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')",
    "AND fim>=($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')",
    'ORDER BY inicio'
  ].join(' '),
  exames: [
    'SELECT x.* FROM (SELECT c.nome AS exame_nome,c.codigo,r.data_coleta::text AS data_coleta,',
    'r.valor,r.valor_texto,r.unidade,r.limite_inferior,r.limite_superior,r.referencia_texto,',
    'r.material,r.metodo,r.laboratorio,',
    'ROW_NUMBER() OVER(PARTITION BY r.exame_id ORDER BY r.data_coleta DESC,r.id DESC) AS ordem',
    'FROM public.avn_exames_resultados r JOIN public.avn_exames_catalogo c ON c.id=r.exame_id',
    'WHERE r.usuario_id=$1) x WHERE x.ordem<=2 ORDER BY x.exame_nome,x.ordem'
  ].join(' ')
};
router.get('/:usuarioId', async(req,res)=>{
  try {
    const uid=String(req.params.usuarioId || '');
    if (!/^[1-9]\d*$/.test(uid)) return res.status(400).json({erro:'Usuário inválido.'});
    const fim=dataISO(req.query.data || hojeLocal());
    if(!fim || fim>hojeLocal()) return res.status(400).json({erro:'Data final inválida.'});
    const inicio=retroceder(59,fim), inicioAtual=retroceder(29,fim), fimAnterior=retroceder(30,fim);
    const usuario=await pool.query('SELECT id,nome,altura_cm FROM public.avn_usuario WHERE id=$1',[uid]);
    if(!usuario.rowCount) return res.status(404).json({erro:'Usuário não encontrado.'});
    const results=await Promise.all([
      pool.query(consulta.diario,[uid,inicio,fim]),
      pool.query(consulta.receitas,[uid]),
      pool.query(consulta.agua,[uid,inicio,fim]),
      pool.query(consulta.sono,[uid,inicio,fim]),
      pool.query(consulta.medicoes,[uid,inicio,fim]),
      pool.query(consulta.treinos,[uid,inicio,fim]),
      pool.query(consulta.atividades,[uid,inicio,fim]),
      pool.query(consulta.exames,[uid]),
      pool.query('SELECT kcal,proteinas_g,carboidratos_g,gorduras_g,fibras_g,micros,atualizado_em FROM public.avn_metas_nutricionais WHERE usuario_id=$1',[uid]),
      pool.query('SELECT codigo,nome,unidade,categoria FROM public.avn_nutrientes ORDER BY categoria,nome',[ ]),
      pool.query('SELECT nivel,anos_experiencia,regularidade,dias_semana,duracao_min,objetivo,limitacoes,preferencias FROM public.avn_treino_perfil WHERE usuario_id=$1',[uid])
    ]);
    const [diario,receitas,agua,sono,medicoes,treinos,atividades,exames,metas,nutrientes,perfil]=results;
    res.set('Cache-Control','private, no-store').json({
      versao:1,gerado_em:new Date().toISOString(),
      periodo:{inicio:inicioAtual,fim,anterior_inicio:inicio,anterior_fim:fimAnterior,dias:30},
      usuario:usuario.rows[0],
      diario:diario.rows,receitas:receitas.rows,agua:agua.rows,sono:sono.rows,
      medicoes:medicoes.rows,treinos:treinos.rows,atividades:atividades.rows,
      exames:exames.rows,metas_atuais:metas.rows[0] || null,
      nutrientes:nutrientes.rows,perfil_treinamento:perfil.rows[0] || null,
      avisos:[
        'Relatório baseado em registros do AVN; dados ausentes não são zero.',
        'Ingredientes de receitas refletem a receita atualmente cadastrada, que pode ter mudado desde o consumo.',
        'Micronutrientes incompletos não permitem afirmar ingestão total ou deficiência.',
        'Medições de bioimpedância e estimativas do relógio têm incerteza.'
      ]
    });
  } catch(e) {
    console.error('[AVN relatório integrado]',e.code || e.name || 'Erro');
    res.status(500).set('Cache-Control','no-store').json({erro:'Não foi possível gerar os dados do relatório integrado.'});
  }
});
module.exports=router;
