'use strict';
const pool = require('../../../db/connection');
const status = require('./status-whatsapp.service');
const videos = require('./statusProdutoVideo.service');
const zapi = require('../integracoes/zapi.service');
const termometro = require('../termometro/termometroAparicoes.service');

const REDES = ['whatsapp', 'instagram', 'facebook_story'];
const FUSO = 'America/Fortaleza';
const LOCK = 20261024;
let preparacao, timer, rodando = false;

function preparar() {
  if (!preparacao) preparacao = pool.query([
    "CREATE TABLE IF NOT EXISTS status_zap_agendamento (",
    "id INTEGER PRIMARY KEY CHECK (id=1), ativo BOOLEAN NOT NULL DEFAULT FALSE,",
    "categorias INTEGER[] NOT NULL DEFAULT '{}', intervalo_minutos INTEGER NOT NULL DEFAULT 360,",
    "intervalo_produtos_segundos INTEGER NOT NULL DEFAULT 5, inicio_minuto INTEGER NOT NULL DEFAULT 360,",
    "fim_minuto INTEGER NOT NULL DEFAULT 1320, tipo_midia TEXT NOT NULL DEFAULT 'foto',",
    "redes TEXT[] NOT NULL DEFAULT ARRAY['whatsapp','instagram','facebook_story']::text[],",
    "proxima_execucao TIMESTAMPTZ, indice INTEGER NOT NULL DEFAULT 0, atualizado_em TIMESTAMPTZ DEFAULT NOW());",
    "INSERT INTO status_zap_agendamento(id) VALUES (1) ON CONFLICT DO NOTHING;",
    "CREATE TABLE IF NOT EXISTS status_zap_agendamento_lotes (",
    "id BIGSERIAL PRIMARY KEY, categoria_id INTEGER NOT NULL, categoria_nome TEXT NOT NULL,",
    "tipo_midia TEXT NOT NULL, redes TEXT[] NOT NULL, intervalo_produtos_segundos INTEGER NOT NULL,",
    "status TEXT NOT NULL DEFAULT 'executando', erro TEXT, criado_em TIMESTAMPTZ DEFAULT NOW(),",
    "concluido_em TIMESTAMPTZ);",
    "CREATE TABLE IF NOT EXISTS status_zap_agendamento_itens (",
    "lote_id BIGINT REFERENCES status_zap_agendamento_lotes(id), produto_id INTEGER NOT NULL,",
    "canal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', erro TEXT,",
    "atualizado_em TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY(lote_id,produto_id,canal));",
    "CREATE INDEX IF NOT EXISTS idx_status_zap_agenda_abertos ON",
    "status_zap_agendamento_lotes(id) WHERE status='executando';"
  ].join(' ')).catch((erro) => { preparacao = null; throw erro; });
  return preparacao;
}

