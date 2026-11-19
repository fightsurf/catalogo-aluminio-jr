'use strict';

const crypto = require('node:crypto');
const pool = require('../../../db/connection');
const { montarMesclagem, unirCidades, validarEscolhas } = require('./mesclagemTransportadorasUtils');

function erroStatus(mensagem, statusCode) {
  const erro = new Error(mensagem);
  erro.statusCode = statusCode;
  return erro;
}

function idsValidos(dados) {
  const destinoId = Number(dados && dados.destino_id);
  const origemId = Number(dados && dados.origem_id);
  if (![destinoId, origemId].every(n => Number.isSafeInteger(n) && n > 0) || destinoId === origemId) {
    throw erroStatus('Selecione dois cadastros diferentes.', 400);
  }
  return { destinoId, origemId, escolhas: validarEscolhas(dados) };
}

async function carregar(client, destinoId, origemId, bloquear) {
  const ids = [destinoId, origemId].sort((a, b) => a - b);
  const resultado = await client.query(
    'SELECT * FROM transportadoras WHERE id = ANY($1::integer[]) ORDER BY id' + (bloquear ? ' FOR UPDATE' : ''),
    [ids]
  );
  const destino = resultado.rows.find(r => Number(r.id) === destinoId);
  const origem = resultado.rows.find(r => Number(r.id) === origemId);
  if (!destino || !origem) throw erroStatus('Uma das transportadoras não existe mais.', 404);
  const cidades = await client.query(
    'SELECT tc.transportadora_id, tc.cidade_id, tc.observacao, c.nome, c.estado ' +
    'FROM transportadora_cidade tc LEFT JOIN cidades c ON c.id = tc.cidade_id ' +
    'WHERE tc.transportadora_id = ANY($1::integer[]) ORDER BY tc.transportadora_id, tc.cidade_id',
    [ids]
  );
  const counts = await client.query(
    'SELECT ' +
    '(SELECT COUNT(*)::integer FROM carradas_pedidos_local_entrega WHERE transportadora_id=$1) AS entregas, ' +
    '(SELECT COUNT(*)::integer FROM carradas_pedidos_local_entrega WHERE redespacho_transportadora_id=$1) AS redespachos, ' +
    '(SELECT COUNT(*)::integer FROM assistente_pre_pedidos WHERE transportadora_id=$1) AS pre_pedidos',
    [origemId]
  );
  return { destino, origem, cidades: cidades.rows, contagens: counts.rows[0] };
}

function preparar(dados, destinoId, origemId, escolhas) {
  const novo = montarMesclagem(dados.destino, dados.origem, escolhas);
  const cidades = unirCidades(dados.cidades, destinoId, origemId);
  const assinatura = crypto.createHash('sha256').update(JSON.stringify({
    destinoId, origemId, escolhas, destino: dados.destino, origem: dados.origem,
    cidades: dados.cidades, contagens: dados.contagens
  })).digest('hex');
  return { dadosFinais: novo, cidades, assinatura };
}

function respostaPrevia(dados, preparado, destinoId, origemId) {
  return {
    destino: { id: destinoId, nome: dados.destino.nome, cidade_id: dados.destino.cidade_id },
    origem: { id: origemId, nome: dados.origem.nome, cidade_id: dados.origem.cidade_id },
    dados_finais: preparado.dadosFinais,
    cidades: preparado.cidades,
    cidades_antes: dados.cidades.length,
    cidades_depois: preparado.cidades.length,
    vinculacoes: dados.contagens,
    assinatura: preparado.assinatura
  };
}

async function preverMesclagem(payload) {
  const { destinoId, origemId, escolhas } = idsValidos(payload);
  const dados = await carregar(pool, destinoId, origemId, false);
  const preparado = preparar(dados, destinoId, origemId, escolhas);
  return respostaPrevia(dados, preparado, destinoId, origemId);
}

async function confirmarMesclagem(payload, usuario) {
  const { destinoId, origemId, escolhas } = idsValidos(payload);
  const assinaturaInformada = String(payload.assinatura || '');
  if (!/^[a-f0-9]{64}$/.test(assinaturaInformada)) throw erroStatus('Faça a prévia antes de confirmar.', 400);

  const client = await pool.connect();
  let iniciado = false;
  try {
    await client.query('BEGIN');
    iniciado = true;
    const dados = await carregar(client, destinoId, origemId, true);
    const preparado = preparar(dados, destinoId, origemId, escolhas);
    if (preparado.assinatura !== assinaturaInformada) {
      throw erroStatus('Os dados mudaram desde a prévia. Atualize a prévia e confirme novamente.', 409);
    }

    await client.query(
      'CREATE TABLE IF NOT EXISTS logistica_transportadoras_mesclagens (' +
      'id BIGSERIAL PRIMARY KEY, destino_id INTEGER NOT NULL, origem_id INTEGER NOT NULL, ' +
      'usuario TEXT, dados_anteriores JSONB NOT NULL, dados_resultantes JSONB NOT NULL, ' +
      'criado_em TIMESTAMPTZ NOT NULL DEFAULT now())'
    );

    const final = preparado.dadosFinais;
    await client.query(
      'UPDATE transportadoras SET nome=$1, cidade_id=$2, telefone=$3, telefone_principal=$4, ' +
      'observacao=$5, contato_principal=$6 WHERE id=$7',
      [final.nome, final.cidade_id, final.telefone, final.telefone_principal,
        final.observacao, final.contato_principal, destinoId]
    );

    for (const cidade of preparado.cidades) {
      if (cidade.cidade_id == null) continue;
      await client.query(
        'INSERT INTO transportadora_cidade (transportadora_id,cidade_id,observacao) VALUES ($1,$2,$3) ' +
        'ON CONFLICT (transportadora_id,cidade_id) DO UPDATE SET observacao=EXCLUDED.observacao',
        [destinoId, cidade.cidade_id, cidade.observacao]
      );
    }

    await client.query('UPDATE carradas_pedidos_local_entrega SET transportadora_id=$1 WHERE transportadora_id=$2', [destinoId, origemId]);
    await client.query('UPDATE carradas_pedidos_local_entrega SET redespacho_transportadora_id=$1 WHERE redespacho_transportadora_id=$2', [destinoId, origemId]);
    // O campo transportadora_nome é um retrato textual histórico e permanece intacto.
    await client.query('UPDATE assistente_pre_pedidos SET transportadora_id=$1 WHERE transportadora_id=$2', [destinoId, origemId]);

    await client.query(
      'INSERT INTO logistica_transportadoras_mesclagens ' +
      '(destino_id,origem_id,usuario,dados_anteriores,dados_resultantes) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)',
      [destinoId, origemId, String(usuario || 'admin').slice(0,200),
        JSON.stringify({ destino: dados.destino, origem: dados.origem, cidades: dados.cidades }),
        JSON.stringify({ dados: final, cidades: preparado.cidades, vinculacoes: dados.contagens })]
    );

    // Só elimina o duplicado quando vínculos, dados e histórico já foram preservados.
    await client.query('DELETE FROM transportadoras WHERE id=$1', [origemId]);
    await client.query('COMMIT');
    iniciado = false;
    return { sucesso: true, id: destinoId, removido_id: origemId,
      nome: final.nome, cidades: preparado.cidades.length, vinculacoes: dados.contagens };
  } catch (erro) {
    if (iniciado) await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

module.exports = { preverMesclagem, confirmarMesclagem };
