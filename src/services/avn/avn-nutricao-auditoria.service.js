'use strict';
// Auditoria heurística: sinaliza inconsistências sem substituir evidência analítica.
const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
function auditar(dados,{alegaFonte=false}={}){
 const alertas=[];
 const add=(codigo,mensagem,nivel='revisar')=>alertas.push({codigo,mensagem,nivel});
 const m=dados.macros||{},u=dados.micros||{};
 const p=n(m.proteinas_g),c=n(m.carboidratos_g),g=n(m.gorduras_g),k=n(m.kcal),f=n(m.fibras_g);
 if([p,c,g].every(v=>v!==null)){
  const soma=p+c+g+(f??0);
  if(soma>105)add('massa_macros','Soma dos macronutrientes e fibras maior que 105 g por 100 g. Confira porções e unidades.');
  if(k!==null){const estimado=4*p+4*c+9*g;
   if(Math.abs(k-estimado)>Math.max(45,estimado*.25))add('energia_macros',`Energia (${k} kcal) difere bastante da estimativa por macros (${Math.round(estimado)} kcal). Confira dados e tipos de carboidrato/fibra.`);
  }
 }
 if(k!==null&&k>900)add('energia_extrema','Energia superior a 900 kcal/100 g: confira a unidade ou referência.');
 if(g!==null&&g>100)add('gordura_extrema','Gordura superior a 100 g por 100 g.');
 if(f!==null&&f>100)add('fibra_extrema','Fibras superiores a 100 g por 100 g.');
 if(n(u.agua_g)!==null&&n(u.agua_g)>100)add('agua_extrema','Água superior a 100 g por 100 g.');
 if(n(u.agua_g)!==null&&[p,c,g].every(v=>v!==null)&&u.agua_g+p+c+g>107)add('balanco_massa','Água e macronutrientes superam 107 g por 100 g: confira a base de cálculo.');
 if(n(u.colesterol_mg)!==null&&u.colesterol_mg>2500)add('colesterol_extremo','Colesterol acima de 2.500 mg/100 g: confirme unidades e alimento.');
 for(const [code,value] of Object.entries(u)){
  if(n(value)===null)continue;
  if(code.endsWith('_g')&&value>100)add('gramas_extremos',`${code} excede 100 g/100 g.`);
  if(code.endsWith('_mg')&&value>100000)add('mg_extremos',`${code} excede 100.000 mg/100 g.`);
  if(code.endsWith('_ug')&&value>100000000)add('ug_extremos',`${code} excede 100.000.000 µg/100 g.`);
 }
 const nome=String(dados.nome||'').trim();
 if(/\b(cru|cozido|assado|frito)\s*,\s*\1\b/i.test(nome))add('nome_duplicado','O nome parece repetir o preparo. Ajuste antes de cadastrar.');
 if(alegaFonte&&!(dados.fontes||[]).length)add('fonte_nao_verificada','A IA menciona uma tabela/fonte nas observações, mas não forneceu URL verificável. Não trate os valores como confirmados.');
 if(!(dados.fontes||[]).length)add('sem_fontes','Sem fontes verificáveis: valores são estimativas da IA.', 'informativo');
 return alertas.slice(0,25);
}
module.exports={auditar};
