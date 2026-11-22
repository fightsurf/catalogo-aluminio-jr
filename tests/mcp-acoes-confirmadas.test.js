'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function carregarServico() {
  const registros = new Map();
  const estado = { consultas: 0, falharFinal: 0, falharProgresso: 0 };
  const pool = { query: async (sql, p = []) => {
    estado.consultas++;
    if (/CREATE TABLE/.test(sql)) return { rows: [] };
    if (/status='expirado'/.test(sql)) {
      for (const r of registros.values()) if (r.status === 'aguardando_confirmacao' && r.expira_em <= new Date()) {
        r.status = 'expirado'; r.payload = {};
      }
      return { rows: [] };
    }
    if (/INSERT INTO/.test(sql)) {
      registros.set(p[0], {
        id: p[0], usuario: p[1], tipo: p[2], codigo_hash: p[3],
        payload: JSON.parse(p[4]), resumo: JSON.parse(p[5]),
        status: 'aguardando_confirmacao', progresso: [],
        expira_em: new Date(p[6]), resultado: null
      });
      return { rows: [] };
    }
    if (/SET status='em_processamento'/.test(sql)) {
      const r = registros.get(p[0]);
      if (!r || r.usuario !== p[1] || r.tipo !== p[2] || r.codigo_hash !== p[3]
        || r.status !== 'aguardando_confirmacao' || r.expira_em <= new Date()) return { rows: [] };
      r.status = 'em_processamento';
      return { rows: [{ payload: structuredClone(r.payload) }] };
    }
    if (/SELECT id, tipo/.test(sql)) {
      const r = registros.get(p[0]);
      return { rows: r && r.usuario === p[1] ? [structuredClone(r)] : [] };
    }
    if (/SET progresso=progresso/.test(sql)) {
      if (estado.falharProgresso-- > 0) throw new Error('Falha de persistência do progresso');
      const r = registros.get(p[0]);
      assert.equal(r.usuario, p[2]);
      r.progresso.push(...JSON.parse(p[1]));
      return { rows: [] };
    }
    if (/SET status=\$2, resultado=\$3/.test(sql)) {
      if (estado.falharFinal-- > 0) throw new Error('Falha de persistência final');
      const r = registros.get(p[0]);
      assert.equal(r.usuario, p[3]);
      Object.assign(r, { status: p[1], resultado: JSON.parse(p[2]), payload: {}, concluido_em: new Date() });
      return { rows: [] };
    }
    throw new Error('SQL não previsto pelo teste');
  } };
  const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpAcoesConfirmadas.service.js'), 'utf8');
  const m = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    if (name === 'crypto') return crypto;
    assert.equal(name, '../../../db/connection');
    return pool;
  }, m, m.exports);
  return { service: m.exports, registros, estado };
}
const contexto = { usuario: 'operador-teste' };
async function previa(service, tipo = 'alterar_pedido') {
  return service.prepararAcao({ tipo, payload: { id_mestre: 102 }, resumo: { numero: '0020021' } }, contexto);
}
function confirmacao(p) {
  return { acao_id: p.acao_id, codigo_confirmacao: p.codigo_confirmacao, confirmacao: 'CONFIRMO' };
}

test('prévia persiste somente rascunho com dono, código hash e prazo de 15 minutos', async () => {
  const { service, registros } = carregarServico();
  const p = await previa(service);
  const r = registros.get(p.acao_id);
  assert.equal(p.status, 'aguardando_confirmacao');
  assert.equal(p.expira_em_minutos, 15);
  assert.equal(r.usuario, contexto.usuario);
  assert.equal(r.codigo_hash, crypto.createHash('sha256').update(p.codigo_confirmacao).digest('hex'));
  assert.notEqual(r.codigo_hash, p.codigo_confirmacao);
  assert.deepEqual(r.progresso, []);
  assert.deepEqual(r.payload, { id_mestre: 102 });
  assert.ok(r.expira_em.getTime() - Date.now() <= 15 * 60 * 1000);
  await assert.rejects(previa(service, 'envio_em_lote'), /Prévia/);
});

