(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CORES = ['#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#94a3b8'];

  function numero(valor) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  function formatarQuantidade(valor) {
    const n = numero(valor);
    if (Math.abs(n - Math.round(n)) < 0.0001) {
      return Math.round(n).toLocaleString('pt-BR');
    }
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  function formatarMoeda(valor) {
    const preco = Number(valor);
    return Number.isFinite(preco)
      ? preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : '-';
  }

  function formatarData(valor) {
    if (!valor) return 'Data não informada';
    const texto = String(valor);
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[1]}/${br[2]}/${br[3]}`;
    return 'Data não informada';
  }

  function codigoItem(item) {
    const valor = item?.item ?? item?.codigoItem ?? item?.itemCodigo ?? item?.codigo;
    const codigo = Number(valor);
    return Number.isSafeInteger(codigo) && codigo > 0 ? codigo : null;
  }

  function ehOutros(item) {
    return item?.outros === true || item?.agrupado === true
      || /^outros\b/i.test(String(item?.descricao || '').trim());
  }

  function formatarPercentual(valor) {
    return `${numero(valor).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
  }

  function criarElemento(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== undefined && texto !== null) el.textContent = String(texto);
    return el;
  }

  function pontoPolar(cx, cy, raio, angulo) {
    return {
      x: cx + raio * Math.cos(angulo),
      y: cy + raio * Math.sin(angulo)
    };
  }

  function caminhoFatia(cx, cy, raio, inicio, fim) {
    const a = pontoPolar(cx, cy, raio, inicio);
    const b = pontoPolar(cx, cy, raio, fim);
    const grande = fim - inicio > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${a.x} ${a.y} A ${raio} ${raio} 0 ${grande} 1 ${b.x} ${b.y} Z`;
  }

  function render(container, perfil, opcoes = {}) {
    if (!container) return;
    const favorecido = Number(opcoes?.favorecido);
    const consultarPrecos = Number.isSafeInteger(favorecido) && favorecido > 0;
    container.innerHTML = '';

    const grafico = Array.isArray(perfil?.grafico)
      ? perfil.grafico.filter((item) => numero(item?.quantidade) > 0)
      : [];

    if (!grafico.length) {
      container.appendChild(criarElemento('div', 'perfil-compras-vazio', 'Nenhuma compra válida encontrada para montar o perfil deste cliente.'));
      return;
    }

    const secao = criarElemento('div', 'perfil-compras-secao');
    const titulo = criarElemento('div', 'perfil-compras-titulo');
    const blocoTitulo = criarElemento('div');
    blocoTitulo.appendChild(criarElemento('strong', '', 'Perfil de compras do cliente'));
    blocoTitulo.appendChild(criarElemento('span', '', 'Distribuição pela quantidade total comprada. Top 5 produtos + demais itens agrupados em “Outros”.'));
    titulo.appendChild(blocoTitulo);
    secao.appendChild(titulo);

    const maisComprado = perfil?.itemMaisComprado || grafico[0];
    if (maisComprado) {
      const destaque = criarElemento('div', 'perfil-compras-destaque');
      destaque.appendChild(criarElemento('span', '', 'Produto mais comprado'));
      destaque.appendChild(criarElemento('strong', '', maisComprado.descricao || 'Produto'));
      const pedidosTexto = numero(maisComprado.pedidos) > 0
        ? ` em ${formatarQuantidade(maisComprado.pedidos)} pedido(s)`
        : '';
      destaque.appendChild(criarElemento(
        'small',
        '',
        `${formatarQuantidade(maisComprado.quantidade)} unidade(s)${pedidosTexto} • ${formatarPercentual(maisComprado.percentual)}`
      ));
      secao.appendChild(destaque);
    }

    const kpis = criarElemento('div', 'perfil-compras-kpis');
    [
      ['Pedidos válidos', formatarQuantidade(perfil?.totalPedidos)],
      ['Unidades compradas', formatarQuantidade(perfil?.totalUnidades)],
      ['Produtos diferentes', formatarQuantidade(perfil?.totalItensDistintos)]
    ].forEach(([rotulo, valor]) => {
      const card = criarElemento('div', 'perfil-compras-kpi');
      card.appendChild(criarElemento('span', '', rotulo));
      card.appendChild(criarElemento('strong', '', valor));
      kpis.appendChild(card);
    });
    secao.appendChild(kpis);

    const grid = criarElemento('div', 'perfil-compras-grid');
    const areaGrafico = criarElemento('div', 'perfil-compras-grafico-area');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 220 220');
    svg.setAttribute('class', 'perfil-compras-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Gráfico de pizza do perfil de compras do cliente');
    const detalhe = criarElemento('div', 'perfil-compras-detalhe');
    const legenda = criarElemento('div', 'perfil-compras-legenda');

    const total = grafico.reduce((soma, item) => soma + numero(item.quantidade), 0);
    let angulo = -Math.PI / 2;
    const fatias = [];
    const legendas = [];
    const paineis = [];

    async function carregarPrecos(item, conteudo, painel) {
      if (painel.dataset.carregado === 'true' || painel.dataset.carregando === 'true') return;
      painel.dataset.carregando = 'true';
      conteudo.replaceChildren(criarElemento('div', 'perfil-compras-precos-estado', 'Consultando o histórico de preços do cliente...'));
      try {
        const query = new URLSearchParams();
        const codigo = codigoItem(item);
        if (codigo !== null) query.set('item', String(codigo));
        query.set('descricao', String(item.descricao || ''));
        const response = await fetch(
          `/api/legado/pedidos-cliente/${encodeURIComponent(favorecido)}/precos-historicos?${query.toString()}`,
          { headers: { Accept: 'application/json' } }
        );
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json.sucesso === false) {
          throw new Error(json.detalhe || json.mensagem || 'Falha ao consultar preços históricos.');
        }
        const registros = Array.isArray(json?.dados?.precos) ? json.dados.precos : [];
        conteudo.replaceChildren();
        if (!registros.length) {
          conteudo.appendChild(criarElemento('div', 'perfil-compras-precos-estado', 'Nenhum preço encontrado no histórico de pedidos.'));
        } else {
          conteudo.appendChild(criarElemento('div', 'perfil-compras-precos-titulo', `Preços unitários praticados • ${registros.length} registro(s)`));
          const lista = criarElemento('div', 'perfil-compras-precos-lista');
          registros.forEach(registro => {
            const linha = criarElemento('div', 'perfil-compras-precos-linha');
            linha.appendChild(criarElemento('strong', '', formatarMoeda(registro.preco)));
            linha.appendChild(criarElemento('span', '', `${formatarData(registro.data)} • Pedido ${registro.pedidoNumero || '-'} • ${formatarQuantidade(registro.quantidade)} un.`));
            lista.appendChild(linha);
          });
          conteudo.appendChild(lista);
        }
        painel.dataset.carregado = 'true';
      } catch (error) {
        conteudo.replaceChildren(criarElemento('div', 'perfil-compras-precos-erro', error.message || 'Erro ao consultar os preços.'));
      } finally {
        delete painel.dataset.carregando;
      }
    }

    function atualizarDestaque(indice) {
      const item = grafico[indice];
      if (!item) return;

      fatias.forEach((fatia, idx) => {
        fatia.classList.toggle('perfil-fatia-ativa', idx === indice);
        fatia.classList.toggle('perfil-fatia-inativa', idx !== indice);
      });
      legendas.forEach((linha, idx) => linha.classList.toggle('ativo', idx === indice));

      detalhe.innerHTML = '';
      const nome = criarElemento('strong', '', item.descricao || 'Produto');
      detalhe.appendChild(nome);
      detalhe.appendChild(document.createTextNode(
        ` — ${formatarQuantidade(item.quantidade)} unidade(s) • ${formatarPercentual(item.percentual)}`
      ));
    }

    grafico.forEach((item, indice) => {
      const proporcao = total > 0 ? numero(item.quantidade) / total : 0;
      const proximo = indice === grafico.length - 1 ? (-Math.PI / 2) + (Math.PI * 2) : angulo + (Math.PI * 2 * proporcao);
      let forma;

      if (grafico.length === 1 || proporcao >= 0.999999) {
        forma = document.createElementNS(SVG_NS, 'circle');
        forma.setAttribute('cx', '110');
        forma.setAttribute('cy', '110');
        forma.setAttribute('r', '92');
      } else {
        forma = document.createElementNS(SVG_NS, 'path');
        forma.setAttribute('d', caminhoFatia(110, 110, 92, angulo, proximo));
      }

      forma.setAttribute('fill', CORES[indice % CORES.length]);
      forma.setAttribute('stroke', '#ffffff');
      forma.setAttribute('stroke-width', '2');
      forma.setAttribute('tabindex', '0');
      forma.setAttribute('aria-label', `${item.descricao || 'Produto'}: ${formatarQuantidade(item.quantidade)} unidades, ${formatarPercentual(item.percentual)}`);

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${item.descricao || 'Produto'} — ${formatarQuantidade(item.quantidade)} unidade(s) — ${formatarPercentual(item.percentual)}`;
      forma.appendChild(title);

      ['mouseenter', 'focus', 'click', 'touchstart'].forEach((evento) => {
        forma.addEventListener(evento, () => atualizarDestaque(indice), { passive: true });
      });

      svg.appendChild(forma);
      fatias.push(forma);
      angulo = proximo;

      const expansivel = consultarPrecos && !ehOutros(item);
      const painel = criarElemento(expansivel ? 'details' : 'div', 'perfil-compras-legenda-item');
      const cabecalho = criarElemento(expansivel ? 'summary' : 'button', 'perfil-compras-legenda-cabecalho');
      if (!expansivel) cabecalho.type = 'button';
      const cor = criarElemento('span', 'perfil-compras-cor');
      cor.style.backgroundColor = CORES[indice % CORES.length];
      cabecalho.appendChild(cor);
      cabecalho.appendChild(criarElemento('span', 'perfil-compras-legenda-nome', item.descricao || 'Produto'));
      cabecalho.appendChild(criarElemento(
        'span',
        'perfil-compras-legenda-valor',
        `${formatarQuantidade(item.quantidade)} • ${formatarPercentual(item.percentual)}`
      ));
      if (expansivel) cabecalho.appendChild(criarElemento('span', 'perfil-compras-legenda-seta', '⌄'));
      painel.appendChild(cabecalho);
      if (expansivel) {
        const conteudo = criarElemento('div', 'perfil-compras-precos-conteudo');
        painel.appendChild(conteudo);
        paineis.push(painel);
        painel.addEventListener('toggle', () => {
          if (!painel.open) return;
          paineis.forEach(outro => { if (outro !== painel) outro.open = false; });
          carregarPrecos(item, conteudo, painel);
        });
      }
      ['mouseenter', 'focusin', 'click'].forEach(evento => {
        cabecalho.addEventListener(evento, () => atualizarDestaque(indice));
      });
      legenda.appendChild(painel);
      legendas.push(painel);
    });

    areaGrafico.appendChild(svg);
    areaGrafico.appendChild(detalhe);
    grid.appendChild(areaGrafico);
    grid.appendChild(legenda);
    secao.appendChild(grid);
    container.appendChild(secao);

    atualizarDestaque(0);
  }

  function loading(container, texto) {
    if (!container) return;
    container.innerHTML = '';
    container.appendChild(criarElemento('div', 'perfil-compras-loading', texto || 'Carregando perfil de compras...'));
  }

  function erro(container, mensagem) {
    if (!container) return;
    container.innerHTML = '';
    container.appendChild(criarElemento('div', 'perfil-compras-erro', mensagem || 'Erro ao carregar o perfil de compras.'));
  }

  window.PerfilComprasChart = {
    render,
    loading,
    erro,
    formatarQuantidade
  };
})();