function erroValidacao(mensagem) {
  const e = new Error(mensagem); e.status = 400; throw e;
}
function inteiro(valor, minimo, maximo, nome) {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < minimo || n > maximo) erroValidacao(nome + ' inválido.');
  return n;
}
function minutos(horario) {
  if (typeof horario !== 'string' || !/^\d{2}:\d{2}$/.test(horario)) erroValidacao('Horário inválido: use HH:MM.');
  const [h, m] = horario.split(':').map(Number);
  if (h > 23 || m > 59) erroValidacao('Horário inválido.');
  return h * 60 + m;
}
function hora(valor) {
  return String(Math.floor(valor / 60)).padStart(2, '0') + ':' + String(valor % 60).padStart(2, '0');
}
function minutoLocal(data) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(data);
  const get = (chave) => Number(partes.find((p) => p.type === chave).value);
  return (get('hour') % 24) * 60 + get('minute');
}
function aberta(data, inicio, fim) {
  const m = minutoLocal(data);
  return inicio === fim || (inicio < fim ? (m >= inicio && m < fim) : (m >= inicio || m < fim));
}
function proximaDentro(base, inicio, fim) {
  let d = new Date(base);
  if (aberta(d, inicio, fim)) return d;
  d.setUTCSeconds(0, 0);
  d = new Date(d.getTime() + 60000);
  for (let i = 0; i < 1441; i++) {
    if (aberta(d, inicio, fim)) return d;
    d = new Date(d.getTime() + 60000);
  }
  throw new Error('Não foi possível calcular a próxima execução.');
}
function serializar(row) {
  return {
    ativo: row.ativo, categorias: row.categorias.map(Number),
    intervaloMinutos: row.intervalo_minutos, intervaloProdutosSegundos: row.intervalo_produtos_segundos,
    inicio: hora(row.inicio_minuto), fim: hora(row.fim_minuto),
    tipoMidia: row.tipo_midia, redes: row.redes, indice: row.indice,
    proximaExecucao: row.proxima_execucao, atualizadoEm: row.atualizado_em, fuso: FUSO
  };
}
async function configuracao() {
  await preparar();
  return serializar((await pool.query('SELECT * FROM status_zap_agendamento WHERE id=1')).rows[0]);
}
async function salvarConfiguracao(dados) {
  await preparar();
  if (!dados || typeof dados !== 'object') erroValidacao('Configuração inválida.');
  const ativo = dados.ativo === true;
  if (!Array.isArray(dados.categorias) || dados.categorias.length > 100) erroValidacao('Selecione até 100 categorias.');
  const categorias = dados.categorias.map((v) => inteiro(v, 1, 2147483647, 'Categoria'));
  if (categorias.length !== new Set(categorias).size) erroValidacao('Categorias repetidas.');
  if (ativo && !categorias.length) erroValidacao('Escolha ao menos uma categoria para ativar.');
  const intervalo = inteiro(dados.intervaloMinutos, 1, 10080, 'Intervalo entre categorias');
  const espera = inteiro(dados.intervaloProdutosSegundos, 3, 300, 'Intervalo entre produtos');
  const inicio = minutos(dados.inicio), fim = minutos(dados.fim);
  if (!['foto','video','foto_video'].includes(dados.tipoMidia)) erroValidacao('Tipo de mídia inválido.');
  if (!Array.isArray(dados.redes) || !dados.redes.length ||
      dados.redes.some((r) => !REDES.includes(r)) ||
      dados.redes.length !== new Set(dados.redes).size) erroValidacao('Selecione uma ou mais redes sociais.');
  const catNoBanco = categorias.length ?
    await pool.query('SELECT id FROM produtos_categorias WHERE id=ANY($1::integer[])', [categorias]) : { rowCount: 0 };
  if (catNoBanco.rowCount !== categorias.length) erroValidacao('Uma categoria selecionada não existe mais.');
  const antiga = await configuracao();
  const novaBase = [categorias, intervalo, espera, inicio, fim, dados.tipoMidia, dados.redes];
  const velhaBase = [antiga.categorias, antiga.intervaloMinutos, antiga.intervaloProdutosSegundos,
    minutos(antiga.inicio), minutos(antiga.fim), antiga.tipoMidia, antiga.redes];
  const mudou = JSON.stringify(novaBase) !== JSON.stringify(velhaBase);
  const indice = mudou ? 0 : antiga.indice;
  const proxima = !ativo ? null : (mudou || !antiga.ativo || !antiga.proximaExecucao
    ? proximaDentro(new Date(Date.now() + intervalo * 60000), inicio, fim)
    : antiga.proximaExecucao);
  const r = await pool.query(
    'UPDATE status_zap_agendamento SET ativo=$1,categorias=$2,intervalo_minutos=$3,' +
    'intervalo_produtos_segundos=$4,inicio_minuto=$5,fim_minuto=$6,tipo_midia=$7,' +
    'redes=$8,indice=$9,proxima_execucao=$10,atualizado_em=NOW() WHERE id=1 RETURNING *',
    [ativo,categorias,intervalo,espera,inicio,fim,dados.tipoMidia,dados.redes,indice,proxima]
  );
  return serializar(r.rows[0]);
}
async function painel() {
  await preparar();
  const [cfg, lotes, cats] = await Promise.all([
    configuracao(),
    pool.query([
      'SELECT l.*,COUNT(i.*)::int AS total,',
      "COUNT(i.*) FILTER(WHERE i.status='publicado')::int AS publicados,",
      "COUNT(i.*) FILTER(WHERE i.status IN ('erro','incerto'))::int AS falhas",
      'FROM status_zap_agendamento_lotes l LEFT JOIN status_zap_agendamento_itens i ON i.lote_id=l.id',
      'GROUP BY l.id ORDER BY l.id DESC LIMIT 25'
    ].join(' ')),
    status.listarCategorias()
  ]);
  const nomes = new Map(cats.map((c) => [c.id,c.nome]));
  const proxId = cfg.categorias.length ? cfg.categorias[cfg.indice % cfg.categorias.length] : null;
  const historico = lotes.rows.map((l) => ({
    id: Number(l.id), categoria: l.categoria_nome, status: l.status,
    criadoEm: l.criado_em, concluidoEm: l.concluido_em,
    erro: l.erro, publicados: l.publicados, falhas: l.falhas, total: l.total,
    tipoMidia: l.tipo_midia
  }));
  return {
    configuracao: cfg, categorias: cats,
    proximaCategoria: proxId ? nomes.get(proxId) || '(categoria removida)' : null,
    ultimaCategoria: historico[0]?.categoria || null,
    executando: historico.find((l) => l.status === 'executando') || null,
    historico
  };
}
async function criarLote(db, config) {
  const catId = config.categorias[config.indice % config.categorias.length];
  const dados = await status.listarProdutosPorCategoria(catId);
  await db.query('BEGIN');
  try {
    const atual = (await db.query('SELECT * FROM status_zap_agendamento WHERE id=1 FOR UPDATE')).rows[0];
    const idAtual = atual.categorias.length ? atual.categorias[atual.indice % atual.categorias.length] : null;
    if (!atual.ativo || idAtual !== catId || atual.tipo_midia !== config.tipo_midia ||
        !atual.proxima_execucao || new Date(atual.proxima_execucao) > new Date()) {
      await db.query('ROLLBACK'); return null;
    }
    const tipo = atual.tipo_midia;
    const produtos = dados.produtos.filter((p) =>
      tipo === 'foto' ? p.publicavel_foto : tipo === 'video' ? p.publicavel_video :
        p.publicavel_foto || p.publicavel_video
    );
    const lote = (await db.query(
      'INSERT INTO status_zap_agendamento_lotes(categoria_id,categoria_nome,tipo_midia,redes,intervalo_produtos_segundos)' +
      ' VALUES($1,$2,$3,$4,$5) RETURNING id',
      [catId, dados.categoria.nome, tipo, atual.redes, atual.intervalo_produtos_segundos]
    )).rows[0];
    for (const produto of produtos) {
      for (const canal of (tipo === 'foto' ? atual.redes : ['video'])) {
        await db.query('INSERT INTO status_zap_agendamento_itens(lote_id,produto_id,canal) VALUES($1,$2,$3)',
          [lote.id,produto.id,canal]);
      }
    }
    if (tipo === 'foto' && atual.redes.includes('facebook_story') && produtos.length) {
      await db.query('INSERT INTO status_zap_agendamento_itens(lote_id,produto_id,canal) VALUES($1,0,$2)',
        [lote.id,'facebook_feed']);
    }
    const proxima = proximaDentro(
      new Date(Date.now() + atual.intervalo_minutos * 60000), atual.inicio_minuto, atual.fim_minuto
    );
    await db.query('UPDATE status_zap_agendamento SET indice=$1,proxima_execucao=$2 WHERE id=1',
      [(atual.indice + 1) % atual.categorias.length,proxima]);
    await db.query('COMMIT');
    return lote.id;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
async function marcar(db, item, estado, erro) {
  await db.query('UPDATE status_zap_agendamento_itens SET status=$4,erro=$5,atualizado_em=NOW() ' +
    'WHERE lote_id=$1 AND produto_id=$2 AND canal=$3',
    [item.lote_id,item.produto_id,item.canal,estado,erro || null]);
}
async function publicarFoto(produto, canal, chave) {
  if (canal === 'whatsapp') {
    await zapi.enviarImagemStatus({ imagem: produto.foto, legenda: produto.nome + '\n' + produto.preco_formatado });
  } else if (canal === 'instagram') {
    await status.publicarProdutoInstagram(produto, chave);
  } else {
    await status.publicarProdutoFacebookStory(produto, chave);
  }
  try {
    await termometro.registrarStatusZap({
      requestId: chave, produto, canais: { [canal]: { status:'publicado' } }
    });
  } catch (e) { console.error('[Status agendado] Termômetro:', e.message); }
}
async function trabalharLote(db, id) {
  const lote = (await db.query('SELECT * FROM status_zap_agendamento_lotes WHERE id=$1',[id])).rows[0];
  if (!lote || lote.status !== 'executando') return;
  const itens = (await db.query("SELECT * FROM status_zap_agendamento_itens WHERE lote_id=$1 " +
    "ORDER BY CASE WHEN canal='facebook_feed' THEN 1 ELSE 0 END, produto_id, canal",[id])).rows;
  for (let ix = 0; ix < itens.length; ix++) {
    const item = itens[ix];
    if (!['pendente','enviando'].includes(item.status)) continue;
    if (!(await db.query('SELECT ativo FROM status_zap_agendamento WHERE id=1')).rows[0].ativo) return;
    if (item.status === 'enviando' && item.canal !== 'video') {
      await marcar(db,item,'incerto','Envio interrompido. Confira o canal antes de republicar.');
      continue;
    }
    try {
      if (item.canal === 'facebook_feed') {
        await marcar(db,item,'enviando');
        await status.publicarCategoriaFacebook({
          requestId: 'agendamento-feed-'+id, categoriaId: lote.categoria_id
        });
        await marcar(db,item,'publicado');
      } else if (item.canal === 'video') {
        const chave = 'agendamento-'+id+'-'+item.produto_id;
        let resultado;
        try {
          resultado = await videos.consultar(chave);
        } catch (e) {
          if (!/não encontrada/i.test(e.message)) throw e;
          const produto = await status.buscarProdutoParaEnvio(item.produto_id,lote.categoria_id,lote.tipo_midia);
          await marcar(db,item,'enviando');
          resultado = await videos.iniciar({
            requestId: chave, produto, tipoMidia: lote.tipo_midia, canaisAtivos: lote.redes
          });
        }
        if (resultado.status === 'processando') return;
        const completo = lote.redes.every((r) => resultado.canais[r]?.status === 'publicado');
        const duvidoso = lote.redes.some((r) =>
          resultado.canais[r]?.foto?.status === 'incerto' ||
          resultado.canais[r]?.partes?.some((p) => p.status === 'incerto')
        );
        await marcar(db,item,completo?'publicado':duvidoso?'incerto':'erro',
          completo?null:resultado.erro||'Vídeo incompleto. Verifique os Stories.');
      } else {
        const produto = await status.buscarProdutoParaEnvio(item.produto_id,lote.categoria_id,'foto');
        await marcar(db,item,'enviando');
        await publicarFoto(produto,item.canal,'agendamento-'+id+'-'+item.produto_id);
        await marcar(db,item,'publicado');
      }
    } catch (e) {
      // Sem confirmação da API externa, nunca se tenta automaticamente outra publicação.
      await marcar(db,item,'incerto',String(e.message||e).slice(0,600));
    }
    if (ix < itens.length-1) await new Promise((r) =>
      setTimeout(r,lote.intervalo_produtos_segundos*1000));
  }
  const total = (await db.query(
    "SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE status='publicado')::int AS ok,"+
    "COUNT(*) FILTER(WHERE status IN ('erro','incerto'))::int AS falhas "+
    'FROM status_zap_agendamento_itens WHERE lote_id=$1',[id]
  )).rows[0];
  const resultado = total.total === 0?'sem_produtos':total.falhas===0?'concluido':
    total.ok?'parcial':'erro';
  await db.query(
    'UPDATE status_zap_agendamento_lotes SET status=$2,concluido_em=NOW(),erro=$3 WHERE id=$1',
    [id,resultado,total.falhas?total.falhas+' publicação(ões) sem confirmação.':null]
  );
}
async function executar() {
  if (rodando) return;
  rodando = true;
  let db, bloqueado = false;
  try {
    await preparar();
    db = await pool.connect();
    bloqueado = (await db.query('SELECT pg_try_advisory_lock($1) AS ok',[LOCK])).rows[0].ok;
    if (!bloqueado) return;
    let pendente = await db.query(
      "SELECT id FROM status_zap_agendamento_lotes WHERE status='executando' ORDER BY id LIMIT 1"
    );
    if (!pendente.rowCount) {
      const cfg = (await db.query('SELECT * FROM status_zap_agendamento WHERE id=1')).rows[0];
      if (!cfg.ativo || !cfg.categorias.length || !cfg.proxima_execucao ||
          new Date(cfg.proxima_execucao) > new Date() ||
          !aberta(new Date(),cfg.inicio_minuto,cfg.fim_minuto)) return;
      const novo = await criarLote(db,cfg);
      if (!novo) return;
      pendente = { rows: [{ id:novo }] };
    }
    await trabalharLote(db,pendente.rows[0].id);
  } catch (e) { console.error('[Status Zap agendado]',e); }
  finally {
    if (db) {
      if (bloqueado) await db.query('SELECT pg_advisory_unlock($1)',[LOCK]).catch(()=>{});
      db.release();
    }
    rodando = false;
  }
}
function iniciar() {
  if (timer) return;
  timer = setInterval(() => { executar().catch(console.error); },60000);
  timer.unref?.();
  executar().catch(console.error);
}
module.exports = { preparar, configuracao, salvarConfiguracao, painel, executar, iniciar };
