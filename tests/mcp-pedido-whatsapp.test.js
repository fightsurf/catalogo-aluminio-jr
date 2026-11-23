'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/services/integracao/mcpPedidoWhatsapp.service.js'), 'utf8');
const copiar = valor => JSON.parse(JSON.stringify(valor));
function ambiente() {
  const estado = {
    pedido: { idMestre: 123, numero: '0020021', situacao: 'A', data: '2026-11-22', total: 1795, volumes: 2,
      obs: 'Sem caixa', carradaAtual: { codigo: 1697, data: '2026-12-02', descricao: 'Quarta-feira' },
      cliente: { favorecido: 321, nome: 'Cliente de Teste', telefonePrincipal: '(84) 99999-9999' },
      vendedor: { favorecido: 9, nome: 'Vendedor' },
      itens: [{ item: 10, saidaItem: 11, descricao: 'Panela 4,5 L', quantidade: 50, preco: 35.90, subtotal: 1795 }] },
    analise: { prontoParaEnvio: true, totalFinal: 1795, quantidadeProdutos: 2,
      itens: [
        { produtoId: 5, descricao: 'Panela 4,5 L', foto: 'https://exemplo.invalid/1.jpg', quantidadeFinal: 25, unitario: 35.90, subtotalFinal: 897.50 },
        { produtoId: 6, descricao: 'Panela 4,5 L vermelha', foto: 'https://exemplo.invalid/2.jpg', quantidadeFinal: 25, unitario: 35.90, subtotalFinal: 897.50 }
      ] },
    bloqueado: false, falharEnvio: 0, funcao: null, audioGerado: 0, resumoGerado: 0, chamadas: [], controles: [], progresso: []
  };
  async function enviar(tipo, data, extra) {
    const n = estado.chamadas.length + 1;
    estado.chamadas.push({ tipo, data, extra, funcao: estado.funcao });
    if (n === estado.falharEnvio) throw new Error('Falha simulada no provedor');
    return { success: true, zapi: { messageId: 'id-' + n } };
  }
  const dependencias = {
    'node:crypto': require('node:crypto'),
    'node:timers/promises': { setTimeout: async ms => { assert.equal(ms, 900); } },
    '../legado/pedido/pedidosLegado.service': { buscarDetalhePedido: async () => copiar(estado.pedido) },
    '../../../public/js/pedido-mensagem-whatsapp': require('../public/js/pedido-mensagem-whatsapp'),
    '../legado/pedidos-insercao-v2/mensagem-entrada-carrada': require('../src/services/legado/pedidos-insercao-v2/mensagem-entrada-carrada'),
    '../whatsapp/envio-whatsapp.service': {
      enviarMensagem: data => enviar('texto', data), enviarDocumentoPdf: data => enviar('pdf', data)
    },
    '../whatsapp/relatorio-fotos-whatsapp.service': {
      analisarRelatorio: async () => copiar(estado.analise),
      enviarItem: (data, extra) => enviar('foto', data, extra), finalizarEnvio: data => enviar('resumo_fotos', data)
    },
    '../whatsapp/central-controle.service': {
      verificar: async funcao => {
        estado.controles.push(funcao);
        if (estado.bloqueado) { const e = new Error('Bloqueado'); e.codigo = 'WHATSAPP_ENVIO_DESATIVADO'; throw e; }
      },
      comFuncionalidade: async (funcao, fn) => { estado.funcao = funcao; return fn(); }
    },
    '../legado/pedido/pedidoPdf.service': { gerarPdfPedido: pedido => Buffer.from('PDF real do pedido ' + pedido.numero) },
    '../legado/pedido/resumo-pedido-ia.service': { gerarResumo: async () => { estado.resumoGerado++; return { texto: 'Apresentação do pedido.' }; } },
    '../legado/pedido/resumo-pedido-voz-config.service': { obter: async () => ({ voz: 'voz_existente', modelo: 'eleven_multilingual_v2' }) },
    '../integracoes/elevenlabs-jr.service': {
      gerarAudio: async dados => { estado.audioGerado++; return { ...dados, bytes: Buffer.from('MP3 aprovado'), caracteres: dados.texto.length }; },
      salvarPreview: (_audio, usuario) => 'previa-' + usuario,
      enviarAudio: (audio, telefone) => enviar('audio_ia', { audio, telefone })
    }
  };
  const modulo = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => {
    assert.ok(Object.hasOwn(dependencias, name), 'Dependência sem mock: ' + name);
    return dependencias[name];
  }, modulo, modulo.exports);
  const contexto = { registrarProgresso: async item => { estado.progresso.push(copiar(item)); } };
  return { estado, contexto, ...modulo.exports };
}

