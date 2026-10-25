'use strict';
const MACROS=['kcal','proteinas_g','carboidratos_g','gorduras_g','fibras_g'];
function composicao(alimento){return {
 kcal:alimento.kcal_100g==null?null:Number(alimento.kcal_100g),
 proteinas_g:alimento.proteinas_g_100g==null?null:Number(alimento.proteinas_g_100g),
 carboidratos_g:alimento.carboidratos_g_100g==null?null:Number(alimento.carboidratos_g_100g),
 gorduras_g:alimento.gorduras_g_100g==null?null:Number(alimento.gorduras_g_100g),
 fibras_g:alimento.fibras_g_100g==null?null:Number(alimento.fibras_g_100g),
 micros:alimento.micronutrientes_100g||{}
};}
function calcular(itens,rendimento,nutrientes){
 if(!Array.isArray(itens)||!itens.length||!Number.isFinite(+rendimento)||+rendimento<=0)throw Error('Receita inválida.');
 const keys=[...MACROS,...nutrientes];const resultado={};const total={};
 for(const k of keys){let soma=0,completo=true;for(const item of itens){const comp=item.composicao_100g;const v=MACROS.includes(k)?comp[k]:comp.micros?.[k];
  if(v===null||v===undefined||v===''){completo=false;continue;}
  const n=Number(v),g=Number(item.quantidade_g);if(!Number.isFinite(n)||!Number.isFinite(g)||n<0||g<=0)throw Error('Composição inválida.');soma+=n*g/100;
 }total[k]=completo?+soma.toFixed(6):null;resultado[k]=completo?+(soma*100/+rendimento).toFixed(6):null;}
 const micros={};for(const k of nutrientes)if(resultado[k]!==null)micros[k]=resultado[k];
 return {kcal_100g:resultado.kcal,proteinas_g_100g:resultado.proteinas_g,carboidratos_g_100g:resultado.carboidratos_g,gorduras_g_100g:resultado.gorduras_g,fibras_g_100g:resultado.fibras_g,micronutrientes_100g:micros,totais_ingredientes:total};
}
module.exports={calcular,composicao,MACROS};
