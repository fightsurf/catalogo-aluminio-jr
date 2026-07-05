document.addEventListener('DOMContentLoaded', () => {
  const formulario = document.querySelector('#mirian-form-filtros');
  const lista = document.querySelector('#mirian-lista-pacientes');
  const mensagem = document.querySelector('#mirian-mensagem');
  const seletorSintoma = document.querySelector('#mirian-filtro-sintoma');
  const resumo = document.querySelector('#mirian-resumo');
  const atualizado = document.querySelector('#mirian-atualizado');
  const botaoLimpar = document.querySelector('#mirian-limpar-filtros');

  const modalWhatsapp = document.querySelector('#mirian-modal-whatsapp');
  const formularioWhatsapp = document.querySelector('#mirian-form-whatsapp');
  const destinatarioWhatsapp = document.querySelector(
    '#mirian-modal-whatsapp-destinatario'
  );
  const campoMensagemWhatsapp = document.querySelector(
    '#mirian-whatsapp-mensagem'
  );
  const mensagemModalWhatsapp = document.querySelector(
    '#mirian-modal-whatsapp-mensagem'
  );
  const botaoFecharWhatsapp = document.querySelector(
    '#mirian-fechar-modal-whatsapp'
  );
  const botaoCancelarWhatsapp = document.querySelector(
    '#mirian-cancelar-whatsapp'
  );
  const botaoEnviarWhatsapp = document.querySelector(
    '#mirian-enviar-whatsapp'
  );

  let carregando = false;
  let enviandoWhatsapp = false;
  let pacienteWhatsapp = null;

  function abrirModalWhatsapp(paciente) {
    pacienteWhatsapp = paciente;
    formularioWhatsapp.reset();
    Mirian.limparMensagem(mensagemModalWhatsapp);
    destinatarioWhatsapp.textContent = `${paciente.nome} • ${
      paciente.telefone || 'Telefone não informado'
    }`;
    modalWhatsapp.hidden = false;
    document.body.classList.add('mirian-modal-aberto');

    window.setTimeout(() => campoMensagemWhatsapp.focus(), 0);
  }

  function fecharModalWhatsapp() {
    if (enviandoWhatsapp) return;

    modalWhatsapp.hidden = true;
    document.body.classList.remove('mirian-modal-aberto');
    pacienteWhatsapp = null;
    formularioWhatsapp.reset();
    Mirian.limparMensagem(mensagemModalWhatsapp);
  }

  function montarCard(paciente) {
    const card = Mirian.criarElemento('article', 'mirian-card');
    const cabecalho = Mirian.criarElemento('div', 'mirian-paciente-cabecalho');
    const identificacao = Mirian.criarElemento(
      'div',
      'mirian-paciente-identificacao'
    );
    const nome = Mirian.criarElemento('h2', '', paciente.nome);
    const botaoAvisar = Mirian.criarElemento(
      'button',
      'mirian-botao-whatsapp',
      'Avisar'
    );
    botaoAvisar.type = 'button';
    botaoAvisar.setAttribute(
      'aria-label',
      `Enviar mensagem pelo WhatsApp para ${paciente.nome}`
    );
    botaoAvisar.addEventListener('click', () => abrirModalWhatsapp(paciente));

    const status = Mirian.criarElemento(
      'span',
      `mirian-status ${
        paciente.visitado ? 'mirian-status-visitado' : 'mirian-status-pendente'
      }`,
      paciente.visitado ? '🟢 Visitado' : '🟡 Pendente'
    );

    identificacao.append(nome, botaoAvisar);
    cabecalho.append(identificacao, status);

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

      if (modalWhatsapp.hidden) {
        Mirian.limparMensagem(mensagem);
      }
    } catch (error) {
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    } finally {
      carregando = false;
    }
  }

  formularioWhatsapp.addEventListener('submit', async (evento) => {
    evento.preventDefault();

    if (!pacienteWhatsapp || enviandoWhatsapp) return;

    const texto = campoMensagemWhatsapp.value.trim();

    if (!texto) {
      Mirian.mostrarMensagem(
        mensagemModalWhatsapp,
        'Digite a mensagem que será enviada.',
        'erro'
      );
      campoMensagemWhatsapp.focus();
      return;
    }

    enviandoWhatsapp = true;
    botaoEnviarWhatsapp.disabled = true;
    botaoCancelarWhatsapp.disabled = true;
    botaoFecharWhatsapp.disabled = true;
    botaoEnviarWhatsapp.textContent = 'Enviando...';
    Mirian.limparMensagem(mensagemModalWhatsapp);

    try {
      const resposta = await Mirian.requisicao(
        `/pacientes/${pacienteWhatsapp.id}/whatsapp`,
        {
          method: 'POST',
          body: JSON.stringify({ mensagem: texto }),
        }
      );

      const nomePaciente = pacienteWhatsapp.nome;
      fecharModalWhatsappForcado();
      Mirian.mostrarMensagem(
        mensagem,
        resposta.mensagem || `Mensagem enviada para ${nomePaciente}.`,
        'sucesso'
      );
    } catch (error) {
      Mirian.mostrarMensagem(mensagemModalWhatsapp, error.message, 'erro');
    } finally {
      enviandoWhatsapp = false;
      botaoEnviarWhatsapp.disabled = false;
      botaoCancelarWhatsapp.disabled = false;
      botaoFecharWhatsapp.disabled = false;
      botaoEnviarWhatsapp.textContent = 'Enviar mensagem';
    }
  });

  function fecharModalWhatsappForcado() {
    modalWhatsapp.hidden = true;
    document.body.classList.remove('mirian-modal-aberto');
    pacienteWhatsapp = null;
    formularioWhatsapp.reset();
    Mirian.limparMensagem(mensagemModalWhatsapp);
  }

  formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    carregarPacientes();
  });

  botaoLimpar.addEventListener('click', () => {
    formulario.reset();
    carregarPacientes();
  });

  botaoFecharWhatsapp.addEventListener('click', fecharModalWhatsapp);
  botaoCancelarWhatsapp.addEventListener('click', fecharModalWhatsapp);

  modalWhatsapp.addEventListener('click', (evento) => {
    if (evento.target === modalWhatsapp) {
      fecharModalWhatsapp();
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !modalWhatsapp.hidden) {
      fecharModalWhatsapp();
    }
  });

  carregarSintomas().then(carregarPacientes);
  window.setInterval(carregarPacientes, 10000);
});