test('preparar os cinco formatos nunca envia WhatsApp nem expõe binários no resumo', async () => {
  for (const tipo of ['texto', 'fotos', 'pdf', 'audio_ia', 'aviso_carrada']) {
    const a = ambiente();
    const r = await a.prepararEnvio({ id_mestre: 123, tipo }, { usuario: 'operador' });
    assert.equal(a.estado.chamadas.length, 0);
    assert.equal(r.resumo.destinatario.telefone, '5584999999999');
    assert.equal(r.resumo.pedido.numero, '0020021');
    assert.equal(r.resumo.confirmacao_obrigatoria, true);
    assert.ok(!JSON.stringify(r.resumo).includes('base64'));
    if (tipo === 'audio_ia') {
      assert.equal(r.resumo.audio.referencia_previa, 'previa-operador');
      assert.equal(r.resumo.audio.texto, 'Apresentação do pedido.');
    }
  }
});

test('aviso da carrada mostra o texto exato, cliente, destinatário e carrada sem enviar', async () => {
  const a = ambiente();
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' });
  assert.deepEqual(r.resumo.cliente, { favorecido: 321, nome: 'Cliente de Teste' });
  assert.equal(r.resumo.destinatario.telefone, '5584999999999');
  assert.deepEqual(r.resumo.carrada, { codigo: 1697, data: '2026-12-02', descricao: 'Quarta-feira' });
  assert.equal(r.resumo.mensagem,
    '📦 Pedido: 0020021\nCliente: Cliente de Teste\nSeu pedido entrou na produção da carrada do dia 02/12/2026\nDescrição da carrada: Quarta-feira');
  assert.equal(r.payload.mensagem, r.resumo.mensagem);
  assert.deepEqual(a.estado.controles, ['pedidos_texto']);
  assert.equal(a.estado.chamadas.length, 0);
  assert.equal(a.estado.resumoGerado, 0);
  assert.equal(a.estado.audioGerado, 0);
});

test('confirmação do aviso envia uma mensagem aprovada após persistir o progresso', async () => {
  const a = ambiente();
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' });
  const resultado = await a.executarEnvio(r.payload, {
    registrarProgresso: async item => {
      if (item.status === 'em_processamento') assert.equal(a.estado.chamadas.length, 0);
      a.estado.progresso.push(copiar(item));
    }
  });
  assert.equal(resultado.status, 'aceito_pelo_provedor');
  assert.equal(resultado.entrega_confirmada, false);
  assert.equal(resultado.total, 1);
  assert.equal(a.estado.chamadas.length, 1);
  assert.deepEqual(a.estado.chamadas[0].data, { telefone: '5584999999999', mensagem: r.resumo.mensagem });
  assert.equal(a.estado.chamadas[0].funcao, 'pedidos_texto');
  assert.deepEqual(a.estado.controles, ['pedidos_texto', 'pedidos_texto']);
  assert.deepEqual(a.estado.progresso.map(p => [p.tipo, p.status]),
    [['aviso_carrada', 'em_processamento'], ['aviso_carrada', 'aceito_pelo_provedor']]);
});

