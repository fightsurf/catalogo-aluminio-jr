const express = require('express');
const pool = require('../../../db/connection');
const router = express.Router();
const cols = 'id, nome, data_nascimento, sexo_referencia_calculo, altura_cm, criado_em, atualizado_em';
const dateString = (d) => d instanceof Date ? d.toISOString().slice(0,10) : String(d).slice(0,10);
const normalize = (row) => row && ({ ...row, data_nascimento: dateString(row.data_nascimento) });
function validate(body) {
  const nome = String(body.nome || '').trim();
  const data = String(body.data_nascimento || '');
  const sexo = String(body.sexo_referencia_calculo || '');
  const altura = Number(body.altura_cm);
  if (!nome || nome.length > 150) return { erro: 'Informe um nome com até 150 caracteres.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(data)) || new Date(data+'T12:00:00Z').toISOString().slice(0,10) !== data || data > new Date().toISOString().slice(0,10)) return { erro: 'Data de nascimento inválida.' };
  if (!['masculino','feminino','nao_informado'].includes(sexo)) return { erro: 'Selecione a referência de cálculo.' };
  if (!Number.isFinite(altura) || altura < 50 || altura > 250) return { erro: 'Altura deve estar entre 50 e 250 cm.' };
  return { nome, data, sexo, altura };
}
router.get('/', async (req,res) => {
 try {
  const busca = String(req.query.busca || '').trim().slice(0,100);
  const r = await pool.query(`SELECT ${cols} FROM public.avn_usuario WHERE ($1 = '' OR translate(lower(nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') LIKE '%' || translate(lower($1),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc') || '%') ORDER BY nome, id LIMIT 200`,[busca]);
  res.json(r.rows.map(normalize));
 } catch(e) { console.error('[AVN] listar',e); res.status(500).json({erro: 'Erro ao consultar usuários. Verifique se a tabela foi criada.'}); }
});
router.get('/:id', async(req,res)=>{
 try { const r=await pool.query(`SELECT ${cols} FROM public.avn_usuario WHERE id=$1`,[req.params.id]); if(!r.rowCount)return res.status(404).json({erro:'Usuário não encontrado.'}); res.json(normalize(r.rows[0])); }
 catch(e){ console.error('[AVN] consultar',e);res.status(500).json({erro:'Erro ao consultar usuário.'}); }
});
router.post('/', async(req,res)=>{
 const v=validate(req.body);if(v.erro)return res.status(400).json(v);
 try {const r=await pool.query(`INSERT INTO public.avn_usuario (nome,data_nascimento,sexo_referencia_calculo,altura_cm) VALUES ($1,$2,$3,$4) RETURNING ${cols}`,[v.nome,v.data,v.sexo,v.altura]);res.status(201).json(normalize(r.rows[0]));}
 catch(e){console.error('[AVN] criar',e);res.status(500).json({erro:'Erro ao cadastrar usuário.'});}
});
router.put('/:id', async(req,res)=>{
 const v=validate(req.body);if(v.erro)return res.status(400).json(v);
 try {const r=await pool.query(`UPDATE public.avn_usuario SET nome=$1,data_nascimento=$2,sexo_referencia_calculo=$3,altura_cm=$4,atualizado_em=NOW() WHERE id=$5 RETURNING ${cols}`,[v.nome,v.data,v.sexo,v.altura,req.params.id]);if(!r.rowCount)return res.status(404).json({erro:'Usuário não encontrado.'});res.json(normalize(r.rows[0]));}
 catch(e){console.error('[AVN] atualizar',e);res.status(500).json({erro:'Erro ao atualizar usuário.'});}
});
router.delete('/:id',async(req,res)=>{
 try {const r=await pool.query('DELETE FROM public.avn_usuario WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)return res.status(404).json({erro:'Usuário não encontrado.'});res.json({ok:true});}
 catch(e){console.error('[AVN] excluir',e);res.status(e.code==='23503'?409:500).json({erro:e.code==='23503'?'Este usuário possui registros vinculados e não pode ser excluído.':'Erro ao excluir usuário.'});}
});
module.exports=router;
