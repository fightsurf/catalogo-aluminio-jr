'use strict';
// Preferência global e persistente do áudio de apresentação de pedidos.
const pool = require('../../../../db/connection');
const eleven = require('../../integracoes/elevenlabs-jr.service');
let estruturaPromise;
function erro(msg, status=400) { const e=new Error(msg);e.status=status;return e; }
async function garantir() {
  if (!estruturaPromise) estruturaPromise=pool.query(`CREATE TABLE IF NOT EXISTS pedido_resumo_ia_voz_config (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    voz_id VARCHAR(100) NOT NULL,
    modelo_id VARCHAR(80) NOT NULL,
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).catch(err=>{estruturaPromise=null;throw err;});
  return estruturaPromise;
}
async function obter() {
  await garantir();
  const {rows}=await pool.query('SELECT voz_id, modelo_id, atualizado_em FROM pedido_resumo_ia_voz_config WHERE id=1');
  const atual=rows[0];
  const padrao=eleven.configurar();
  return {
    voz:atual?.voz_id || padrao.vozPadrao || '',
    modelo:atual?.modelo_id || 'eleven_multilingual_v2',
    atualizadoEm:atual?.atualizado_em || null
  };
}
async function salvar(data) {
  const voz=String(data?.voz || '').trim();
  const modelo=String(data?.modelo || '').trim();
  if(!/^[a-zA-Z0-9_-]{10,100}$/.test(voz))throw erro('Selecione uma voz ElevenLabs válida.');
  if(!/^[a-zA-Z0-9_-]{5,80}$/.test(modelo))throw erro('Selecione um modelo ElevenLabs válido.');
  // Somente vozes e modelos efetivamente liberados na conta.
  const [vozes,modelos]=await Promise.all([eleven.listarVozes(),eleven.listarModelos()]);
  if(!vozes.some(v=>v.voice_id===voz))throw erro('A voz não está disponível na sua conta ElevenLabs.');
  if(!modelos.some(m=>m.model_id===modelo))throw erro('O modelo não está disponível na sua conta ElevenLabs.');
  await garantir();
  await pool.query(`INSERT INTO pedido_resumo_ia_voz_config(id,voz_id,modelo_id,atualizado_em)
    VALUES(1,$1,$2,NOW()) ON CONFLICT(id) DO UPDATE
    SET voz_id=EXCLUDED.voz_id,modelo_id=EXCLUDED.modelo_id,atualizado_em=NOW()`,[voz,modelo]);
  return obter();
}
module.exports={obter,salvar};