test('aviso da carrada recusa carrada ausente, código inválido e data impossível', async () => {
  for (const carrada of [
    null, {}, { codigo: 0, data: '2026-12-02' }, { codigo: true, data: '2026-12-02' },
    { codigo: 'x', data: '2026-12-02' }, { codigo: 1697 }, { codigo: 1697, data: '' },
    { codigo: 1697, data: '2026-02-30' }, { codigo: 1697, data: '2026-12-02Tinválida' },
    { codigo: 1697, data: '2026-12-02', descricao: {} }
  ]) {
    const a = ambiente(); a.estado.pedido.carradaAtual = carrada;
    await assert.rejects(a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' }), /carrada/i);
    assert.equal(a.estado.chamadas.length, 0);
  }
});

test('aviso da carrada aceita data ISO do legado preservando a data civil', async () => {
  const a = ambiente(); a.estado.pedido.carradaAtual.data = '2026-12-02T00:00:00.000Z';
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' });
  assert.equal(r.resumo.carrada.data, '2026-12-02');
  assert.match(r.resumo.mensagem, /dia 02\/12\/2026/);
  await a.executarEnvio(r.payload, a.contexto);
  assert.equal(a.estado.chamadas.length, 1);
});

test('aviso da carrada não permite texto personalizado nem conteúdo alterado após a prévia', async () => {
  const a = ambiente();
  await assert.rejects(a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada', mensagem: 'Outro texto' }), /personalizada/);
  for (const alterar of [
    p => { p.mensagem = 'Outro aviso'; }, p => { p.carrada.codigo = 1698; },
    p => { p.carrada.data = '2026-12-03'; }, p => { p.carrada.descricao = 'Outra carrada'; },
    p => { delete p.carrada; }
  ]) {
    const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' }); alterar(r.payload);
    await assert.rejects(a.executarEnvio(r.payload, a.contexto), /diverge da prévia/);
  }
  assert.equal(a.estado.chamadas.length, 0);
  assert.equal(a.estado.progresso.length, 0);
});

test('alterações do pedido, cliente, telefone ou carrada bloqueiam o aviso confirmado', async () => {
  for (const alterar of [
    p => { p.numero = '0020022'; }, p => { p.cliente.nome = 'Outro cliente'; },
    p => { p.cliente.telefonePrincipal = '84988888888'; }, p => { p.total = 1800; },
    p => { p.carradaAtual.codigo = 1698; }, p => { p.carradaAtual.data = '2026-12-03'; },
    p => { p.carradaAtual.descricao = 'Outra entrega'; }, p => { p.carradaAtual = null; }
  ]) {
    const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' });
    alterar(a.estado.pedido);
    await assert.rejects(a.executarEnvio(r.payload, a.contexto), /mudou desde a prévia/);
    assert.equal(a.estado.chamadas.length, 0);
    assert.equal(a.estado.progresso.length, 0);
  }
});

test('Central de pedidos_texto desligada impede preparar ou confirmar aviso da carrada', async () => {
  const a = ambiente(); a.estado.bloqueado = true;
  await assert.rejects(a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' }), /Bloqueado/);
  a.estado.bloqueado = false;
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' });
  a.estado.bloqueado = true;
  await assert.rejects(a.executarEnvio(r.payload, a.contexto), /Bloqueado/);
  assert.equal(a.estado.chamadas.length, 0);
  assert.equal(a.estado.progresso.length, 0);
});

test('falha do provedor no aviso fica incerta sem repetir a mensagem', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'aviso_carrada' });
  a.estado.falharEnvio = 1;
  const resultado = await a.executarEnvio(r.payload, a.contexto);
  assert.equal(resultado.status, 'resultado_incerto');
  assert.equal(resultado.revisao_manual_necessaria, true);
  assert.equal(resultado.aceitos, 0);
  assert.equal(a.estado.chamadas.length, 1);
  assert.deepEqual(a.estado.progresso.map(p => p.status), ['em_processamento', 'resultado_incerto']);
});

