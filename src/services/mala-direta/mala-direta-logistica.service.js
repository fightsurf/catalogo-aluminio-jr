'use strict';
const pool=require('../../../db/connection');
const {telefones:extrairTelefones}=require('../logistica/importacaoExcursoesUtils');

// Retorna todos os números válidos do cadastro, priorizando o telefone principal.
function numeros(cadastro) {
  const vistos=new Set(),saida=[];
  for(const campo of [cadastro.telefone_principal,cadastro.telefone]){
    for(const numero of extrairTelefones(campo)){
      const completo='55'+numero;
      if(!vistos.has(completo)){vistos.add(completo);saida.push(completo);}
    }
  }
  return saida;
}
async function consultar(grupo='todos') {
  if(!['todos','transportadoras','agencias'].includes(grupo)){
    const e=new Error('Grupo da logística inválido.');e.status=400;throw e;
  }
  const pessoas=[],vistos=new Set();
  const incluir=(origem,id,nome,cidade,cadastro)=>{
    for(const numero of numeros(cadastro)){
      // Um número compartilhado entre registros será destinatário apenas uma vez.
      if(vistos.has(numero))continue;
      vistos.add(numero);
      pessoas.push({
        referencia:origem+':'+id+':'+numero,
        nome:String(nome||'(sem nome)'),
        cidade:String(cidade||'-'),
        telefone:numero,telefoneNormalizado:numero,
        quantidade:null,pedidos:null,ultimaCompra:null,origem:origem==='t'?'Transportadora':'Agência'
      });
    }
  };
  if(grupo!=='agencias'){
    const t=await pool.query(`SELECT t.id,t.nome,t.telefone,t.telefone_principal,
      c.nome AS cidade_nome,c.estado AS cidade_estado
      FROM transportadoras t LEFT JOIN cidades c ON c.id=t.cidade_id
      ORDER BY LOWER(t.nome),t.id`);
    for(const r of t.rows)incluir('t',r.id,r.nome,
      [r.cidade_nome,r.cidade_estado].filter(Boolean).join(' - '),r);
  }
  if(grupo!=='transportadoras'){
    const a=await pool.query(`SELECT a.codigo,a.nome,a.telefone,c.nome AS cidade_nome,c.estado AS cidade_estado
      FROM agencias_recebimento a LEFT JOIN cidades c ON c.id=a.cidade_id
      ORDER BY LOWER(a.nome),a.codigo`);
    for(const r of a.rows)incluir('a',r.codigo,r.nome,
      [r.cidade_nome,r.cidade_estado].filter(Boolean).join(' - '),r);
  }
  const tel=pessoas.map(p=>p.telefone);
  const r=tel.length?await pool.query(
    'SELECT telefone FROM mala_direta_bloqueios WHERE telefone=ANY($1::varchar[])',[tel]
  ):{rows:[]};
  const bloqueados=new Set(r.rows.map(x=>x.telefone));
  return pessoas.map(p=>({...p,bloqueado:bloqueados.has(p.telefone)}));
}
module.exports={consultar,numeros};
