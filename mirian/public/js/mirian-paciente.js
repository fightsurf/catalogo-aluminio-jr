document.addEventListener('DOMContentLoaded', () => {
  const formulario = document.querySelector('#mirian-form-paciente');
  const sintomasContainer = document.querySelector('#mirian-sintomas');
  const mensagem = document.querySelector('#mirian-mensagem');
  const botao = formulario.querySelector('button[type="submit"]');
  const dataNascimento = document.querySelector('#mirian-data-nascimento');

  dataNascimento.max = new Date().toISOString().slice(0, 10);

  async function carregarSintomas() {
    sintomasContainer.innerHTML = '<div class="mirian-meta">Carregando sintomas...</div>';

    try {
      const sintomas = await Mirian.requisicao('/sintomas');
      sintomasContainer.innerHTML = '';

      if (!sintomas.length) {
        sintomasContainer.appendChild(
          Mirian.criarElemento(
            'div',
            'mirian-vazio',
            'Nenhum sintoma está disponível no momento.'
          )
        );
        return;
      }

      sintomas.forEach((sintoma) => {
        const label = Mirian.criarElemento('label', 'mirian-check-card');
        const input = document.createElement('input');
        const texto = Mirian.criarElemento('span', '', sintoma.nome);

        input.type = 'checkbox';
        input.name = 'sintomas';
        input.value = sintoma.id;

        label.append(input, texto);
        sintomasContainer.appendChild(label);
      });
    } catch (error) {
      sintomasContainer.innerHTML = '';
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    }
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    Mirian.limparMensagem(mensagem);
    botao.disabled = true;
    botao.textContent = 'Enviando...';

    const sintomas = Array.from(
      formulario.querySelectorAll('input[name="sintomas"]:checked')
    ).map((input) => Number(input.value));

    const dados = {
      nome: formulario.nome.value,
      telefone: formulario.telefone.value,
      cidade: formulario.cidade.value,
      data_nascimento: formulario.data_nascimento.value,
      sintomas,
    };

    try {
      const resposta = await Mirian.requisicao('/pacientes', {
        method: 'POST',
        body: JSON.stringify(dados),
      });

      formulario.reset();
      Mirian.mostrarMensagem(mensagem, resposta.mensagem, 'sucesso');
    } catch (error) {
      Mirian.mostrarMensagem(mensagem, error.message, 'erro');
    } finally {
      botao.disabled = false;
      botao.textContent = 'Enviar Cadastro';
    }
  });

  carregarSintomas();
});