test('texto padrão reutiliza o formatador da tela e registra a tentativa antes do envio', async () => {
  const a = ambiente();
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'texto' });
  const resultado = await a.executarEnvio(r.payload, {
    registrarProgresso: async item => {
      if (item.status === 'em_processamento') assert.equal(a.estado.chamadas.length, 0);
      a.estado.progresso.push(copiar(item));
    }
  });
  assert.equal(resultado.status, 'aceito_pelo_provedor');
  assert.equal(resultado.entrega_confirmada, false);
  assert.match(a.estado.chamadas[0].data.mensagem, /Número do pedido: \*0020021\*/);
  assert.equal(a.estado.chamadas[0].data.mensagem, r.resumo.mensagem);
  assert.equal(a.estado.chamadas[0].funcao, 'pedidos_texto');
  assert.deepEqual(a.estado.progresso.map(x => x.status), ['em_processamento', 'aceito_pelo_provedor']);
});

test('mensagem personalizada é mostrada integralmente e enviada apenas ao cadastro do cliente', async () => {
  const a = ambiente();
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'texto', mensagem: 'Pedido confirmado para quarta.' });
  assert.equal(r.resumo.mensagem, 'Pedido confirmado para quarta.');
  await a.executarEnvio(r.payload, a.contexto);
  assert.equal(a.estado.chamadas[0].data.telefone, '5584999999999');
  assert.equal(a.estado.chamadas[0].data.mensagem, r.resumo.mensagem);
});

test('não aceita substituir o destinatário nem argumentos ambíguos', async () => {
  const a = ambiente();
  for (const args of [
    { id_mestre: 123, tipo: 'texto', telefone: '5584999999998' },
    { id_mestre: true, tipo: 'texto' }, { id_mestre: 123, tipo: 'texto', mensagem: {} },
    { id_mestre: 123, tipo: 'pdf', mensagem: 'Texto descartado' }
  ]) await assert.rejects(a.prepararEnvio(args));
  assert.equal(a.estado.chamadas.length, 0);
});

test('cancelamento, telefone inválido, cliente ausente e pedido divergente bloqueiam preparação', async () => {
  for (const mudar of [
    p => { p.situacao = 'C'; }, p => { p.dataCancelamento = '2026-11-22'; },
    p => { p.cliente.telefonePrincipal = '123'; }, p => { p.cliente.favorecido = null; },
    p => { p.idMestre = 999; }
  ]) {
    const a = ambiente(); mudar(a.estado.pedido);
    await assert.rejects(a.prepararEnvio({ id_mestre: 123, tipo: 'texto' }));
    assert.equal(a.estado.chamadas.length, 0);
  }
});

test('mudanças em telefone, cliente, itens ou carrada invalidam a prévia sem disparo', async () => {
  for (const mudar of [
    p => { p.cliente.telefonePrincipal = '84988888888'; }, p => { p.cliente.favorecido = 456; },
    p => { p.itens[0].quantidade = 40; }, p => { p.carradaAtual.data = '2026-12-03'; }
  ]) {
    const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'texto' });
    mudar(a.estado.pedido);
    await assert.rejects(a.executarEnvio(r.payload, a.contexto), /mudou desde a prévia/);
    assert.equal(a.estado.chamadas.length, 0);
  }
});

test('fotos são verificadas novamente e alterações de mídia bloqueiam todo o envio', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'fotos' });
  a.estado.analise.itens[0].foto = 'https://exemplo.invalid/trocada.jpg';
  await assert.rejects(a.executarEnvio(r.payload, a.contexto), /fotos ou os produtos mudaram/);
  assert.equal(a.estado.chamadas.length, 0);
});

test('nenhuma foto é enviada quando qualquer produto fica pendente', async () => {
  const a = ambiente(); a.estado.analise.prontoParaEnvio = false;
  a.estado.analise.pendencias = [{ nome: 'Panela', problema: 'Sem foto' }];
  await assert.rejects(a.prepararEnvio({ id_mestre: 123, tipo: 'fotos' }), /Panela: Sem foto/);
  assert.equal(a.estado.chamadas.length, 0);
});

