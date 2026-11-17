'use strict';

// Importacao exclusivamente de planilhas fornecidas de modo autorizado.
// Nao consulta nem extrai conteudo do site de terceiros.
function limpar(valor, max = 500) {
  return String(valor == null ? '' : valor).trim().slice(0, max);
}
function chave(valor) {
  return limpar(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function telefones(valor) {
  const texto = limpar(valor, 600);
  const encontrados = texto.match(/(?:\+?55[\s-]*)?\(?\d{2}\)?[\s-]*9?\d{4}[\s-]*\d{4}/g) || [];
  return [...new Set(encontrados.map(t => {
    let n = t.replace(/\D/g, '');
    if (n.length > 11 && n.startsWith('55')) n = n.slice(2);
    return n;
  }).filter(n => n.length === 10 || n.length === 11))];
}
const UFS_POR_ESTADO = {
  acre:'AC', alagoas:'AL', amapa:'AP', amazonas:'AM', bahia:'BA', ceara:'CE',
  'distrito federal':'DF', 'espirito santo':'ES', goias:'GO', maranhao:'MA',
  'mato grosso':'MT', 'mato grosso do sul':'MS', 'minas gerais':'MG', para:'PA',
  paraiba:'PB', parana:'PR', pernambuco:'PE', piaui:'PI', 'rio de janeiro':'RJ',
  'rio grande do norte':'RN', 'rio grande do sul':'RS', rondonia:'RO',
  roraima:'RR', 'santa catarina':'SC', 'sao paulo':'SP', sergipe:'SE',
  tocantins:'TO'
};
function localidade(valor, ufAlternativa) {
  const raw = limpar(valor, 160).replace(/\.$/, '').trim();
  let nome = raw;
  let uf = limpar(ufAlternativa, 2).toUpperCase();
  const sigla = raw.match(/^(.*?)\s*(?:[-–,]\s*|\s+)([A-Z]{2})$/i);
  if (sigla) { nome = sigla[1].trim(); uf = sigla[2].toUpperCase(); }
  else {
    const semAcentos = chave(raw);
    for (const [estado, siglaEstado] of Object.entries(UFS_POR_ESTADO)) {
      if (semAcentos.endsWith(' ' + estado)) {
        nome = raw.slice(0, raw.length - estado.length).replace(/[\s,–-]+$/, '').trim();
        uf = siglaEstado;
        break;
      }
    }
  }
  nome = limpar(nome, 120);
  return nome && /^[A-Z]{2}$/.test(uf) ? { nome, uf } : null;
}

function normalizarLinha(dados) {
  const nome = limpar(dados.nome || dados.transportadora || dados.excursao, 150);
  const origem = limpar(dados.origem, 160);
  const rota = limpar(dados.rota || dados.cidades || dados.cidades_atendidas, 7000);
  const ufs = limpar(dados.uf || dados.estado, 2);
  const orig = localidade(origem, ufs);
  const cidades = [];
  const semUf = [];
  const achadas = new Set();
  const adicionar = cidade => {
    const key = chave(cidade.nome) + '|' + cidade.uf;
    if (!achadas.has(key)) { cidades.push(cidade); achadas.add(key); }
  };
  // A origem tambem e uma cidade atendida, alem de todas as paradas da rota.
  if (orig) adicionar(orig);
  else if (origem) semUf.push(origem);
  for (const trecho of rota.split(/[\/|\n;]+/)) {
    if (!trecho.trim()) continue;
    const cidade = localidade(trecho);
    if (cidade) adicionar(cidade);
    else semUf.push(limpar(trecho, 140));
  }
  return {
    nome, origem, origemLocalidade: orig, destino: limpar(dados.destino, 300),
    tipo: limpar(dados.tipo || dados.categoria, 70),
    telefones: telefones([dados.telefones, dados.telefone, dados.telefone1, dados.telefone2, dados.whatsapp].filter(Boolean).join(' / ')),
    cidades, semUf: [...new Set(semUf)]
  };
}
function montarCamposTransportadora(registro) {
  const numeros = telefones((registro.telefones || []).join(' / '));
  const internacionais = numeros.map(numero => '55' + numero);
  return {
    nome: registro.nome,
    telefone: internacionais.join(' / ') || null,
    telefone_principal: internacionais[0] || null,
    observacao: registro.destino || null
  };
}
function combinarTelefones(existente, novos) {
  const original = String(existente.telefone || '').trim();
  const jaExistentes = new Set(telefones([original, existente.telefone_principal].filter(Boolean).join(' / ')));
  const adicionados = [];
  for (const numero of telefones((novos || []).join(' / '))) {
    if (!jaExistentes.has(numero)) {
      adicionados.push('55' + numero);
      jaExistentes.add(numero);
    }
  }
  const principalAtual = String(existente.telefone_principal || '').trim();
  return {
    telefone: [original, ...adicionados].filter(Boolean).join(' / ') || null,
    telefone_principal: principalAtual || (telefones(original)[0] ? '55' + telefones(original)[0] : adicionados[0] || null),
    adicionados: adicionados.length
  };
}

function combinarObservacao(atual, destino) {
  const observacao = String(atual || '').trim();
  const nova = String(destino || '').trim();
  if (!nova || (observacao && chave(observacao).includes(chave(nova)))) return observacao || null;
  return [observacao, nova].filter(Boolean).join('\n') || null;
}
// Apenas correspondencia unica por nome exato ou telefone permite fusao automatica.
function escolherTransportadora(registro, existentes) {
  const nome = chave(registro.nome);
  const comTelefone = t => {
    const numeros = telefones([t.telefone, t.telefone_principal].filter(Boolean).join(' / '));
    return (registro.telefones || []).some(n => numeros.includes(n));
  };
  const porNome = existentes.filter(t => chave(t.nome) === nome);
  if (porNome.length === 1) return porNome[0];
  if (porNome.length > 1) {
    const porNomeTelefone = porNome.filter(comTelefone);
    return porNomeTelefone.length === 1 ? porNomeTelefone[0] : null;
  }
  const porTelefone = existentes.filter(comTelefone);
  return porTelefone.length === 1 ? porTelefone[0] : null;
}

function candidatosPara(registro, existentes) {
  const nome = chave(registro.nome);
  const hits = [];
  for (const t of existentes) {
    const outro = chave(t.nome);
    const contatos = telefones([t.telefone, t.telefone_principal].filter(Boolean).join(' / '));
    const coincideTel = registro.telefones.some(n => contatos.includes(n));
    const exato = nome === outro;
    const semelhante = nome.length >= 6 && outro.length >= 6 &&
      (nome.startsWith(outro) || outro.startsWith(nome) ||
       (nome.split(' ')[0].length >= 5 && nome.split(' ')[0] === outro.split(' ')[0]));
    if (exato || coincideTel || semelhante) {
      hits.push({ id: t.id, nome: t.nome, origem: t.cidade_nome ?
        t.cidade_nome + ' - ' + (t.cidade_estado || '') : '',
        telefone: t.telefone_principal || t.telefone || '',
        tipo: exato ? 'nome' : coincideTel ? 'telefone' : 'semelhante',
        prioridade: exato ? 0 : coincideTel ? 1 : 2,
        divergenciaTelefone: exato && registro.telefones.length > 0 &&
          !registro.telefones.some(n => contatos.includes(n))
      });
    }
  }
  hits.sort((a, b) => a.prioridade - b.prioridade || Number(a.id) - Number(b.id));
  return hits.slice(0, 8);
}
function classificar(registro, existentes) {
  if (!registro.nome || registro.nome.length < 2) return { situacao: 'invalido', candidatos: [] };
  const candidatos = candidatosPara(registro, existentes);
  const exatos = candidatos.filter(c => c.tipo === 'nome');
  if (exatos.length === 1 && candidatos.length === 1 && !exatos[0].divergenciaTelefone) {
    return { situacao: 'existente', candidatos };
  }
  return { situacao: candidatos.length ? 'revisar' : 'novo', candidatos };
}
module.exports = { limpar, chave, telefones, localidade, normalizarLinha, montarCamposTransportadora, combinarTelefones, combinarObservacao, escolherTransportadora, candidatosPara, classificar };
