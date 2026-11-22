'use strict';

// O catálogo descreve o contrato, mas também o validamos no servidor:
// códigos com zeros à esquerda (número do pedido) não são ids internos.
function validar(schema, valor) {
  const tipos = Array.isArray(schema.type) ? schema.type : [schema.type];
  const corresponde = tipo => tipo === undefined
    || tipo === 'null' && valor === null
    || tipo === 'object' && valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    || tipo === 'array' && Array.isArray(valor)
    || tipo === 'integer' && typeof valor === 'number' && Number.isSafeInteger(valor)
    || tipo === 'number' && typeof valor === 'number' && Number.isFinite(valor)
    || ['string', 'boolean'].includes(tipo) && typeof valor === tipo;
  if (!tipos.some(corresponde)) return false;
  if (schema.enum && !schema.enum.includes(valor)) return false;
  if (typeof valor === 'number') {
    if (schema.minimum !== undefined && valor < schema.minimum) return false;
    if (schema.maximum !== undefined && valor > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && valor <= schema.exclusiveMinimum) return false;
  }
  if (typeof valor === 'string') {
    if (schema.minLength !== undefined && valor.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && valor.length > schema.maxLength) return false;
  }
  if (Array.isArray(valor)) {
    if (schema.minItems !== undefined && valor.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && valor.length > schema.maxItems) return false;
    if (schema.items && !valor.every(item => validar(schema.items, item))) return false;
  } else if (valor && typeof valor === 'object') {
    const propriedades = schema.properties || {};
    if ((schema.required || []).some(k => !Object.prototype.hasOwnProperty.call(valor, k))) return false;
    if (schema.additionalProperties === false && Object.keys(valor).some(k => !Object.prototype.hasOwnProperty.call(propriedades, k))) return false;
    if (!Object.entries(valor).every(([k, v]) => !propriedades[k] || validar(propriedades[k], v))) return false;
  }
  return true;
}
module.exports = { validar };