test('fotos usam serviços existentes em sequência, com referência fixa de mídia, e depois resumo', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'fotos' });
  const resultado = await a.executarEnvio(r.payload, a.contexto);
  assert.equal(resultado.aceitos, 3);
  assert.equal(resultado.total, 3);
  assert.deepEqual(a.estado.chamadas.map(x => x.tipo), ['foto', 'foto', 'resumo_fotos']);
  assert.deepEqual(a.estado.chamadas.map(x => x.funcao), ['pedidos_fotos', 'pedidos_fotos', 'pedidos_fotos_finalizacao']);
  assert.deepEqual(a.estado.chamadas[0].extra.produtoEsperado,
    { nome: 'Panela 4,5 L', foto: 'https://exemplo.invalid/1.jpg' });
});

test('erro parcial interrompe a sequência e informa itens aceitos sem reenviar nem finalizar', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'fotos' });
  a.estado.falharEnvio = 2;
  const resultado = await a.executarEnvio(r.payload, a.contexto);
  assert.equal(resultado.status, 'parcial');
  assert.equal(resultado.aceitos, 1);
  assert.equal(resultado.revisao_manual_necessaria, true);
  assert.equal(a.estado.chamadas.length, 2);
  assert.deepEqual(resultado.resultados.map(x => x.status), ['aceito_pelo_provedor', 'resultado_incerto']);
  assert.deepEqual(a.estado.progresso.map(x => x.status), ['em_processamento', 'aceito_pelo_provedor', 'em_processamento', 'resultado_incerto']);
});

test('áudio envia os bytes aprovados sem gerar outro resumo ou outro áudio na confirmação', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'audio_ia' });
  await a.executarEnvio(r.payload, a.contexto);
  assert.equal(a.estado.audioGerado, 1);
  assert.equal(a.estado.resumoGerado, 1);
  assert.equal(a.estado.chamadas[0].data.audio.bytes.toString(), 'MP3 aprovado');
  assert.equal(a.estado.chamadas[0].funcao, 'envio_manual');
});

test('PDF envia o documento exato preparado, com nome de arquivo e legenda iguais aos da tela', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'pdf' });
  await a.executarEnvio(r.payload, a.contexto);
  const data = a.estado.chamadas[0].data;
  assert.equal(Buffer.from(data.documentoBase64, 'base64').toString(), 'PDF real do pedido 0020021');
  assert.equal(data.nomeArquivo, 'Pedido_0020021_Aluminio_JR.pdf');
  assert.equal(data.legenda, 'Pedido Alumínio JR 0020021');
  assert.equal(a.estado.chamadas[0].funcao, 'pedidos_pdf');
});

test('prévia expirada, bytes alterados e falta de persistência impedem envio', async () => {
  const a = ambiente();
  const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'pdf' });
  await assert.rejects(a.executarEnvio(r.payload), /registro persistente/);
  await assert.rejects(a.executarEnvio({ ...r.payload, expira_em: '2000-01-01T00:00:00Z' }, a.contexto), /expirada/);
  r.payload.documento.base64 = Buffer.from('PDF diferente').toString('base64');
  await assert.rejects(a.executarEnvio(r.payload, a.contexto), /inválido/);
  assert.equal(a.estado.chamadas.length, 0);
});

test('central desligada após preparo bloqueia a confirmação antes de qualquer envio', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'texto' });
  a.estado.bloqueado = true;
  await assert.rejects(a.executarEnvio(r.payload, a.contexto), /Bloqueado/);
  assert.equal(a.estado.chamadas.length, 0);
});

test('falha para registrar tentativa impede envio; falha após aceitação não gera replay', async () => {
  const a = ambiente(); const r = await a.prepararEnvio({ id_mestre: 123, tipo: 'texto' });
  await assert.rejects(a.executarEnvio(r.payload, { registrarProgresso: async () => { throw new Error('Banco indisponível'); } }));
  assert.equal(a.estado.chamadas.length, 0);
  const resultado = await a.executarEnvio(r.payload, { registrarProgresso: async etapa => {
    if (etapa.status === 'aceito_pelo_provedor') throw new Error('Banco indisponível');
  } });
  assert.equal(resultado.status, 'parcial');
  assert.equal(resultado.aceitos, 1);
  assert.equal(a.estado.chamadas.length, 1);
});
