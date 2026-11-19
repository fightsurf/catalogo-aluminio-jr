'use strict';

// Exige limites entre dígitos para nunca truncar um telefone malformatado.
const PADRAO_TELEFONE = /(?<!\d)(?:\+?55[\s().-]*)?\(?\d{2}\)?[\s().-]*(?:9[\s().-]*)?\d{4}[\s().-]*\d{4}(?!\d)/g;

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

function extrairTelefonesComComplementos(valor) {
  const numeros = [];
  const complementos = [];
  for (const trecho of texto(valor).split(/[\/;\n|]+/)) {
    const campo = trecho.trim();
    if (!campo) continue;
    for (const match of campo.matchAll(PADRAO_TELEFONE)) {
      let digitos = match[0].replace(/\D/g, '');
      if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
        digitos = digitos.slice(2);
      }
      if (digitos.length === 10 || (digitos.length === 11 && digitos[2] === '9')) {
        numeros.push('55' + digitos);
      }
    }
    // Todo texto não reconhecido é preservado, inclusive números malformatados.
    const complemento = campo.replace(PADRAO_TELEFONE, '').replace(/\s+/g, ' ').trim();
    if (complemento) complementos.push(complemento);
  }
  return { numeros, complementos };
}

function unirTelefones(destino, origem) {
  const valores = [
    destino.telefone, destino.telefone_principal,
    origem.telefone, origem.telefone_principal
  ].map(texto).filter(Boolean);
  const numeros = [];
  const extras = [];
  const vistosNumeros = new Set();
  const vistosExtras = new Set();
  for (const valor of valores) {
    const partes = extrairTelefonesComComplementos(valor);
    for (const numero of partes.numeros) {
      if (!vistosNumeros.has(numero)) { vistosNumeros.add(numero); numeros.push(numero); }
    }
    for (const extra of partes.complementos) {
      const chave = extra.toLocaleLowerCase('pt-BR');
      if (!vistosExtras.has(chave)) { vistosExtras.add(chave); extras.push(extra); }
    }
  }
  return [...numeros, ...extras].join(' / ') || null;
}

function telefonePrincipal(valor) {
  const bruto = texto(valor);
  const encontrados = extrairTelefonesComComplementos(bruto).numeros;
  return encontrados.length ? encontrados[0] : (bruto || null);
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

  const cadastroPreferido = escolher('principal_de');
  const principalPreferido = texto(cadastroPreferido.telefone_principal || cadastroPreferido.telefone);
  const cadastroAlternativo = opcoes.principal_de === 'origem' ? destino : origem;
  const principalAlternativo = texto(cadastroAlternativo.telefone_principal || cadastroAlternativo.telefone);
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