test('autenticação, confirmação literal e formato inválido falham antes de efeitos', async () => {
  const { service, estado } = carregarServico();
  await assert.rejects(service.prepararAcao({ tipo: 'alterar_pedido', payload: {}, resumo: {} }, {}), /autenticada/);
  const p = await previa(service);
  let execucoes = 0;
  const executar = async () => { execucoes++; };
  await assert.rejects(service.confirmarAcao({ ...confirmacao(p), confirmacao: 'sim' }, contexto, 'alterar_pedido', executar), /CONFIRMO/);
  await assert.rejects(service.confirmarAcao({ ...confirmacao(p), codigo_confirmacao: 'A' }, contexto, 'alterar_pedido', executar), /Código/);
  await assert.rejects(service.confirmarAcao({ ...confirmacao(p), acao_id: '102' }, contexto, 'alterar_pedido', executar), /Identificador/);
  assert.equal(execucoes, 0);
  assert.ok(estado.consultas > 0);
});

test('outro usuário não consulta nem confirma o rascunho', async () => {
  const { service, registros } = carregarServico();
  const p = await previa(service);
  let execucoes = 0;
  const outro = { usuario: 'outra-conta' };
  await assert.rejects(service.consultarAcao({ acao_id: p.acao_id }, outro), /não encontrada/);
  await assert.rejects(service.confirmarAcao(confirmacao(p), outro, 'alterar_pedido', async () => { execucoes++; }), /não encontrada/);
  assert.equal(execucoes, 0);
  assert.equal(registros.get(p.acao_id).status, 'aguardando_confirmacao');
});

test('código incorreto ou tipo divergente não consome a ação', async () => {
  const { service, registros } = carregarServico();
  const p = await previa(service);
  let execucoes = 0;
  const executar = async () => { execucoes++; };
  const errado = await service.confirmarAcao({ ...confirmacao(p), codigo_confirmacao: '0000000000000000' }, contexto, 'alterar_pedido', executar);
  assert.equal(errado.status, 'aguardando_confirmacao');
  await assert.rejects(service.confirmarAcao(confirmacao(p), contexto, 'cancelar_pedido', executar), /tipo da prévia/);
  assert.equal(execucoes, 0);
  assert.equal(registros.get(p.acao_id).status, 'aguardando_confirmacao');
});

test('prévia expirada nunca executa e informa expiração', async () => {
  const { service, registros } = carregarServico();
  const p = await previa(service);
  registros.get(p.acao_id).expira_em = new Date(Date.now() - 1000);
  let executou = false;
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', async () => { executou = true; });
  assert.equal(executou, false);
  assert.equal(r.expirado, true);
});

test('validade curta do adapter é preservada e nunca estende o limite de 15 minutos', async () => {
  const { service, registros } = carregarServico();
  const curta = new Date(Date.now() + 2 * 60000).toISOString();
  const p = await service.prepararAcao({
    tipo: 'whatsapp_pedido', payload: { expira_em: curta }, resumo: { tipo: 'audio' }
  }, contexto);
  assert.equal(p.expira_em, curta);
  assert.equal(registros.get(p.acao_id).expira_em.toISOString(), curta);
  assert.ok(p.expira_em_minutos <= 2);
  const longa = await service.prepararAcao({
    tipo: 'whatsapp_pedido', payload: { expira_em: new Date(Date.now() + 60 * 60000).toISOString() }, resumo: {}
  }, contexto);
  assert.ok(new Date(longa.expira_em).getTime() - Date.now() <= 15 * 60000);
  await assert.rejects(service.prepararAcao({
    tipo: 'whatsapp_pedido', payload: { expira_em: '2020-01-01T00:00:00Z' }, resumo: {}
  }, contexto), /expirada/);
});

