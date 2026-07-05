document.addEventListener('DOMContentLoaded', () => {
  const formulario = document.querySelector('#mirian-form-filtros');
  const lista = document.querySelector('#mirian-lista-pacientes');
  const mensagem = document.querySelector('#mirian-mensagem');
  const seletorSintoma = document.querySelector('#mirian-filtro-sintoma');
  const resumo = document.querySelector('#mirian-resumo');
  const atualizado = document.querySelector('#mirian-atualizado');
  const botaoLimpar = document.querySelector('#mirian-limpar-filtros');

  let carregando = false;

  function montarCard(paciente) {
    const card = Mirian.criarElemento('article', 'mirian-card');
    const cabecalho = Mirian.criarElemento('div', 'mirian-paciente-cabecalho');
    const nome = Mirian.criarElemento('h2', '', paciente.nome);
    const status = Mirian.criarElemento(
      'span',
      `mirian-status ${
        paciente.visitado ? 'mirian-status-visitado' : 'mirian-status-pendente'
      }`,
      paciente.visitado ? '🟢 Visitado' : '🟡 Pendente'
    );

    cabecalho.append(nome, status);

    const dados = Mirian.criarElemento('div', 'mirian-dados');
    [
      ['Telefone', paciente.telefone],
      ['Cidade', paciente.cidade],
      ['Nascimento', Mirian.formatarData(paciente.data_nascimento)],
    ].forEach(([rotulo, valor]) => {
      const linha = document.createElement('div');
      const forte = Mirian.criarElemento('strong', '', `${rotulo}: `);
      linha.append(forte, document.createTextNode(valor || 'Não informado'));
      dados.appendChild(linha);
    });

    const tags = Mirian.criarElemento('div', 'mirian-tags');

    if (paciente.sintomas && paciente.sintomas.length) {
      paciente.sintomas.forEach((sintoma) => {
        tags.appendChild(Mirian.criarElemento('span', 'mirian-tag', sintoma.nome));
      });
    } else {
      tags.appendChild(
        Mirian.criarElemento('span', 'mirian-meta', 'Nenhum sintoma selecionado.')
      );
    }

    const visita = Mirian.criarElemento('label', 'mirian-visita');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'mirian-checkbox-grande';
    checkbox.checked = Boolean(paciente.visitado);
    checkbox.setAttribute('aria-label', `Marcar ${paciente.nome} como visitado`);
    visita.append(checkbox, document.createTextNode('Paciente visitado'));

    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;

      try {
        await Mirian.requisicao(`/pacientes/${paciente.id}/visitado`, {
          method: 'PATCH',
          body: JSON.stringify({ visitado: checkbox.checked }),
        });

        paciente.visitado = checkbox.checked;
        status.className = `mirian-status ${
          paciente.visitado ? 'mirian-status-visitado' : 'mirian-status-pendente'
        }`;
        status.textContent = paciente.visitado ? '🟢 Visitado' : '🟡 Pendente';
        await carregarPacientes();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        Mirian.mostrarMensagem(mensagem, error.message, 'erro');
      } finally {
        checkbox.disabled = false;
      }
    });

    card.append(cabecalho, dados, tags, visita);
    return card;
  }

  function atualizarResumo(pacientes) {
    const visitados = pacientes.filter((paciente) => paciente.visitado).length;
    const pendentes = pacientes.length - visitados;

    resumo.innerHTML = '';
    resumo.append(
      Mirian.criarElemento('span', 'mirian-chip', `${pacientes.length} paciente(s)`),
      Mirian.criarElemento('span', 'mirian-chip', `${pendentes} pendente(s)`),
      Mirian.criarElemento('span', 'mirian-chip', `${visitados} visitado(s)`)
    );
  }

  async function carregarSintomas() {
    try {
      const sintomas = await Mirian.requisicao('/sintomas?incluirInativos=1');

      sintomas.forEach((sintoma) => {
        const opcao = document.createElement('option');
        opcao.value = sintoma.id;
        opcao.textContent = sintoma.ativo
          ? sintoma.nome
          : `${sintoma.nome} (inativo)`;
        seletorSintoma.appendChild(opcao);
      });
    } catch (error) {
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    }
  }

  async function carregarPacientes() {
    if (carregando) return;
    carregando = true;

    const parametros = new URLSearchParams();
    const dados = new FormData(formulario);

    for (const [chave, valor] of dados.entries()) {
      const texto = String(valor).trim();
      if (texto) parametros.set(chave, texto);
    }

    try {
      const pacientes = await Mirian.requisicao(
        `/pacientes${parametros.toString() ? `?${parametros}` : ''}`
      );

      lista.innerHTML = '';
      atualizarResumo(pacientes);

      if (!pacientes.length) {
        lista.appendChild(
          Mirian.criarElemento(
            'div',
            'mirian-card mirian-vazio',
            'Nenhum paciente encontrado.'
          )
        );
      } else {
        pacientes.forEach((paciente) => lista.appendChild(montarCard(paciente)));
      }

      atualizado.textContent = `Atualizado às ${new Date().toLocaleTimeString(
        'pt-BR',
        { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      )}`;
      Mirian.limparMensagem(mensagem);
    } catch (error) {
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    } finally {
      carregando = false;
    }
  }

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregarPacientes();
  });

  botaoLimpar.addEventListener('click', () => {
    formulario.reset();
    carregarPacientes();
  });

  carregarSintomas().then(carregarPacientes);
  window.setInterval(carregarPacientes, 10000);
});
