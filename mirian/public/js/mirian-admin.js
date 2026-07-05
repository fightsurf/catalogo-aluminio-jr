document.addEventListener('DOMContentLoaded', () => {
  const formulario = document.querySelector('#mirian-form-sintoma');
  const lista = document.querySelector('#mirian-lista-sintomas');
  const mensagem = document.querySelector('#mirian-mensagem');
  const botaoAdicionar = formulario.querySelector('button[type="submit"]');

  function montarCard(sintoma) {
    const card = Mirian.criarElemento(
      'article',
      `mirian-card ${sintoma.ativo ? '' : 'mirian-sintoma-inativo'}`
    );

    const linha = Mirian.criarElemento('div', 'mirian-sintoma-linha');
    const cabecalho = Mirian.criarElemento('div', 'mirian-sintoma-cabecalho');
    const nome = Mirian.criarElemento('div', 'mirian-sintoma-nome', sintoma.nome);
    const estado = Mirian.criarElemento(
      'span',
      `mirian-estado ${sintoma.ativo ? '' : 'mirian-estado-inativo'}`,
      sintoma.ativo ? 'Ativo' : 'Inativo'
    );

    cabecalho.append(nome, estado);

    const input = document.createElement('input');
    input.className = 'mirian-edicao-input mirian-escondido';
    input.value = sintoma.nome;
    input.maxLength = 120;
    input.setAttribute('aria-label', `Editar o sintoma ${sintoma.nome}`);

    const acoes = Mirian.criarElemento('div', 'mirian-acoes');
    const editar = Mirian.criarElemento('button', 'mirian-botao-secundario', 'Editar');
    const alternar = Mirian.criarElemento(
      'button',
      'mirian-botao-secundario',
      sintoma.ativo ? 'Desativar' : 'Ativar'
    );
    const excluir = Mirian.criarElemento('button', 'mirian-botao-perigo', 'Excluir');

    editar.type = 'button';
    alternar.type = 'button';
    excluir.type = 'button';

    editar.addEventListener('click', async () => {
      if (input.classList.contains('mirian-escondido')) {
        input.classList.remove('mirian-escondido');
        nome.classList.add('mirian-escondido');
        editar.textContent = 'Salvar';
        input.focus();
        input.select();
        return;
      }

      editar.disabled = true;

      try {
        await Mirian.requisicao(`/sintomas/${sintoma.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ nome: input.value }),
        });
        await carregarSintomas();
        Mirian.mostrarMensagem(mensagem, 'Sintoma atualizado.', 'sucesso');
      } catch (error) {
        Mirian.mostrarMensagem(mensagem, error.message, 'erro');
      } finally {
        editar.disabled = false;
      }
    });

    alternar.addEventListener('click', async () => {
      alternar.disabled = true;

      try {
        await Mirian.requisicao(`/sintomas/${sintoma.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ativo: !sintoma.ativo }),
        });
        await carregarSintomas();
        Mirian.mostrarMensagem(
          mensagem,
          sintoma.ativo ? 'Sintoma desativado.' : 'Sintoma ativado.',
          'sucesso'
        );
      } catch (error) {
        Mirian.mostrarMensagem(mensagem, error.message, 'erro');
      } finally {
        alternar.disabled = false;
      }
    });

    excluir.addEventListener('click', async () => {
      const confirmado = window.confirm(
        `Excluir o sintoma "${sintoma.nome}"? Ele também será removido dos cadastros relacionados.`
      );

      if (!confirmado) return;
      excluir.disabled = true;

      try {
        await Mirian.requisicao(`/sintomas/${sintoma.id}`, {
          method: 'DELETE',
        });
        await carregarSintomas();
        Mirian.mostrarMensagem(mensagem, 'Sintoma excluído.', 'sucesso');
      } catch (error) {
        Mirian.mostrarMensagem(mensagem, error.message, 'erro');
      } finally {
        excluir.disabled = false;
      }
    });

    acoes.append(editar, alternar, excluir);
    linha.append(cabecalho, input, acoes);
    card.appendChild(linha);
    return card;
  }

  async function carregarSintomas() {
    lista.innerHTML = '<div class="mirian-card mirian-vazio">Carregando...</div>';

    try {
      const sintomas = await Mirian.requisicao('/sintomas?incluirInativos=1');
      lista.innerHTML = '';

      if (!sintomas.length) {
        lista.appendChild(
          Mirian.criarElemento(
            'div',
            'mirian-card mirian-vazio',
            'Nenhum sintoma cadastrado.'
          )
        );
        return;
      }

      sintomas.forEach((sintoma) => lista.appendChild(montarCard(sintoma)));
    } catch (error) {
      lista.innerHTML = '';
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    }
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    botaoAdicionar.disabled = true;

    try {
      await Mirian.requisicao('/sintomas', {
        method: 'POST',
        body: JSON.stringify({ nome: formulario.nome.value }),
      });

      formulario.reset();
      await carregarSintomas();
      Mirian.mostrarMensagem(mensagem, 'Sintoma adicionado.', 'sucesso');
    } catch (error) {
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    } finally {
      botaoAdicionar.disabled = false;
    }
  });

  carregarSintomas();
});
