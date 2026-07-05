window.Mirian = (() => {
  const API = '/api/mirian';

  async function requisicao(caminho, opcoes = {}) {
    const resposta = await fetch(`${API}${caminho}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(opcoes.headers || {}),
      },
      ...opcoes,
    });

    let dados = null;

    try {
      dados = await resposta.json();
    } catch (error) {
      dados = null;
    }

    if (!resposta.ok) {
      throw new Error((dados && dados.erro) || 'Não foi possível concluir a operação.');
    }

    return dados;
  }

  function mostrarMensagem(elemento, texto, tipo = 'sucesso') {
    elemento.textContent = texto;
    elemento.className = `mirian-mensagem mirian-visivel mirian-mensagem-${tipo}`;
    elemento.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function limparMensagem(elemento) {
    elemento.textContent = '';
    elemento.className = 'mirian-mensagem';
  }

  function formatarData(dataIso) {
    if (!dataIso) return 'Não informada';
    const partes = String(dataIso).slice(0, 10).split('-');

    if (partes.length !== 3) return dataIso;
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }

  function criarElemento(tag, classe, texto) {
    const elemento = document.createElement(tag);
    if (classe) elemento.className = classe;
    if (texto != null) elemento.textContent = texto;
    return elemento;
  }

  return {
    API,
    requisicao,
    mostrarMensagem,
    limparMensagem,
    formatarData,
    criarElemento,
  };
})();
