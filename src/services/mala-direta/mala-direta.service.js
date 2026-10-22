'use strict';
const pool = require('../../../db/connection');
const bridge = require('../legado/legadoBridge.service');
const zapi = require('../integracoes/zapi.service');
const aparicoes = require('../termometro/termometroAparicoes.service');
const eleven = require('../integracoes/elevenlabs-jr.service');
const produtoFotosSchema = require('../produto/produtoFotosSchema.service');

let preparing;
function bad(msg) { const err = new Error(msg); err.status = 400; throw err; }
function id(v) { const n=Number(v); if(!Number.isSafeInteger(n)||n<=0) bad('Identificador inválido.'); return n; }
function telefone(v) {
  let n=String(v||'').replace(/\D/g,'');
  if (/^\d{10,11}$/.test(n)) n='55'+n;
  return /^55\d{10,11}$/.test(n) ? n : null;
}
function urlFoto(valor, origem) {
  const v=String(valor||'').trim();
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(v) && v.length <= 2800000) return v;
  if (v.startsWith('data:')) bad('Imagem enviada inválida ou grande demais.');
  if (!v) bad('Selecione uma foto para a campanha.');
  const u = new URL(v, origem);
  if (!['http:', 'https:'].includes(u.protocol)) bad('URL de imagem inválida.');
  if (u.username || u.password || v.length > 2048) bad('URL de imagem inválida.');
  // Imagens da aplicação devem usar HTTPS público, não endereços internos.
  if (u.protocol !== 'https:') bad('A foto precisa estar disponível em HTTPS.');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|\[|.*\.(local|internal)$)/i.test(u.hostname)) bad('Endereço de imagem não permitido.');
  return u.href;
}
async function preparar() {
  if(preparing) return preparing;
  preparing=(async()=>{
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mala_direta_campanhas (
        id BIGSERIAL PRIMARY KEY,
        produto_id BIGINT NOT NULL REFERENCES produtos(id),
        item_legado BIGINT NOT NULL,
        produto_nome TEXT NOT NULL,
        meses INTEGER NOT NULL DEFAULT 0,
        mensagem TEXT NOT NULL,
        imagem TEXT NOT NULL,
        intervalo_segundos INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ativa',
        proximo_envio_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        iniciada_em TIMESTAMPTZ,
        concluida_em TIMESTAMPTZ,
        CHECK(status IN ('ativa','pausada','concluida'))
      );
      CREATE TABLE IF NOT EXISTS mala_direta_destinatarios (
        id BIGSERIAL PRIMARY KEY,
        campanha_id BIGINT NOT NULL REFERENCES mala_direta_campanhas(id),
        favorecido BIGINT NOT NULL,
        nome TEXT NOT NULL,
        telefone VARCHAR(20) NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'pendente',
        enviado_em TIMESTAMPTZ,
        atualizado_em TIMESTAMPTZ,
        iniciado_envio_em TIMESTAMPTZ,
        erro TEXT,
        retorno_zapi JSONB,
        UNIQUE (campanha_id, favorecido),
        CHECK(status IN ('pendente','enviando','enviado','erro','incerto','bloqueado'))
      );
      ALTER TABLE mala_direta_destinatarios ADD COLUMN IF NOT EXISTS iniciado_envio_em TIMESTAMPTZ;
      -- As campanhas por carrada/semana não exigem item legado do produto anunciado.
      ALTER TABLE mala_direta_campanhas ALTER COLUMN item_legado DROP NOT NULL;
      ALTER TABLE mala_direta_campanhas ADD COLUMN IF NOT EXISTS tipo_publico VARCHAR(12) NOT NULL DEFAULT 'periodo';
      ALTER TABLE mala_direta_campanhas ADD COLUMN IF NOT EXISTS referencia_publico INTEGER;
      ALTER TABLE mala_direta_campanhas ADD COLUMN IF NOT EXISTS audio_texto TEXT;
      ALTER TABLE mala_direta_campanhas ADD COLUMN IF NOT EXISTS audio_mp3 BYTEA;
      ALTER TABLE mala_direta_campanhas ADD COLUMN IF NOT EXISTS audio_voz VARCHAR(100);
      ALTER TABLE mala_direta_campanhas ADD COLUMN IF NOT EXISTS audio_modelo VARCHAR(100);
      ALTER TABLE mala_direta_destinatarios ADD COLUMN IF NOT EXISTS imagem_aceita_em TIMESTAMPTZ;
      ALTER TABLE mala_direta_destinatarios ADD COLUMN IF NOT EXISTS audio_aceito_em TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_mala_direta_fila ON mala_direta_destinatarios (campanha_id,id) WHERE status='pendente';
      CREATE TABLE IF NOT EXISTS mala_direta_bloqueios (
        telefone VARCHAR(20) PRIMARY KEY,
        motivo TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  })().catch(e=>{preparing=null;throw e;});
  return preparing;
}
// A seleção de produtos é exclusiva do catálogo PostgreSQL (Render).
// Firebird é usado somente para o histórico de compras pelo item_legado.
async function produtos(busca='') {
  await produtoFotosSchema.criarEstrutura();
  const termo = String(busca || '').trim().slice(0,80);
  const query = `
    SELECT p.id, p.nome, p.preco, p.item_legado, p.ativo,
           p.foto, p.foto_2, p.foto_3, p.foto_4, p.foto_5, p.foto_6,
           COALESCE((
             SELECT json_agg(json_build_object('id', c.id, 'nome', c.nome) ORDER BY c.nome)
             FROM produtos_categorias c
             WHERE c.id = p.categoria_id OR EXISTS (
               SELECT 1 FROM produto_categoria_vinculos v
               WHERE v.produto_id = p.id AND v.categoria_id = c.id
             )
           ), '[]'::json) AS categorias
      FROM produtos p
     WHERE ($1::text = '' OR p.nome ILIKE '%' || $1 || '%')
     ORDER BY p.nome ASC, p.id ASC`;
  const pg = await pool.query(query,[termo]);
  return pg.rows.map(p => ({
    produtoId: Number(p.id),
    item: p.item_legado == null ? null : Number(p.item_legado),
    nome: p.nome || '',
    preco: p.preco == null ? null : Number(p.preco),
    ativo: p.ativo !== false,
    categorias: p.categorias || [],
    fotos: [p.foto,p.foto_2,p.foto_3,p.foto_4,p.foto_5,p.foto_6].filter(Boolean)
  }));
}
async function compradores(item,meses) {
  const q=await bridge.get('/api/mala-direta/compradores/'+id(item),{meses:meses||0});
  return aplicarBloqueios(q.dados||[]);
}
async function carradas() {
  return (await bridge.get('/api/mala-direta/carradas')).dados || [];
}
async function semanas() {
  const r=await pool.query(`SELECT id,data_inicial,data_final,descricao
    FROM semanas ORDER BY data_inicial DESC,id DESC`);
  return r.rows;
}
function criterioValido(dados) {
  const tipo=String(dados.tipoPublico||'periodo');
  if (!['periodo','carrada','semana'].includes(tipo)) bad('Escolha período, carrada ou semana.');
  const referencia=tipo==='periodo'?null:id(dados.referenciaPublico);
  const meses=tipo==='periodo'?Number(dados.meses):0;
  if (tipo==='periodo'&&(!Number.isInteger(meses)||meses<0||meses>600||meses%6)) bad('Período inválido.');
  return {tipo,referencia,meses};
}
async function compradoresPorCriterio(dados) {
  const {tipo,referencia,meses}=criterioValido(dados);
  if(tipo==='periodo') return compradores(id(dados.item),meses);
  let codigos=[];
  if(tipo==='carrada') {
    const r=await bridge.get('/api/mala-direta/carradas');
    if(!(r.dados||[]).some(c=>Number(c.codigo)===referencia)) bad('Carrada não encontrada.');
    codigos=[referencia];
  } else {
    const r=await pool.query('SELECT codigo_carrada FROM semana_carradas WHERE semana_id=$1 ORDER BY ordem,id',[referencia]);
    const existe=await pool.query('SELECT 1 FROM semanas WHERE id=$1',[referencia]);
    if(!existe.rowCount) bad('Semana não encontrada.');
    codigos=r.rows.map(c=>Number(c.codigo_carrada));
  }
  if(!codigos.length) return [];
  const r=await bridge.post('/api/mala-direta/compradores-carradas',{codigos});
  return aplicarBloqueios(r.dados||[]);
}
async function aplicarBloqueios(lista) {
  await preparar();
  const tels=lista.map(c=>telefone(c.telefone)).filter(Boolean);
  const bloqueados=tels.length?await pool.query('SELECT telefone FROM mala_direta_bloqueios WHERE telefone=ANY($1::varchar[])',[tels]):{rows:[]};
  const bloqueio=new Set(bloqueados.rows.map(r=>r.telefone));
  return lista.map(c=>({...c,telefoneNormalizado:telefone(c.telefone),bloqueado:bloqueio.has(telefone(c.telefone))}));
}
async function primeiraCompra(item) { return (await bridge.get('/api/mala-direta/primeira-compra/'+id(item))).dados; }
async function criar(dados, origem,usuario) {
  await preparar();
  const produtoId=id(dados.produtoId), criterio=criterioValido(dados), intervalo=Number(dados.intervaloSegundos);
  const {tipo,referencia,meses}=criterio;
  if(!Number.isInteger(intervalo)||intervalo<5||intervalo>3600) bad('Intervalo de 5 a 3600 segundos.');
  const mensagem=String(dados.mensagem||'').trim();
  if(!mensagem||mensagem.length>3000) bad('Informe texto de até 3000 caracteres.');
  if(dados.confirmouConsentimento!==true) bad('Confirme a autorização dos destinatários antes de iniciar a campanha.');
  const selecionados=dados.destinatarios;
  if(!Array.isArray(selecionados)||!selecionados.length||selecionados.length>2000) bad('Selecione de 1 a 2000 clientes.');
  const ids=selecionados.map(x=>id(x.favorecido));
  if(new Set(ids).size!==ids.length) bad('Clientes repetidos.');
  const produto=await pool.query('SELECT id, nome, item_legado FROM produtos WHERE id=$1',[produtoId]);
  if(!produto.rows.length) bad('Produto não encontrado no catálogo Render.');
  const codigo=produto.rows[0].item_legado==null?null:Number(produto.rows[0].item_legado);
  if(tipo==='periodo'&&!codigo) bad('Vincule o item legado para consultar compradores por período.');
  const base=await compradoresPorCriterio({tipoPublico:tipo,referenciaPublico:referencia,meses,item:codigo});
  const permitidos=new Map(base.map(x=>[Number(x.favorecido),x]));
  const linhas=selecionados.map(s=>{
    const c=permitidos.get(Number(s.favorecido));
    if(!c||!c.telefoneNormalizado||c.bloqueado||s.autorizado!==true) bad(`Cliente ${s.favorecido}: telefone inválido, bloqueado ou autorização não confirmada.`);
    return {id:Number(s.favorecido),nome:String(c.nome||''),fone:c.telefoneNormalizado};
  });
  if(new Set(linhas.map(x=>x.fone)).size!==linhas.length) bad('Existem clientes selecionados com o mesmo telefone; resolva duplicidades antes de enviar.');
  const imagem=urlFoto(dados.imagem,origem);
  const audioTexto=String(dados.audioTexto||'').trim();
  let audio=null;
  if(audioTexto) {
    if(audioTexto.length>1000) bad('O texto para áudio deve ter até 1000 caracteres.');
    // Usa exatamente a prévia ouvida, sem descontar créditos novamente.
    if(!dados.audioPreviewId) bad('Gere e escute o áudio na configuração ElevenLabs antes de iniciar.');
    audio=eleven.obterPreview(dados.audioPreviewId,usuario);
    if(!audio?.bytes?.length||audio.bytes.length>5*1024*1024) bad('Áudio inválido ou grande demais.');
    if(audioTexto!==audio.texto) bad('O texto do áudio foi alterado. Gere outra prévia.');
  }
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const camp=await client.query(`INSERT INTO mala_direta_campanhas
      (produto_id,item_legado,produto_nome,meses,mensagem,imagem,intervalo_segundos,
        tipo_publico,referencia_publico,audio_texto,audio_mp3,audio_voz,audio_modelo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [produto.rows[0].id,codigo,produto.rows[0].nome,meses,mensagem,imagem,intervalo,
        tipo,referencia,audioTexto||null,audio?.bytes||null,audio?.voz||null,audio?.modelo||null]);
    const cid=camp.rows[0].id;
    for(const r of linhas) await client.query(`INSERT INTO mala_direta_destinatarios (campanha_id,favorecido,nome,telefone)
      VALUES ($1,$2,$3,$4)`,[cid,r.id,r.nome,r.fone]);
    await client.query('COMMIT');
    return {id:Number(cid),total:linhas.length};
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally {client.release();}
}
async function listar() {
  await preparar();
  const r=await pool.query(`SELECT c.id,c.produto_nome,c.item_legado,c.tipo_publico,c.referencia_publico,c.audio_mp3 IS NOT NULL AS com_audio,c.status,c.criada_em,c.intervalo_segundos,
    COUNT(d.id)::int total,
    COUNT(d.id) FILTER (WHERE d.status='enviado')::int enviados,
    COUNT(d.id) FILTER (WHERE d.status='pendente')::int pendentes,
    COUNT(d.id) FILTER (WHERE d.status IN ('erro','incerto','bloqueado'))::int problemas
    FROM mala_direta_campanhas c JOIN mala_direta_destinatarios d ON d.campanha_id=c.id
    GROUP BY c.id ORDER BY c.id DESC LIMIT 30`);
  return r.rows;
}
async function detalhe(cid) {
  await preparar();
  const c=await pool.query('SELECT id,produto_nome,status,tipo_publico,referencia_publico, audio_mp3 IS NOT NULL AS com_audio, intervalo_segundos,criada_em,concluida_em FROM mala_direta_campanhas WHERE id=$1',[id(cid)]);
  if(!c.rows.length) bad('Campanha não encontrada.');
  const d=await pool.query('SELECT favorecido,nome,telefone,status,iniciado_envio_em,enviado_em,imagem_aceita_em,audio_aceito_em,erro FROM mala_direta_destinatarios WHERE campanha_id=$1 ORDER BY id',[cid]);
  return {campanha:c.rows[0],destinatarios:d.rows};
}
async function mudarStatus(cid, acao) {
  await preparar();
  if(!['pausar','retomar'].includes(acao)) bad('Ação inválida.');
  const r=acao==='pausar'
    ?await pool.query(`UPDATE mala_direta_campanhas SET status='pausada' WHERE id=$1 AND status='ativa' RETURNING id`,[id(cid)])
    :await pool.query(`UPDATE mala_direta_campanhas SET status='ativa', proximo_envio_em=NOW() WHERE id=$1 AND status='pausada' RETURNING id`,[id(cid)]);
  if(!r.rowCount) bad('Campanha inexistente ou em estado incompatível.');
  return {id:Number(cid),status:acao==='pausar'?'pausada':'ativa'};
}
async function bloquear(fone, motivo) {
  await preparar();
  const n=telefone(fone); if(!n) bad('Telefone inválido.');
  await pool.query(`INSERT INTO mala_direta_bloqueios (telefone,motivo) VALUES ($1,$2)
    ON CONFLICT(telefone) DO UPDATE SET motivo=excluded.motivo`,[n,String(motivo||'Não receber promoções').slice(0,300)]);
  await pool.query(`UPDATE mala_direta_destinatarios SET status='bloqueado',erro='Telefone bloqueado para promoções'
    WHERE telefone=$1 AND status='pendente'`,[n]);
  return {telefone:n};
}
async function enviarTeste(fone, img, mensagem, origem) {
  const n=telefone(fone);if(!n) bad('Telefone de teste inválido.');
  const m=String(mensagem||'').trim();if(!m||m.length>3000) bad('Mensagem inválida.');
  const imagem=urlFoto(img,origem);
  await zapi.enviarImagem({telefone:n,imagem,legenda:m});
  return {telefone:n};
}
// Claim persistente: jamais reenvia automaticamente um destino já marcado 'enviando'.
// Se o processo morrer durante a chamada, ele passa a 'incerto' e requer verificação manual.
async function processarProximo() {
  await preparar();
  // Recupera contagem de campanha já enviada, mesmo se o processo parou entre
  // a confirmação de envio e a inserção da aparição no Termômetro.
  const pendentesContagem = await pool.query(`
    SELECT c.id, c.produto_id, c.produto_nome FROM mala_direta_campanhas c
    WHERE EXISTS (SELECT 1 FROM mala_direta_destinatarios d WHERE d.campanha_id=c.id AND (d.status='enviado' OR d.imagem_aceita_em IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM termometro_aparicoes t WHERE t.produto_id=c.produto_id
        AND t.origem='mala_direta' AND t.origem_chave='campanha:' || c.id::text)
    ORDER BY c.id DESC LIMIT 10
  `).catch(e=>{ if(e.code==='42P01') return {rows:[]}; throw e; });
  for (const c of pendentesContagem.rows) {
    await aparicoes.inserirAparicao({produtoId:c.produto_id,origem:'mala_direta',origemChave:'campanha:'+c.id,
      origemId:c.id, quantidade:1,detalhes:{produto_nome:c.produto_nome}});
  }
  const client=await pool.connect(); let trabalho;
  try {
    await client.query('BEGIN');
    const trava=await client.query('SELECT pg_try_advisory_xact_lock(74912014) AS ok');
    if(!trava.rows[0].ok){await client.query('COMMIT');return;}
    await client.query(`UPDATE mala_direta_destinatarios SET status='incerto',erro='Envio interrompido: verificar manualmente antes de qualquer novo disparo',atualizado_em=NOW()
      WHERE status='enviando' AND atualizado_em < NOW()-INTERVAL '3 minutes'`);
    // Finaliza campanhas sem pendências (inclusive últimas linhas bloqueadas).
    await client.query(`UPDATE mala_direta_campanhas c SET status='concluida',concluida_em=NOW()
      WHERE c.status='ativa' AND NOT EXISTS
        (SELECT 1 FROM mala_direta_destinatarios d WHERE d.campanha_id=c.id AND d.status IN ('pendente','enviando'))`);
    const r=await client.query(`
      SELECT d.id,d.campanha_id,d.telefone,c.produto_id,c.produto_nome,c.mensagem,c.imagem,c.intervalo_segundos,c.audio_mp3
      FROM mala_direta_destinatarios d JOIN mala_direta_campanhas c ON c.id=d.campanha_id
      WHERE d.status='pendente' AND c.status='ativa' AND c.proximo_envio_em<=NOW()
        AND NOT EXISTS(SELECT 1 FROM mala_direta_destinatarios v WHERE v.campanha_id=c.id AND v.status='enviando')
      ORDER BY c.proximo_envio_em,c.id,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED`);
    if(!r.rows.length){await client.query('COMMIT');return;}
    trabalho=r.rows[0];
    const blocked=await client.query('SELECT 1 FROM mala_direta_bloqueios WHERE telefone=$1',[trabalho.telefone]);
    if(blocked.rowCount) {
      await client.query(`UPDATE mala_direta_destinatarios SET status='bloqueado',atualizado_em=NOW() WHERE id=$1`,[trabalho.id]);
    } else {
      await client.query(`UPDATE mala_direta_destinatarios SET status='enviando',iniciado_envio_em=NOW(),atualizado_em=NOW() WHERE id=$1`,[trabalho.id]);
      await client.query(`UPDATE mala_direta_campanhas SET iniciada_em=COALESCE(iniciada_em,NOW()),
        proximo_envio_em=NOW()+($2::integer * INTERVAL '1 second') WHERE id=$1`,[trabalho.campanha_id,trabalho.intervalo_segundos]);
    }
    await client.query('COMMIT');
    if(blocked.rowCount) return;
  } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;} finally {client.release();}
  let resultado, erro;
  try {
    resultado=await zapi.enviarImagem({telefone:trabalho.telefone,imagem:trabalho.imagem,legenda:trabalho.mensagem});
    // Gravar confirmação da imagem ANTES de tentar enviar o áudio; nunca repetir envio incerto.
    await pool.query(`UPDATE mala_direta_destinatarios SET imagem_aceita_em=NOW(),
      retorno_zapi=$2::jsonb,atualizado_em=NOW() WHERE id=$1 AND status='enviando'`,
      [trabalho.id,JSON.stringify(resultado.zapi||{})]);
    try {
      await aparicoes.inserirAparicao({produtoId:trabalho.produto_id,origem:'mala_direta',
        origemChave:'campanha:'+trabalho.campanha_id,origemId:trabalho.campanha_id,
        quantidade:1,detalhes:{produto_nome:trabalho.produto_nome}});
    } catch (e) {
      // A recuperação idempotente fará a contagem: falha do Termômetro não cancela o áudio.
      console.error('[mala-direta] Contagem de aparição adiada:',e.message);
    }
    if(trabalho.audio_mp3) {
      const bytes=Buffer.isBuffer(trabalho.audio_mp3)?trabalho.audio_mp3:Buffer.from(trabalho.audio_mp3);
      await zapi.postZapi('/send-audio',{
        phone:trabalho.telefone,audio:'data:audio/mpeg;base64,'+bytes.toString('base64')
      });
      await pool.query(`UPDATE mala_direta_destinatarios SET audio_aceito_em=NOW(),atualizado_em=NOW()
        WHERE id=$1 AND status='enviando'`,[trabalho.id]);
    }
  }catch(e){erro=e;}
  // Rede/Z-API podem ter aceitado uma das mensagens. Não reenviar automaticamente.
  const status=erro?'incerto':'enviado';
  try {
    await pool.query(`UPDATE mala_direta_destinatarios SET status=$2,
      enviado_em=CASE WHEN $2='enviado' THEN NOW() ELSE NULL END,
      atualizado_em=NOW(),erro=$3 WHERE id=$1 AND status='enviando'`,
      [trabalho.id,status,erro?String(erro.message).slice(0,900):null]);
  } catch(e) {console.error('[mala-direta] Persistência pós-envio:',e.message);}
  await pool.query(`UPDATE mala_direta_campanhas c SET status='concluida',concluida_em=NOW()
    WHERE c.id=$1 AND c.status='ativa'
    AND NOT EXISTS (SELECT 1 FROM mala_direta_destinatarios d WHERE d.campanha_id=c.id AND d.status IN ('pendente','enviando'))`,[trabalho.campanha_id]).catch(e=>console.error('[mala-direta]',e.message));
}
let trabalhadorIniciado=false;
function iniciarTrabalhador() {
  if(trabalhadorIniciado) return;
  trabalhadorIniciado=true;
  async function executar() {
    let espera=5000;
    try {
      // Nunca sobrepor execuções: só agenda o próximo ciclo após o atual terminar.
      await processarProximo();
      const fila=await pool.query(`SELECT EXISTS (
        SELECT 1 FROM mala_direta_campanhas c
        WHERE c.status='ativa' AND EXISTS (
          SELECT 1 FROM mala_direta_destinatarios d
          WHERE d.campanha_id=c.id AND d.status IN ('pendente','enviando')
        )
      ) AS ha_fila`);
      // Com fila ativa, varredura a cada segundo (antes era 5 segundos).
      // Fora de campanha, mantém 5 segundos para não sobrecarregar o banco.
      if(fila.rows[0]?.ha_fila) espera=1000;
    } catch(e) { console.error('[mala-direta/worker]',e.message); }
    finally { const t=setTimeout(executar,espera);t.unref?.(); }
  }
  const t=setTimeout(executar,1000);
  t.unref?.();
}
module.exports={produtos,compradores,compradoresPorCriterio,carradas,semanas,primeiraCompra,criar,listar,detalhe,mudarStatus,bloquear,enviarTeste,iniciarTrabalhador};