test('chamadas concorrentes e repetições executam o efeito no máximo uma vez', async () => {
  const { service, registros } = carregarServico();
  const p = await previa(service);
  let efeitos = 0;
  let liberar;
  const bloqueio = new Promise(resolve => { liberar = resolve; });
  const executar = async (_, { registrarProgresso }) => {
    await registrarProgresso({ etapa: 'alteracao', estado: 'iniciando' });
    efeitos++;
    await bloqueio;
    return { status: 'alterado' };
  };
  const primeira = service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  // Permite à primeira execução tomar a reserva atômica e registrar a etapa.
  await new Promise(resolve => setImmediate(resolve));
  const repetida = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(repetida.status, 'em_processamento');
  assert.equal(repetida.revisao_manual_necessaria, true);
  liberar();
  assert.equal((await primeira).status, 'concluido');
  const depois = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(depois.status, 'concluido');
  assert.equal(efeitos, 1);
  assert.deepEqual(registros.get(p.acao_id).payload, {});
});

test('validação antes de qualquer tentativa resulta em não executado, sem reutilização', async () => {
  const { service } = carregarServico();
  const p = await previa(service);
  let tentativas = 0;
  const executar = async () => { tentativas++; const e = new Error('Pedido mudou.'); e.isValidation = true; throw e; };
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(r.status, 'nao_executado');
  assert.equal(r.resultado.mensagem, 'Pedido mudou.');
  await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(tentativas, 1);
});

test('erro depois da etapa iniciada marca resultado incerto e bloqueia repetição', async () => {
  const { service } = carregarServico();
  const p = await previa(service);
  let efeitos = 0;
  const executar = async (_, { registrarProgresso }) => {
    await registrarProgresso({ etapa: 'alteracao', estado: 'iniciando' });
    efeitos++;
    throw new Error('Resposta de rede perdida');
  };
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(r.status, 'revisao_necessaria');
  assert.equal(r.resultado.status, 'resultado_incerto');
  assert.equal(r.revisao_manual_necessaria, true);
  await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(efeitos, 1);
});

test('falha ao persistir progresso interrompe antes do efeito externo', async () => {
  const { service, estado } = carregarServico();
  const p = await previa(service);
  estado.falharProgresso = 1;
  let efeitos = 0;
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', async (_, { registrarProgresso }) => {
    await registrarProgresso({ etapa: 'alteracao', estado: 'iniciando' });
    efeitos++;
    return { status: 'alterado' };
  });
  assert.equal(efeitos, 0);
  assert.equal(r.status, 'nao_executado');
});

test('falha no banco após efeito já concluído mantém resultado incerto e não reexecuta', async () => {
  const { service, estado } = carregarServico();
  const p = await previa(service);
  estado.falharFinal = 1;
  let efeitos = 0;
  const executar = async (_, { registrarProgresso }) => {
    await registrarProgresso({ etapa: 'alteracao', estado: 'iniciando' });
    efeitos++;
    return { status: 'alterado' };
  };
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(r.status, 'revisao_necessaria');
  await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(efeitos, 1);
});

test('queda persistente do banco deixa reserva consumida mesmo sem salvar desfecho', async () => {
  const { service, estado, registros } = carregarServico();
  const p = await previa(service);
  estado.falharFinal = 2;
  let efeitos = 0;
  const executar = async (_, { registrarProgresso }) => {
    await registrarProgresso({ etapa: 'alteracao', estado: 'iniciando' });
    efeitos++;
    return { status: 'alterado' };
  };
  await assert.rejects(service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar), /persistência final/);
  assert.equal(registros.get(p.acao_id).status, 'em_processamento');
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'alterar_pedido', executar);
  assert.equal(r.status, 'em_processamento');
  assert.equal(efeitos, 1);
});

test('envio parcial preserva progresso e exige revisão sem tentar novamente', async () => {
  const { service } = carregarServico();
  const p = await previa(service, 'whatsapp_pedido');
  const r = await service.confirmarAcao(confirmacao(p), contexto, 'whatsapp_pedido', async (_, { registrarProgresso }) => {
    await registrarProgresso({ etapa: 'foto_1', estado: 'aceito_pelo_provedor' });
    return { status: 'parcial', enviados: 1, total: 3 };
  });
  assert.equal(r.status, 'parcial');
  assert.equal(r.revisao_manual_necessaria, true);
  assert.equal(r.pode_reexecutar, false);
  assert.equal(r.progresso.length, 1);
});
