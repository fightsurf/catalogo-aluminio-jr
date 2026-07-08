const API_URL = '/api/prestacoes/painel-saldos';

const grade = document.getElementById('grade-saldos');
const estadoVazio = document.getElementById('estado-vazio');
const mensagem = document.getElementById('mensagem');
const resumoPainel = document.getElementById('resumo-painel');
const btnAtualizar = document.getElementById('btn-atualizar');

function escaparHtml(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatarData(valor) {
  if (!valor) return '—';
  const texto = String(valor).substring(0, 10);
  const partes = texto.split('-');
  if (partes.length !== 3) return texto;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function formatarDataCurta(valor) {
  const data = formatarData(valor);
  if (data === '—') return data;
  return data.substring(0, 5);
}

function tipoMovimento(tipo) {
  const normalizado = String(tipo || '').toUpperCase();
  if (normalizado === 'MATERIAL') {
    return { classe: 'material', rotulo: 'Material', sinal: '+' };
  }
  if (normalizado === 'CREDITO') {
    return { classe: 'credito', rotulo: 'Crédito', sinal: '−' };
  }
  return { classe: 'pagamento', rotulo: 'Pagamento', sinal: '−' };
}

function montarLinhaMovimento(movimento) {
  const tipo = tipoMovimento(movimento.tipo);
  return `
    <tr class="linha-movimento">
      <td>
        <div class="movimento movimento-${tipo.classe}">
          <span class="movimento-data">${escaparHtml(formatarDataCurta(movimento.movimentada_em))}</span>
          <span class="movimento-texto">
            <span class="movimento-tipo">${escaparHtml(tipo.rotulo)}</span>
            ${escaparHtml(movimento.descricao || tipo.rotulo)}
          </span>
          <strong class="movimento-valor">${tipo.sinal} ${escaparHtml(formatarMoeda(movimento.valor))}</strong>
        </div>
      </td>
    </tr>
  `;
}

function montarCard(prestacao) {
  const movimentos = Array.isArray(prestacao.movimentacoes) ? prestacao.movimentacoes : [];
  const linhasMovimentos = movimentos.length
    ? movimentos.map(montarLinhaMovimento).join('')
    : '<tr><td class="sem-movimentos">Nenhuma movimentação registrada.</td></tr>';

  const saldo = Number(prestacao.saldo_restante || 0);
  const saldoClasse = saldo < 0 ? ' saldo-credor' : '';
  const saldoRotulo = saldo < 0 ? 'Crédito com fornecedor' : 'Saldo devedor';

  return `
    <article class="conta-card">
      <table class="conta-planilha">
        <tbody>
          <tr class="linha-fornecedor">
            <td>
              <span class="rotulo">Fornecedor</span>
              <strong class="fornecedor-nome">${escaparHtml(prestacao.fornecedor_nome || 'Fornecedor não informado')}</strong>
            </td>
          </tr>
          <tr>
            <td>
              <span class="rotulo">Descrição da conta</span>
              <strong class="conta-descricao">${escaparHtml(prestacao.titulo || `Prestação #${prestacao.id}`)}</strong>
              <span class="conta-referencia">Referência: ${escaparHtml(formatarData(prestacao.data_referencia))}</span>
              <a class="link-abrir" href="/prestacao-contas?prestacao=${encodeURIComponent(prestacao.id)}">Abrir prestação completa</a>
            </td>
          </tr>
          <tr class="linha-titulo-movimentos">
            <td>5 últimas movimentações</td>
          </tr>
          ${linhasMovimentos}
          <tr class="linha-saldo">
            <td>
              <div class="saldo-conteudo">
                <span class="saldo-rotulo">${escaparHtml(saldoRotulo)}</span>
                <strong class="saldo-valor${saldoClasse}">${escaparHtml(formatarMoeda(Math.abs(saldo)))}</strong>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  `;
}

function mostrarErro(texto) {
  mensagem.textContent = texto;
  mensagem.hidden = false;
}

function limparErro() {
  mensagem.textContent = '';
  mensagem.hidden = true;
}

async function carregarPainel() {
  limparErro();
  btnAtualizar.disabled = true;
  btnAtualizar.textContent = 'Atualizando...';
  resumoPainel.textContent = 'Carregando prestações abertas...';

  try {
    const resposta = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    const json = await resposta.json();

    if (!resposta.ok || !json.success) {
      throw new Error(json.message || 'Não foi possível carregar o painel.');
    }

    const prestacoes = Array.isArray(json.data) ? json.data : [];
    grade.innerHTML = prestacoes.map(montarCard).join('');
    grade.hidden = prestacoes.length === 0;
    estadoVazio.hidden = prestacoes.length !== 0;

    const quantidade = prestacoes.length;
    resumoPainel.textContent = quantidade === 1
      ? '1 prestação aberta.'
      : `${quantidade} prestações abertas.`;
  } catch (erro) {
    console.error('Erro ao carregar painel de saldos:', erro);
    grade.innerHTML = '';
    grade.hidden = true;
    estadoVazio.hidden = true;
    resumoPainel.textContent = 'Falha ao carregar os saldos.';
    mostrarErro(`Erro ao carregar os saldos: ${erro.message}`);
  } finally {
    btnAtualizar.disabled = false;
    btnAtualizar.textContent = 'Atualizar';
  }
}

btnAtualizar.addEventListener('click', carregarPainel);
carregarPainel();
