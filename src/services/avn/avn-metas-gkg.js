'use strict';
// Cálculos compartilhados pelo histórico e pela calculadora de g/kg.
const round=(x,dec=2)=>Number(Number(x).toFixed(dec));
function metaPorKg(peso,razoes){
 const w=Number(peso);
 if(!Number.isFinite(w)||w<1||w>500)throw new RangeError('Peso deve estar entre 1 e 500 kg.');
 const result={};
 for(const key of ['proteinas_g','carboidratos_g','gorduras_g']){
  const r=Number(razoes[key]);
  if(razoes[key]===null||razoes[key]===''||!Number.isFinite(r)||r<0||r>10)
   throw new RangeError('Valor de g/kg inválido para '+key+'.');
  result[key]=round(w*r);
 }
 result.energia_macros_kcal=energiaMacros(result);
 return result;
}
function energiaMacros(m){
 const keys=['proteinas_g','carboidratos_g','gorduras_g'];
 if(keys.some(k=>m[k]===null||m[k]===undefined||m[k]===''||!Number.isFinite(Number(m[k]))||Number(m[k])<0))
  return null;
 return round(Number(m.proteinas_g)*4+Number(m.carboidratos_g)*4+Number(m.gorduras_g)*9);
}
function razoesDaMeta(peso,macros){
 if(peso===null||peso===undefined||peso==='')return {proteinas_g_kg:null,carboidratos_g_kg:null,gorduras_g_kg:null};
 const w=Number(peso);
 if(!Number.isFinite(w)||w<1||w>500)throw new RangeError('Peso inválido.');
 return Object.fromEntries(['proteinas_g','carboidratos_g','gorduras_g'].map(k=>[
  k+'_kg',macros[k]===null||macros[k]===undefined||macros[k]===''?null:round(Number(macros[k])/w,4)
 ]));
}
module.exports={metaPorKg,energiaMacros,razoesDaMeta};
