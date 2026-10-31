'use strict';
const pool=require('../../../db/connection');
let pending=null;
module.exports=function ensureCarga(){
 if(!pending)pending=(async()=>{
  for(const table of ['avn_plano_itens','avn_treino_sessao_itens','avn_treino_execucao_eventos']){
   await pool.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS carga_unidade VARCHAR(6) NOT NULL DEFAULT 'kg' CHECK (carga_unidade IN ('kg','placas'))`);
   await pool.query(`ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS carga_placas SMALLINT CHECK (carga_placas BETWEEN 0 AND 200)`);
  }
 })().catch(e=>{pending=null;throw e});
 return pending;
};
