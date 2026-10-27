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
// Soma dos micronutrientes conhecidos para consulta. Dados ausentes não são zero.
 // O cálculo original, usado ao salvar receitas, permanece inalterado.
function micronutrientesDisponiveis(itens,rendimento,codigos){
 const renda=Number(rendimento);
 if(!Array.isArray(itens)||!itens.length||!Number.isFinite(renda)||renda<=0)throw Error('Receita inválida.');
 const totais={},por100g={},parciais={};
 for(const codigo of codigos){
  let soma=0,conhecidos=0,faltantes=0;
  for(const item of itens){
   const original=item.composicao_100g?.micros?.[codigo];
   const quantidade=Number(item.quantidade_g);
   if(!Number.isFinite(quantidade)||quantidade<=0)throw Error('Ingrediente inválido.');
   if(original===null||original===undefined||original===''){faltantes++;continue;}
   const valor=Number(original);
   if(!Number.isFinite(valor)||valor<0){faltantes++;continue;}
   conhecidos++;soma+=valor*quantidade/100;
   // A composicao de uma receita usada como ingrediente pode ser parcial.
   if(item.composicao_100g?.micros_parciais?.[codigo])faltantes++;
  }
  if(!conhecidos||!Number.isFinite(soma)||soma<=0)continue;
  totais[codigo]=soma;por100g[codigo]=soma*100/renda;
  if(faltantes)parciais[codigo]=true;
 }
 return {totais,por100g,parciais};
}
module.exports={calcular,composicao,MACROS,micronutrientesDisponiveis};
