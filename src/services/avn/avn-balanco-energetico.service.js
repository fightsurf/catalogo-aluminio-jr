'use strict';

// Valor negativo = déficit; positivo = superávit.
// Os passos e as sessões não são somados outra vez: podem já estar nas calorias ativas.
function valor(x) {
  if (x === null || x === undefined || x === '') return null;
  const n=Number(x);
  return Number.isFinite(n) && n>=0 ? n : null;
}
function avaliarBalanco({ingestao,tmb,ativas,diarioCompleto=true}) {
  const comer=valor(ingestao),basal=valor(tmb);
  // Sem registro de calorias ativas, adota zero apenas para essa parcela do cálculo.
  const ativo=valor(ativas===null || ativas===undefined || ativas==='' ? 0 : ativas);
  const faltam=[];
  if(comer===null || !diarioCompleto)faltam.push('Diário alimentar completo');
  if(basal===null || basal===0)faltam.push('TMB da bioimpedância');
  if(ativo===null)faltam.push('Calorias ativas inválidas do Health Connect');
  if(faltam.length)return {classificacao:'indisponivel',saldo_kcal:null,gasto_estimado_kcal:null,faltam};
  const gasto=basal+ativo, saldo=comer-gasto;
  return {
    classificacao:saldo < -1 ? 'deficit' : saldo > 1 ? 'superavit' : 'equilibrio',
    saldo_kcal:Math.round(saldo*10)/10,
    gasto_estimado_kcal:Math.round(gasto*10)/10,
    faltam:[]
  };
}
module.exports={avaliarBalanco,valor};
