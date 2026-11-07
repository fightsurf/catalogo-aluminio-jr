'use strict';

// Piloto isolado: apenas os números autorizados, sem alterar bot, sem banco e sem resposta.
const net = require('node:net');
const vinculos = require('./zapi-lid-vinculos.service');
const MAX_AUDIO = 20 * 1024 * 1024;
const MAX_REGISTROS = 60;
const MAX_FILA = 15;
const PRAZO_MS = 2 * 60 * 60 * 1000;
const registros = [];
const fila = [];
let executando = false;
let ultimoWebhookEm = null;
let ultimoAudioAutorizado = null;
const diagnosticos = []; // Somente metadados, em memória e sem telefones de clientes.


function numero(valor) { return String(valor || '').replace(/\D/g, ''); }
function permitidos() {
  return new Set(String(process.env.WHATSAPP_TRANSCRICAO_NUMEROS || '')
    .split(/[;,\s]+/).map(numero).filter(n => /^\d{10,15}$/.test(n)));
}
// Apenas equivalência BR exata: 55 + DDD + 9 + 8 dígitos,
 // permitindo a forma legada sem o nono dígito, quando ela corresponder
 // integralmente a um número autorizado. Nunca compara só prefixos ou finais.
function telefoneAutorizado(telefone) {
  const n = vinculos.limparTelefone(telefone); // recusa LID, JID e texto arbitrário
  if (!n) return '';
  const lista = permitidos();
  if (lista.has(n)) return n;
  for (const autorizado of lista) {
    if (/^55[1-9][0-9]9[0-9]{8}$/.test(autorizado) &&
        n === autorizado.slice(0, 4) + autorizado.slice(5)) return autorizado;
  }
  return '';
}
function podeReceber(telefone) {
  return Boolean(telefoneAutorizado(telefone));
}
function diagnosticarConnectedPhone(valor) {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  const telefone = vinculos.limparTelefone(valor);
  const formato = telefone ? 'telefone' :
    /^\d+@lid$/i.test(bruto) ? 'lid' :
    /@s\.whatsapp\.net$/i.test(bruto) ? 'jid' :
    bruto ? 'inesperado' : 'ausente';
  return {
    formato,
    digitos: telefone ? telefone.length : null,
    final: telefone ? telefone.slice(-4) : null
  };
}
// Guarda só o host da mídia para diagnóstico; nunca registra caminho, query ou token.
function hostAudio(valor) {
  if (typeof valor !== 'string' || valor.length > 16000) return null;
  try {
    const host = new URL(valor).hostname.toLowerCase().replace(/\.$/, '');
    return /^[a-z0-9.-]{1,253}$/.test(host) ? host : null;
  } catch (_) { return null; }
}
function dominioDeAudioPermitido(host) {
  if (!host) return false;
  // Host exato observado na mídia da Z-API; não autoriza todo *.backblazeb2.com.
  // Deve funcionar mesmo quando existe uma lista personalizada no Render.
  if (host === 'f004.backblazeb2.com') return true;
  const dominios = String(process.env.WHATSAPP_TRANSCRICAO_DOMINIOS ||
    'z-api.io,amazonaws.com,cloudfront.net,whatsapp.net,r2.dev,storage.googleapis.com')
    .toLowerCase().split(/[;,\s]+/).map(x => x.replace(/^\./, '').trim()).filter(Boolean);
  return dominios.some(d => host === d || host.endsWith('.' + d));
}

