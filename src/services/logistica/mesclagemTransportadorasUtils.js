'use strict';

const { telefones } = require('./importacaoExcursoesUtils');

function texto(valor) {
  return String(valor == null ? '' : valor).trim();
}

function unirObservacoes() {
  const linhas = [];
  const vistas = new Set();
  for (const valor of arguments) {
    for (const linha of texto(valor).split(/\r?\n/)) {
      const limpa = linha.trim();
      if (!limpa) continue;
      const chave = limpa.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!vistas.has(chave)) {
        vistas.add(chave);
        linhas.push(limpa);
      }
    }
  }
  return linhas.join('\n') || null;
}

function unirTelefones(destino, origem) {
  const valores = [
    destino.telefone, destino.telefone_principal,
    origem.telefone, origem.telefone_principal
  ].map(texto).filter(Boolean);
  const encontrados = telefones(valores.join(' / '));
  const extras = [];
  const vistos = new Set();
  for (const valor of valores) {
    for (const parte of valor.split(/[\/;\n|]+/)) {
      const campo = parte.trim();
      if (!campo || telefones(campo).length) continue;
      const chave = campo.toLocaleLowerCase('pt-BR');
      if (!vistos.has(chave)) {
        vistos.add(chave);
        extras.push(campo);
      }
    }
  }
  return [...encontrados.map(n => '55' + n), ...extras].join(' / ') || null;
}

function telefonePrincipal(valor) {
  const bruto = texto(valor);
  const encontrados = telefones(bruto);
  return encontrados.length ? '55' + encontrados[0] : (bruto || null);
}

function validarEscolhas(escolhas) {
  const opcoes = escolhas || {};
  const campos = ['nome_de', 'cidade_de', 'principal_de'];
  for (const campo of campos) {
    if (!['destino', 'origem'].includes(opcoes[campo])) {
      const erro = new Error('Escolha a origem de cada campo antes de mesclar.');
      erro.statusCode = 400;
      throw erro;
    }
  }
  return {
    nome_de: opcoes.nome_de,
    cidade_de: opcoes.cidade_de,
    principal_de: opcoes.principal_de
  };
}

function montarMesclagem(destino, origem, escolhas) {
  const opcoes = validarEscolhas(escolhas);
  const escolher = campo => opcoes[campo] === 'origem' ? origem : destino;
  const contatoDestino = texto(destino.contato_principal);
  const contatoOrigem = texto(origem.contato_principal);
  const contatoPrincipal = contatoDestino || contatoOrigem || null;
  const contatoAdicional = contatoDestino && contatoOrigem &&
    contatoDestino.toLocaleLowerCase('pt-BR') !== contatoOrigem.toLocaleLowerCase('pt-BR')
    ? 'Outro contato principal (cadastro mesclado): ' + contatoOrigem : null;

  const principalPreferido = texto(escolher('principal_de').telefone_principal);
  const principalAlternativo = texto((opcoes.principal_de === 'origem' ? destino : origem).telefone_principal);
  const telefoneUnido = unirTelefones(destino, origem);
  return {
    nome: texto(escolher('nome_de').nome),
    cidade_id: escolher('cidade_de').cidade_id || null,
    telefone: telefoneUnido,
    telefone_principal: telefonePrincipal(principalPreferido || principalAlternativo || telefoneUnido),
    observacao: unirObservacoes(destino.observacao, origem.observacao, contatoAdicional),
    contato_principal: contatoPrincipal
  };
}

function unirCidades(registros, destinoId, origemId) {
  const porCidade = new Map();
  for (const id of [destinoId, origemId]) {
    for (const registro of registros.filter(r => Number(r.transportadora_id) === Number(id))) {
      const key = String(registro.cidade_id);
      const anterior = porCidade.get(key);
      if (!anterior) {
        porCidade.set(key, {
          cidade_id: registro.cidade_id,
          nome: registro.nome || '',
          estado: registro.estado || '',
          observacao: texto(registro.observacao) || null
        });
      } else {
        anterior.observacao = unirObservacoes(anterior.observacao, registro.observacao);
      }
    }
  }
  return [...porCidade.values()];
}

module.exports = { unirObservacoes, unirTelefones, telefonePrincipal, validarEscolhas, montarMesclagem, unirCidades };
