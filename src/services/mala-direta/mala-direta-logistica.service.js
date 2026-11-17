'use strict';
const pool=require('../../../db/connection');
const {telefones:extrairTelefones}=require('../logistica/importacaoExcursoesUtils');
const GRUPOS=['todos','transportadoras','agencias'];
function validarGrupo(grupo){
  if(!GRUPOS.includes(grupo)){const e=new Error('Grupo da logística inválido.');e.status=400;throw e;}
}
function validarCidade(cidade){
  if(cidade===null||cidade===undefined||cidade==='')return null;
  const numero=Number(cidade);
  if(!Number.isSafeInteger(numero)||numero<1){const e=new Error('Cidade da logística inválida.');e.status=400;throw e;}
  return numero;
}
function numeros(cadastro){
  const vistos=new Set(),saida=[];
  for(const campo of [cadastro.telefone_principal,cadastro.telefone]){
    for(const numero of extrairTelefones(campo)){
      const completo='55'+numero;
      if(!vistos.has(completo)){vistos.add(completo);saida.push(completo);}
    }
  }
  return saida;
}
// Cadastro importado: a localidade vinculada fica em transportadora_cidade.
// Nos cadastros antigos sem vínculos de rota, usamos cidade_id como alternativa.
// Importante: cidades de rota podem não ser a origem exclusiva da excursão.
const LOCAL_TRANSPORTADORA=`(
  EXISTS(SELECT 1 FROM transportadora_cidade tc WHERE tc.transportadora_id=t.id AND tc.cidade_id=$1)
  OR (t.cidade_id=$1 AND NOT EXISTS
    (SELECT 1 FROM transportadora_cidade tc2 WHERE tc2.transportadora_id=t.id))
)`;
async function cidades(grupo='todos'){
  validarGrupo(grupo);
  const partes=[];
  if(grupo!=='agencias')partes.push(`SELECT c.id,c.nome,c.estado
    FROM cidades c WHERE EXISTS(
      SELECT 1 FROM transportadoras t WHERE
      EXISTS(SELECT 1 FROM transportadora_cidade tc WHERE tc.transportadora_id=t.id AND tc.cidade_id=c.id)
      OR (t.cidade_id=c.id AND NOT EXISTS (SELECT 1 FROM transportadora_cidade x WHERE x.transportadora_id=t.id))
    )`);
  if(grupo!=='transportadoras')partes.push(`SELECT c.id,c.nome,c.estado
    FROM cidades c INNER JOIN agencias_recebimento a ON a.cidade_id=c.id`);
  const resultado=await pool.query(`SELECT DISTINCT id,nome,estado FROM (${partes.join(' UNION ALL ')}) locais ORDER BY nome,estado`);
  return resultado.rows.map(c=>({id:Number(c.id),nome:c.nome,uf:c.estado,label:[c.nome,c.estado].filter(Boolean).join(' - ')}));
}
async function consultar(grupo='todos',cidade=null){
  validarGrupo(grupo);
  const cidadeId=validarCidade(cidade);
  const pessoas=[],vistos=new Set();
  const incluir=(origem,id,nome,cidadeNome,cadastro)=>{
    for(const numero of numeros(cadastro)){
      if(vistos.has(numero))continue;
      vistos.add(numero);
      pessoas.push({
        referencia:origem+':'+id+':'+numero,
        nome:String(nome||'(sem nome)'),
        cidade:String(cidadeNome||'-'),
        telefone:numero,telefoneNormalizado:numero,
        quantidade:null,pedidos:null,ultimaCompra:null,origem:origem==='t'?'Transportadora':'Agência'
      });
    }
  };
  if(grupo!=='agencias'){
    const t=await pool.query(`SELECT t.id,t.nome,t.telefone,t.telefone_principal,
      c.nome AS cidade_nome,c.estado AS cidade_estado
      FROM transportadoras t LEFT JOIN cidades c ON c.id=t.cidade_id
      WHERE ($1::bigint IS NULL OR ${LOCAL_TRANSPORTADORA})
      ORDER BY LOWER(t.nome),t.id`,[cidadeId]);
    for(const r of t.rows)incluir('t',r.id,r.nome,
      [r.cidade_nome,r.cidade_estado].filter(Boolean).join(' - '),r);
  }
  if(grupo!=='transportadoras'){
    const a=await pool.query(`SELECT a.codigo,a.nome,a.telefone,c.nome AS cidade_nome,c.estado AS cidade_estado
      FROM agencias_recebimento a LEFT JOIN cidades c ON c.id=a.cidade_id
      WHERE ($1::bigint IS NULL OR a.cidade_id=$1)
      ORDER BY LOWER(a.nome),a.codigo`,[cidadeId]);
    for(const r of a.rows)incluir('a',r.codigo,r.nome,
      [r.cidade_nome,r.cidade_estado].filter(Boolean).join(' - '),r);
  }
  const tels=pessoas.map(p=>p.telefone);
  const r=tels.length?await pool.query(
    'SELECT telefone FROM mala_direta_bloqueios WHERE telefone=ANY($1::varchar[])',[tels]
  ):{rows:[]};
  const bloqueados=new Set(r.rows.map(x=>x.telefone));
  return pessoas.map(p=>({...p,bloqueado:bloqueados.has(p.telefone)}));
}
module.exports={consultar,numeros,cidades};