// Apenas metadados de diagnóstico. Nunca guarda áudio, URL ou texto do webhook.
function observarWebhook(payload) {
  const agora = new Date().toISOString();
  ultimoWebhookEm = agora;
  const possuiAudio = Boolean(payload?.audio);
  const dominioAudio = hostAudio(payload?.audio?.audioUrl);
  const autorizado = podeReceber(payload?.phone);
  const conectado = diagnosticarConnectedPhone(payload?.connectedPhone);
  const mesmoNumero = conectado.formato === 'telefone' &&
    vinculos.limparTelefone(payload.connectedPhone) === vinculos.limparTelefone(payload?.phone);
  const instanciaEsperada = String(process.env.ZAPI_WEBHOOK_INSTANCE_ID || '').trim() ||
    (String(process.env.ZAPI_URL || '').match(/\/instances\/([^/]+)\/token\//i) || [])[1] || '';
  const evento = {
    recebido_em: agora,
    tipo_evento: String(payload?.type || 'não informado').slice(0, 40),
    tipo_mensagem: possuiAudio ? 'áudio' :
      payload?.text ? 'texto' : payload?.image ? 'imagem' :
      payload?.video ? 'vídeo' : payload?.document ? 'documento' : 'outra',
    origem: payload?.fromMe === true ? 'enviada por mim' :
      payload?.fromMe === false ? 'recebida' : 'não informada',
    numero_autorizado: autorizado,
    identificador_lid: /@lid$/i.test(String(payload?.phone || '')),
    conectado_informado: conectado.formato !== 'ausente',
    conectado_autorizado: podeReceber(payload?.connectedPhone),
    conectado_equivalencia_sem_nono: Boolean(telefoneAutorizado(payload?.connectedPhone)) &&
      vinculos.limparTelefone(payload?.connectedPhone) !== telefoneAutorizado(payload?.connectedPhone),
    conectado_formato: conectado.formato,
    conectado_digitos: conectado.digitos,
    conectado_final: conectado.final,
    conectado_coincide: mesmoNumero,
    possui_audio: possuiAudio,
    possui_url_audio: Boolean(payload?.audio?.audioUrl),
    dominio_midia: dominioAudio,
    dominio_midia_na_lista: dominioDeAudioPermitido(dominioAudio),
    id_mensagem: Boolean(payload?.messageId),
    instancia_confere: Boolean(instanciaEsperada && String(payload?.instanceId || '') === instanciaEsperada),
    verificacao_lid: possuiAudio && /@lid$/i.test(String(payload?.phone || '')) ? 'aguardando' : 'nao_necessaria',
    _id: String(payload?.instanceId || '') + ':' + String(payload?.messageId || '')
  };
  diagnosticos.unshift(evento);
  while (diagnosticos.length > 12) diagnosticos.pop();
  if (!possuiAudio || !autorizado) return;
  ultimoAudioAutorizado = {
    recebido_em: agora,
    tipo: payload?.fromMe === true ? (mesmoNumero || !evento.conectado_informado ?
      'enviado_para_si' : 'enviado_para_outro') : 'recebido'
  };
}
function marcarLid(payload, estado) {
  const chave = String(payload?.instanceId || '') + ':' + String(payload?.messageId || '');
  const item = diagnosticos.find(d => d._id === chave);
  if (item) {
    item.verificacao_lid = estado;
    if (estado === 'confirmado') item.numero_autorizado = true;
  }
}
function marcarAudioIdentificado(payload, origem) {
  ultimoAudioAutorizado = {
    recebido_em: new Date().toISOString(),
    tipo: origem === 'enviado_para_si' ? 'enviado_para_si' : 'recebido'
  };
}
function limpar() {
  const corte = Date.now() - PRAZO_MS;
  for (let i = registros.length - 1; i >= 0; i--) {
    if (registros[i].criadoMs < corte) registros.splice(i, 1);
  }
  if (registros.length > MAX_REGISTROS) registros.length = MAX_REGISTROS;
}
function erro(mensagem) { return new Error(mensagem); }

// Bloqueia IPs/hosts locais, HTTP e redirecionamentos. Restringe domínios do provedor.
function urlSegura(valor) {
  let u;
  try { u = new URL(valor); } catch (_) { throw erro('Link de áudio inválido.'); }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.protocol !== 'https:' || u.username || u.password ||
      (u.port && u.port !== '443') || net.isIP(host) || !host.includes('.') ||
      host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.internal')) {
    throw erro('Origem do áudio não autorizada.');
  }
  if (!dominioDeAudioPermitido(host)) {
    throw erro('Domínio da mídia não autorizado; confira WHATSAPP_TRANSCRICAO_DOMINIOS.');
  }
  return u.toString();
}
function formatoAudio(mime) {
  const t = String(mime || '').toLowerCase().split(';')[0].trim();
  const tipos = {
    'audio/ogg': ['audio/ogg', 'ogg'],
    'audio/opus': ['audio/ogg', 'ogg'],
    'audio/mpeg': ['audio/mpeg', 'mp3'],
    'audio/mp3': ['audio/mpeg', 'mp3'],
    'audio/mp4': ['audio/mp4', 'm4a'],
    'audio/x-m4a': ['audio/mp4', 'm4a'],
    'audio/wav': ['audio/wav', 'wav'],
    'audio/x-wav': ['audio/wav', 'wav'],
    'audio/webm': ['audio/webm', 'webm'],
    'audio/flac': ['audio/flac', 'flac']
  };
  return tipos[t] || ['audio/ogg', 'ogg'];
}
async function baixar(url) {
  const resposta = await fetch(urlSegura(url), {
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
    headers: { Accept: 'audio/*,application/octet-stream' }
  });
  if (!resposta.ok || !resposta.body) throw erro('Não foi possível baixar o áudio da Z-API.');
  if (Number(resposta.headers.get('content-length') || 0) > MAX_AUDIO) {
    await resposta.body.cancel();
    throw erro('Áudio acima do limite de 20 MB.');
  }
  const partes = [];
  let total = 0;
  for await (const parte of resposta.body) {
    total += parte.length;
    if (total > MAX_AUDIO) {
      await resposta.body.cancel().catch(() => {});
      throw erro('Áudio acima do limite de 20 MB.');
    }
    partes.push(parte);
  }
  if (!total) throw erro('Arquivo de áudio vazio.');
  return Buffer.concat(partes, total);
}
async function transcrever({ url, mime }) {
  const chave = String(process.env.OPENAI_API_KEY || '').trim();
  if (!chave) throw erro('OPENAI_API_KEY não configurada no Render.');
  const bytes = await baixar(url);
  const [tipo, extensao] = formatoAudio(mime);
  const formulario = new FormData();
  formulario.append('file', new Blob([bytes], { type: tipo }), 'whatsapp.' + extensao);
  formulario.append('model', process.env.WHATSAPP_TRANSCRICAO_MODELO || 'gpt-transcribe');
  const resposta = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + chave },
    body: formulario,
    signal: AbortSignal.timeout(90000)
  });
  if (!resposta.ok) throw erro('Serviço de transcrição indisponível (HTTP ' + resposta.status + ').');
  const json = await resposta.json();
  const texto = String(json?.text || '').trim().slice(0, 10000);
  if (!texto) throw erro('Nenhuma fala foi identificada no áudio.');
  return texto;
}
async function processarFila() {
  if (executando) return;
  executando = true;
  try {
    while (fila.length) {
      const tarefa = fila.shift();
      const registro = tarefa.registro;
      registro.status = 'processando';
      try {
        registro.texto = await transcrever(tarefa);
        registro.status = 'concluida';
      } catch (falha) {
        registro.status = 'erro';
        registro.erro = falha.message || 'Falha ao transcrever áudio.';
        console.error('[Piloto transcrição WhatsApp]', registro.erro);
      }
      registro.atualizado_em = new Date().toISOString();
    }
  } finally {
    executando = false;
  }
}
function receber({ payload, dados }) {
  // Mensagens para o próprio número vêm como fromMe:true. Aceitar só se o
  // WhatsApp conectado à Z-API for exatamente o número autorizado/destinatário.
  const conectado = vinculos.limparTelefone(payload?.connectedPhone);
  const canonico = telefoneAutorizado(dados?.telefone);
  const enviadoParaSi = dados?.direcao === 'SAIDA' && payload?.fromMe === true &&
    payload?.fromApi !== true && Boolean(canonico) &&
    (!conectado || telefoneAutorizado(conectado) === canonico);
  const entrada = dados?.direcao === 'ENTRADA' && payload?.fromMe !== true;
  if (!dados || dados.tipo !== 'audio' || (!entrada && !enviadoParaSi) ||
      !podeReceber(dados.telefone) || payload?.isGroup || payload?.isNewsletter) return false;
  limpar();
  const id = String(dados.instancia) + ':' + String(dados.messageId);
  if (registros.some(x => x.id === id)) return false;
  const agora = Date.now();
  const registro = {
    id, telefone: canonico || numero(dados.telefone), criadoMs: agora,
    origem: enviadoParaSi ? 'enviado_para_si' : 'recebido',
    recebido_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString(),
    status: 'pendente', texto: '', erro: ''
  };
  registros.unshift(registro);
  marcarAudioIdentificado(payload, registro.origem);
  if (/@lid$/i.test(String(payload?.phone || ''))) marcarLid(payload, 'confirmado');
  limpar();
  const url = payload?.audio?.audioUrl;
  if (!url) {
    registro.status = 'erro';
    registro.erro = 'A Z-API não forneceu o link do áudio.';
  } else if (fila.length >= MAX_FILA) {
    registro.status = 'erro';
    registro.erro = 'Fila de transcrição cheia. Envie novamente depois.';
  } else {
    fila.push({ registro, url, mime: payload.audio.mimeType });
    void processarFila().catch(falha =>
      console.error('[Piloto transcrição WhatsApp] Falha na fila:', falha.message));
  }
  return true;
}
// Só confere LID de áudio enviado pela própria conta, com a instância
// autenticada e o telefone conectado explicitamente autorizado.
// connectedPhone sozinho NÃO autoriza qualquer destinatário @lid.
async function receberVerificandoLid({ payload, dados }, conferir = vinculos.conferirNumero) {
  if (!vinculos.ehLid(dados?.telefone)) {
    return receber({ payload, dados });
  }
  if (dados?.tipo !== 'audio' || dados?.direcao !== 'SAIDA' ||
      payload?.fromMe !== true || payload?.fromApi === true ||
      payload?.isGroup === true || payload?.isNewsletter === true ||
      dados?.instancia !== vinculos.instanciaAtual()) {
    marcarLid(payload, 'nao_elegivel');
    return false;
  }
  const conectado = vinculos.limparTelefone(payload?.connectedPhone);
  const autorizado = telefoneAutorizado(conectado);
  if (!conectado || !autorizado) {
    marcarLid(payload, 'telefone_conectado_nao_autorizado');
    return false;
  }
  try {
    // Consulta primeiro o formato cadastrado; se ele não confirmar e a Z-API
    // usar a variante sem o 9, verifica também SOMENTE essa variante exata.
    // O LID do webhook precisa ser o mesmo confirmado pelo provedor.
    const candidatos = autorizado === conectado ? [autorizado] : [autorizado, conectado];
    let timer;
    let confirmado = false;
    try {
      confirmado = await Promise.race([
        (async () => {
          for (const telefone of candidatos) {
            let resposta;
            try { resposta = await conferir(telefone); }
            catch (falha) {
              // Credenciais, rede ou banco indisponíveis: não ignora o erro.
              throw falha;
            }
            if (resposta?.vinculado === true &&
                resposta.telefone === telefone &&
                String(resposta.lid || '').toLowerCase() === String(dados.telefone).toLowerCase()) {
              return true;
            }
          }
          return false;
        })(),
        new Promise((_, rejeitar) => {
          timer = setTimeout(() => rejeitar(new Error('timeout_verificacao_lid')), 25000);
          timer.unref?.();
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!confirmado) {
      marcarLid(payload, 'lid_nao_confirmado');
      return false;
    }
    return receber({ payload, dados: { ...dados, telefone: autorizado } });
  } catch (e) {
    // Não registrar payload, telefone, LID nem segredos.
    console.error('[Piloto transcrição] Falha na verificação segura de LID.');
    marcarLid(payload, 'consulta_falhou');
    return false;
  }
}
function listar() {
  limpar();
  return {
    habilitado: permitidos().size > 0,
    ia_configurada: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    webhook_configurado: String(process.env.ZAPI_WEBHOOK_TOKEN || '').trim().length >= 32,
    instancia_configurada: Boolean(String(process.env.ZAPI_WEBHOOK_INSTANCE_ID || '').trim() || /\/instances\/[^/]+\/token\//i.test(String(process.env.ZAPI_URL || ''))),
    ultimo_webhook_em: ultimoWebhookEm,
    ultimo_audio_autorizado: ultimoAudioAutorizado,
    ultimos_webhooks: diagnosticos.map(({ _id, ...evento }) => evento),
    numeros_permitidos_resumo: [...permitidos()].map(n => ({
      digitos: n.length, final: n.slice(-4)
    })),
    registros: registros.map(({ criadoMs, ...r }) => ({ ...r }))
  };
}
module.exports = { receber, receberVerificandoLid, listar, podeReceber, urlSegura, formatoAudio, observarWebhook, marcarLid };
