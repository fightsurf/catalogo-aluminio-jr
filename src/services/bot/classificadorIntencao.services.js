const https = require('https');
const pool = require('../../../db/connection');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const INTENCAO_DESCONHECIDO = 'DESCONHECIDO';
const DESCRICAO_DESCONHECIDO = 'use quando a mensagem não se encaixar claramente em nenhuma das intenções acima';
const DEBUG = process.env.DEBUG_INTENCAO === 'true';

function chamarOpenAI(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Você é um classificador de intenções. Analise as mensagens do cliente e retorne APENAS JSON válido no formato {"intencao":"<NOME>"}. Não inclua texto extra, explicações ou markdown.'
        },
        { role: 'user', content: prompt }
      ]
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`OpenAI: ${parsed.error.message}`));
          resolve(parsed);
        } catch (e) {
          reject(new Error('Resposta inválida da OpenAI'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function classificarIntencao(telefone) {
  // ── Passo 1: capturar mensagens e intenções em transação separada ──
  const client = await pool.connect();
  let mensagens;
  let intencoes;
  let ids;

  try {
    await client.query('BEGIN');

    const resMensagens = await client.query(
      `SELECT id, mensagem
       FROM bot_mensagens
       WHERE telefone = $1
         AND direcao = 'ENTRADA'
         AND processada_ia = false
       ORDER BY criada_em DESC
       LIMIT 3
       FOR UPDATE SKIP LOCKED`,
      [telefone]
    );

    if (!resMensagens.rows.length) {
      await client.query('ROLLBACK');
      const err = new Error('Nenhuma mensagem não processada encontrada para este telefone.');
      err.status = 404;
      throw err;
    }

    mensagens = resMensagens.rows;
    ids = mensagens.map(m => m.id);

    const resIntencoes = await client.query(
      `SELECT nome, descricao FROM bot_intencoes WHERE ativa = true`
    );

    if (!resIntencoes.rows.length) {
      await client.query('ROLLBACK');
      const err = new Error('Nenhuma intenção ativa cadastrada.');
      err.status = 503;
      throw err;
    }

    intencoes = resIntencoes.rows;

    // Confirmar leitura para liberar locks antes da chamada externa
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // ── Passo 2: montar prompt e chamar OpenAI (fora da transação) ──
  const nomesPermitidos = Array.from(new Set(intencoes.map(i => i.nome.toUpperCase())).add(INTENCAO_DESCONHECIDO));

  const listaIntencoes = intencoes
    .map(i => `- ${i.nome}: ${i.descricao}`)
    .join('\n');

  const textoMensagens = mensagens
    .map((m, idx) => `Mensagem ${idx + 1}: "${m.mensagem}"`)
    .join('\n');

  const prompt =
    `Intenções disponíveis:\n${listaIntencoes}\n- ${INTENCAO_DESCONHECIDO}: ${DESCRICAO_DESCONHECIDO}.\n\n` +
    `Mensagens do cliente:\n${textoMensagens}\n\n` +
    `Responda APENAS com JSON válido no formato: {"intencao":"<NOME>"}\n` +
    `O valor de "intencao" deve ser EXATAMENTE um dos nomes: ${nomesPermitidos.join(', ')}.\n` +
    `Não invente novas intenções. Não inclua texto extra. Sem markdown. Sem explicações.`;

  if (DEBUG) {
    console.log('[DEBUG_INTENCAO] telefone:', telefone);
    console.log('[DEBUG_INTENCAO] ids:', ids);
    console.log('[DEBUG_INTENCAO] mensagens:', mensagens.map(m => m.mensagem));
    console.log('[DEBUG_INTENCAO] intencoes permitidas:', nomesPermitidos);
    console.log('[DEBUG_INTENCAO] prompt:', prompt);
  }

  let intencaoDetectada = INTENCAO_DESCONHECIDO;

  const resposta = await chamarOpenAI(prompt);
  if (DEBUG) {
    console.log('[DEBUG_INTENCAO] resposta OpenAI:', JSON.stringify(resposta));
  }
  try {
    const conteudo = resposta.choices[0].message.content;
    const json = JSON.parse(conteudo);
    const nomeIntencao = (json.intencao || '').toString().trim().toUpperCase();
    if (nomesPermitidos.includes(nomeIntencao)) {
      intencaoDetectada = nomeIntencao;
    } else {
      if (DEBUG) {
        console.warn('[DEBUG_INTENCAO] fallback: intenção retornada pelo modelo não está na lista permitida:', nomeIntencao);
      }
      intencaoDetectada = INTENCAO_DESCONHECIDO;
    }
  } catch (e) {
    if (DEBUG) {
      console.warn('[DEBUG_INTENCAO] fallback: falha ao parsear resposta da OpenAI:', e.message);
    }
    intencaoDetectada = INTENCAO_DESCONHECIDO;
  }

  // ── Passo 3: marcar mensagens como processadas em nova transação ──
  const client2 = await pool.connect();
  try {
    await client2.query('BEGIN');
    await client2.query(
      `UPDATE bot_mensagens SET processada_ia = true, intencao_classificada = $2 WHERE id = ANY($1::bigint[])`,
      [ids, intencaoDetectada]
    );
    await client2.query('COMMIT');
  } catch (err) {
    await client2.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client2.release();
  }

  return { intencao: intencaoDetectada };
}

module.exports = { classificarIntencao };
