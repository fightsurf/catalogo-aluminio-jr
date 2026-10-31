'use strict';

// Um @lid pode identificar um cliente existente. Sem um número confiável,
// não podemos considerar a mensagem como primeiro contato para automações.
function elegivelBoasVindas(identificador) {
  const valor = String(identificador || '').trim();
  return /^\d{10,15}$/.test(valor);
}

module.exports = { elegivelBoasVindas };
