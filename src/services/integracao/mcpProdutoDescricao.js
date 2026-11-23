'use strict';

// Busca conservadora por descrições ditadas: não transforma similaridade em identificação confirmada.
function tokens(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(pressao|press|p\/p)\b/g, ' pressao ')
    .replace(/\b(craqueadas?|craqueladas?|craq)\b/g, ' craqueado ')
    .replace(/\b(panelas?)\b/g, ' panela ')
    .replace(/\b(litros?|lts?|lt)\b/g, ' litro ')
    .replace(/\b(s\/cx|s\/caixa)\b/g, ' sem caixa ')
    .replace(/\b(c\/cx|c\/caixa)\b/g, ' com caixa ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}
const STOP = new Set(['de','da','do','das','dos','a','o','as','os','e','unidades','unidade','pecas','peca']);
function caracteristicas(value) {
  const t = tokens(value), s = new Set(t);
  const volume = t.findIndex(x => /^\d+$/.test(x) && t[t.indexOf(x)+1] === 'litro');
  return {
    t: t.filter(x => !STOP.has(x)),
    pressao: s.has('pressao'),
    panela: s.has('panela'),
    craqueado: s.has('craqueado'),
    caixa: s.has('caixa') ? (s.has('sem') ? 'sem' : s.has('com') ? 'com' : 'indefinido') : null,
    litros: volume >= 0 ? Number(t[volume]) : null
  };
}
function pontuar(consulta, produto) {
  const q = caracteristicas(consulta), p = caracteristicas(produto.nome + ' ' + (produto.observacao || ''));
  if (q.pressao && !p.pressao) return null;
  if (q.panela && !p.panela) return null;
  if (q.craqueado && !p.craqueado) return null;
  if (q.litros != null && p.litros !== q.litros) return null;
  if (q.caixa && p.caixa && q.caixa !== p.caixa) return null;
  const pt = new Set(p.t);
  const termos = q.t.filter(x => !['sem','com','caixa','litro'].includes(x) && !/^\d+$/.test(x));
  const acertos = termos.filter(x => pt.has(x)).length;
  if (!acertos || acertos < Math.ceil(termos.length * 0.7)) return null;
  return acertos * 10 + (q.litros != null ? 15 : 0) + (q.caixa && p.caixa === q.caixa ? 8 : 0);
}
module.exports = { pontuar };
