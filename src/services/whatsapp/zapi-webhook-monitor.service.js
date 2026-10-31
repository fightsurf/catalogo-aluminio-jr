'use strict';

// Só metadados operacionais voláteis: nenhum texto ou payload fica no banco.
const eventos = [];
async function criarEstrutura() { return true; }
function registrarEvento({ payload = {}, dados = {}, estado, motivo = '' }) {
  const agora = Date.now();
  eventos.unshift({
    chave: 'temporario-' + agora + '-' + Math.random().toString(16).slice(2, 8),
    recebido_em: new Date(agora).toISOString(),
    telefone: String(dados.telefone || payload.phone || '').slice(0, 120),
    mensagem: '',
    tipo: String(dados.tipo || '').slice(0, 30),
    message_id: '',
    estado: String(estado || '').slice(0, 20),
    motivo: String(motivo || '').slice(0, 160),
    direcao: dados.direcao || (payload.fromMe === true ? 'SAIDA' : 'ENTRADA'),
    origem: 'Z-API direta'
  });
  while (eventos.length && (eventos.length > 100 || agora - new Date(eventos[eventos.length - 1].recebido_em).getTime() > 300000)) eventos.pop();
}
async function listarRecebimentos({ limite = 100 } = {}) {
  const agora = Date.now();
  const quantidade = Math.max(1, Math.min(200, Number.parseInt(limite, 10) || 100));
  return eventos.filter(x => agora - new Date(x.recebido_em).getTime() <= 300000).slice(0, quantidade);
}
module.exports = { criarEstrutura, registrarEvento, listarRecebimentos };
