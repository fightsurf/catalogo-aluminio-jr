'use strict';

// Valor negativo = déficit; positivo = superávit.
// O gasto dos passos é estimado somente para intervalos que não se sobreponham
// a registros de calorias ativas; evita contá-los duas vezes.
function valor(x) {
  if (x === null || x === undefined || x === '') return null;
  const n=Number(x);
  return Number.isFinite(n) && n>=0 ? n : null;
}
// Estimativa líquida de caminhada (~0,5 kcal/kg/km), acima do metabolismo basal.
// Comprimento médio de passo: 41,5% da altura. Não equivale a medição do relógio.
function estimarCaloriasPassos({passos,pesoKg,alturaCm}) {
  const quantidade=valor(passos),peso=valor(pesoKg),altura=valor(alturaCm);
  if(quantidade===null||peso===null||altura===null||peso<20||peso>350||altura<80||altura>250)return null;
  const distanciaKm=quantidade*(altura*0.415/100)/1000;
  return Math.round(distanciaKm*peso*0.5*10)/10;
}
function avaliarBalanco({ingestao,tmb,ativas,caloriasPassos=0,diarioCompleto=true}) {
  const comer=valor(ingestao),basal=valor(tmb);
  // Sem registro de calorias ativas, adota zero apenas para essa parcela.
  const ativo=valor(ativas===null || ativas===undefined || ativas==='' ? 0 : ativas);
  const caminhada=valor(caloriasPassos);
  const faltam=[];
  if(comer===null || !diarioCompleto)faltam.push('Diário alimentar completo');
  if(basal===null || basal===0)faltam.push('TMB da bioimpedância');
  if(ativo===null)faltam.push('Calorias ativas inválidas do Health Connect');
  if(caminhada===null)faltam.push('Peso e altura válidos para estimar as calorias dos passos');
  if(faltam.length)return {classificacao:'indisponivel',saldo_kcal:null,gasto_estimado_kcal:null,faltam};
  const gasto=basal+ativo+caminhada, saldo=comer-gasto;
  return {
    classificacao:saldo < -1 ? 'deficit' : saldo > 1 ? 'superavit' : 'equilibrio',
    saldo_kcal:Math.round(saldo*10)/10,
    gasto_estimado_kcal:Math.round(gasto*10)/10,
    faltam:[]
  };
}
module.exports={avaliarBalanco,valor,estimarCaloriasPassos};
