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
function localidade(valor, ufAlternativa) {
  const raw = limpar(valor, 160).replace(/\.$/, '');
  const m = raw.match(/^(.*?)\s*[-–]\s*([A-Z]{2})$/i);
  const nome = limpar(m ? m[1] : raw, 120);
  const uf = limpar(m ? m[2] : ufAlternativa, 2).toUpperCase();
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
  for (const trecho of rota.split(/[\/|\n;]+/)) {
    if (!trecho.trim()) continue;
    const cidade = localidade(trecho);
    if (!cidade) { semUf.push(limpar(trecho, 140)); continue; }
    const key = chave(cidade.nome) + '|' + cidade.uf;
    if (!achadas.has(key)) { cidades.push(cidade); achadas.add(key); }
  }
  if (orig && !achadas.has(chave(orig.nome) + '|' + orig.uf)) cidades.push(orig);
  return {
    nome, origem, origemLocalidade: orig, destino: limpar(dados.destino, 300),
    tipo: limpar(dados.tipo || dados.categoria, 70),
    telefones: telefones([dados.telefones, dados.telefone, dados.telefone1, dados.telefone2, dados.whatsapp].filter(Boolean).join(' / ')),
    cidades, semUf
  };
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
module.exports = { limpar, chave, telefones, localidade, normalizarLinha, candidatosPara, classificar };
