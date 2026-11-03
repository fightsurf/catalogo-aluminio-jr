'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const dinheiro = valor => Number(valor || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let fornecedores = [], catalogo = [], edicaoId = null, origem = 'manual', ultimaContagem = 0;
  const unidades = ['un','kg','g','m','cm','mm','l','ml','cx','pct','outro'];
  const limparNome = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();

  function aviso(mensagem, tipo = 'ok') {
    const el = $('aviso');
    el.textContent = mensagem; el.hidden = false; el.classList.toggle('erro',tipo === 'erro');
    el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function api(url, op = {}) {
    const res = await fetch(url,{ credentials:'same-origin', ...op });
    let dados;
    try { dados = await res.json(); } catch {
      throw new Error(res.status===401 ? 'Faça login como administrador.' : 'O servidor não retornou JSON válido.');
    }
    if (!res.ok) throw new Error(dados.erro || dados.message || 'Falha ao conectar.');
    return dados;
  }
  function option(select, valor, nome) {
    const op = document.createElement('option');
    op.value = String(valor); op.textContent = nome; select.appendChild(op);
  }
  async function carregarCatalogos() {
    [fornecedores,catalogo] = await Promise.all([api('/api/compras/fornecedores'),api('/api/compras/insumos')]);
    for(const f of fornecedores) {
      option($('fornecedor_id'),f.id,f.nome);
      option($('filtroFornecedor'),f.id,f.nome);
    }
    catalogo.forEach(i=>option($('catalogoInsumos'),i.nome,i.nome));
  }
  function mostrarAba(aba) {
    const historico = aba === 'historico';
    $('painelCadastro').hidden = historico;
    $('painelHistorico').hidden = !historico;
    $('tabCadastro').classList.toggle('active',!historico);
    $('tabHistorico').classList.toggle('active',historico);
    if(historico) consultar().catch(e=>aviso(e.message,'erro'));
  }
  function criarLinha(item = {}) {
    const linha = document.createElement('div');
    linha.className = 'linha';
    linha.dataset.insumoId = item.insumo_id || '';
    linha.dataset.valorTotal = item.valor_total ?? item.subtotal_informado ?? '';
    linha.innerHTML = '<span class="numero">Insumo</span>' +
      '<label>Descrição do insumo<input class="descricao" type="text" list="catalogoInsumos" maxlength="240" placeholder="Digite ou selecione um insumo"></label>' +
      '<label>Unidade<select class="unidade"></select></label>' +
      '<label>Quantidade<input class="quantidade" type="number" step="0.001" min="0.001" placeholder="0"></label>' +
      '<label>Preço unitário (R$)<input class="preco" type="number" step="0.0001" min="0" placeholder="0,00"></label>' +
      '<div class="subtotal">R$ 0,00</div><button type="button" class="remove" title="Remover este item" aria-label="Remover este item">✕</button>';
    const descricao = linha.querySelector('.descricao');
    const unidade = linha.querySelector('.unidade');
    const quantidade = linha.querySelector('.quantidade');
    const preco = linha.querySelector('.preco');
    unidades.forEach(u=>option(unidade,u,u));
    descricao.value = item.descricao || '';
    unidade.value = unidades.includes(String(item.unidade || '').toLowerCase()) ? String(item.unidade).toLowerCase() : 'un';
    quantidade.value = item.quantidade ?? '';
    preco.value = item.preco_unitario ?? '';
    descricao.addEventListener('change', () => {
      const achado = catalogo.find(i=>limparNome(i.nome) === limparNome(descricao.value));
      linha.dataset.insumoId = achado?.id || '';
      if(achado && unidades.includes(achado.unidade_medida)) unidade.value=achado.unidade_medida;
      atualizar();
    });
    for(const controle of [descricao,unidade]) controle.addEventListener('input',atualizar);
    for(const controle of [quantidade,preco]) controle.addEventListener('input',()=>{linha.dataset.valorTotal='';atualizar();});
    linha.querySelector('.remove').addEventListener('click',()=>{linha.remove();atualizar();});
    $('linhas').appendChild(linha);
    atualizar();
  }
  function lerItens() {
    return [...$('linhas').querySelectorAll('.linha')].map(linha => ({
      insumo_id: linha.dataset.insumoId ? Number(linha.dataset.insumoId) : null,
      descricao:linha.querySelector('.descricao').value.trim(),
      unidade:linha.querySelector('.unidade').value,
      quantidade:linha.querySelector('.quantidade').value === '' ? null : Number(linha.querySelector('.quantidade').value),
      preco_unitario:linha.querySelector('.preco').value === '' ? null : Number(linha.querySelector('.preco').value),
      valor_total:linha.dataset.valorTotal === '' ? null : Number(linha.dataset.valorTotal)
    })).filter(item => item.descricao || item.quantidade !== null || item.preco_unitario !== null);
  }
  function td(tr,valor) {const cel=document.createElement('td');cel.textContent=String(valor);tr.appendChild(cel);return cel;}
  function atualizar() {
    const itens=lerItens();
    const subtotal = item => item.quantidade === null || item.preco_unitario === null
      ? item.valor_total : Math.round((item.quantidade*item.preco_unitario+Number.EPSILON)*100)/100;
    const total=itens.reduce((s,i)=>s+(subtotal(i) ?? 0),0);
    const tbody=$('previewItens');tbody.replaceChildren();
    [...$('linhas').children].forEach((linha,indice)=>{
      linha.querySelector('.numero').textContent='Insumo '+(indice+1);
      const q=linha.querySelector('.quantidade').value;
      const p=linha.querySelector('.preco').value;
      linha.querySelector('.subtotal').textContent = q !== '' && p !== '' ? dinheiro(Number(q)*Number(p)) :
        (linha.dataset.valorTotal === '' ? '—' : dinheiro(linha.dataset.valorTotal));
    });
    for(const item of itens) {
      const tr=document.createElement('tr');
      td(tr,item.descricao || 'Sem descrição');td(tr,item.quantidade ?? '—');
      td(tr,item.unidade);td(tr,item.preco_unitario == null ? '—' : dinheiro(item.preco_unitario));
      td(tr,subtotal(item) == null ? '—' : dinheiro(subtotal(item)));
      tbody.appendChild(tr);
    }
    if (!itens.length) {
      const tr=document.createElement('tr');td(tr,'Adicione os itens da NF para começar.').colSpan=5;tbody.appendChild(tr);
    }
    const qty=$('quantidade_itens_nf');
    if (!qty.value || Number(qty.value)===ultimaContagem) qty.value=itens.length || '';
    ultimaContagem=itens.length;
    $('resumoItens').textContent=itens.length + ' linha(s) cadastrada(s).';
    $('contadorLinhas').textContent=itens.length + ' item(ns)';
    $('totalModal').textContent='Total: '+dinheiro(total);
    $('somaItens').textContent=dinheiro(total);
    const totalNota=$('valor_nf').value;
    $('diferenca').textContent=totalNota === '' ? '—' : dinheiro(Number(totalNota)-total);
  }
  function abrirModal() {
    if (!$('linhas').children.length) criarLinha();
    $('modalItens').showModal();
  }
  function limpar() {
    $('formCompra').reset();
    $('linhas').replaceChildren();
    edicaoId=null;origem='manual';ultimaContagem=0;
    $('etiquetaEdicao').textContent='Nova nota';
    $('btnSalvar').textContent='Salvar compra';
    $('avisosIa').hidden=true;$('avisosIa').textContent='';
    $('fotos').value='';
    $('valor_frete').value='';$('icms_frete').value='';
    atualizar();
  }
  function preencher(nota) {
    limpar();
    edicaoId=Number(nota.id) || null;
    origem=nota.origem || 'manual';
    for(const campo of ['fornecedor_id','numero_nf','valor_nf','valor_frete','icms_frete']) {
      $(campo).value=nota[campo] ?? '';
    }
    $('data_nf').value=String(nota.data_nf || '').slice(0,10);
    const itens=nota.itens || [];
    itens.forEach(criarLinha);
    $('quantidade_itens_nf').value=nota.quantidade_itens_nf ?? (itens.length || '');
    $('etiquetaEdicao').textContent=edicaoId ? 'Editando NF #'+nota.numero_nf : 'Importação IA';
    $('btnSalvar').textContent=edicaoId ? 'Salvar alterações' : 'Salvar compra';
    atualizar();
  }
  async function salvar(evento) {
    evento.preventDefault();
    const itens=lerItens();
    // Uma nota pode existir apenas com fornecedor e número, sem itens ou valores.
    if (itens.some(i=>(i.quantidade !== null && (!Number.isFinite(i.quantidade) || i.quantidade<=0)) ||
        (i.preco_unitario !== null && (!Number.isFinite(i.preco_unitario) || i.preco_unitario<0))))
      return aviso('Confira as quantidades e os preços preenchidos.','erro');
    const payload={
      fornecedor_id:$('fornecedor_id').value,
      numero_nf:$('numero_nf').value,
      data_nf:$('data_nf').value||null,
      valor_nf:$('valor_nf').value,
      quantidade_itens_nf:$('quantidade_itens_nf').value,
      valor_frete:$('valor_frete').value || null,
      icms_frete:$('icms_frete').value || null,
      origem, itens
    };
    if (!payload.fornecedor_id || !payload.numero_nf.trim())
      return aviso('Fornecedor e número da NF são obrigatórios.','erro');
    if (payload.quantidade_itens_nf !== '' && itens.length > 0 &&
      Number(payload.quantidade_itens_nf)!==itens.length &&
      !confirm('A quantidade de itens na NF difere do número de linhas cadastradas. Deseja continuar?')) return;
    const botao=$('btnSalvar');botao.disabled=true;
    try {
      const nota=await api(edicaoId ? '/api/compras/'+edicaoId : '/api/compras',{
        method:edicaoId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      preencher(nota);
      aviso('Nota fiscal '+nota.numero_nf+' salva com sucesso.');
    } catch(e) { aviso(e.message,'erro'); }
    finally {botao.disabled=false;}
  }
  async function interpretar() {
    const arquivos=[...$('fotos').files];
    if(!arquivos.length) return;
    if(arquivos.length>5) return aviso('Selecione até 5 fotos.','erro');
    const form=new FormData();arquivos.forEach(arquivo=>form.append('imagens',arquivo));
    if($('fornecedor_id').value) form.append('fornecedor_id',$('fornecedor_id').value);
    if($('numero_nf').value.trim()) form.append('numero_nf',$('numero_nf').value.trim());
    const botao=$('btnImportar');botao.disabled=true;botao.textContent='Interpretando fotos...';
    try {
      const resultado=await api('/api/compras/interpretar',{method:'POST',body:form});
      const n=resultado.dados||{};
      const registro=resultado.registro;
      if(registro?.nota) {
        preencher(registro.nota);
        $('etiquetaEdicao').textContent='NF '+registro.nota.numero_nf+' — importada';
      } else {
        preencher({...n,origem:'ia'});
        $('etiquetaEdicao').textContent='Importação IA — revisar';
        $('quantidade_itens_nf').value=n.quantidade_itens_nf || n.itens?.length || '';
      }
      origem='ia';
      const mensagens=[...(resultado.avisos||[])];
      if(n.valor_frete===null) mensagens.push('Frete não identificado. Deixe em branco ou preencha.');
      if(n.icms_frete===null) mensagens.push('ICMS do frete não identificado. Deixe em branco ou preencha.');
      if(mensagens.length) {
        $('avisosIa').hidden=false;
        $('avisosIa').textContent='CONFERÊNCIA RECOMENDADA\n'+mensagens.join('\n');
      }
      if(registro?.nota){
        aviso((registro.criada ? 'NF cadastrada automaticamente.' : 'NF existente localizada e complementada.') +
          ' '+registro.itensIncluidos+' novo(s) insumo(s), '+registro.itensCompletados+' item(ns) completado(s). Confira os dados.');
      } else {
        aviso('Dados extraídos, mas não gravados automaticamente. Confira fornecedor e número da NF e clique em Salvar.');
      }
      if((registro?.nota.itens?.length || n.itens?.length)) abrirModal();
    } catch(e){aviso(e.message,'erro');}
    finally{botao.disabled=false;botao.textContent='Importar fotos';$('fotos').value='';}
  }
  async function consultar() {
    const params=new URLSearchParams();
    if($('busca').value.trim()) params.set('busca',$('busca').value.trim());
    if($('filtroFornecedor').value) params.set('fornecedor_id',$('filtroFornecedor').value);
    const dados=await api('/api/compras/?'+params.toString());
    const tbody=$('historico');tbody.replaceChildren();
    for(const n of dados) {
      const tr=document.createElement('tr');
      td(tr,n.numero_nf);td(tr,n.fornecedor_nome);td(tr,n.valor_nf == null ? '—' : dinheiro(n.valor_nf));td(tr,n.valor_frete == null ? '—' : dinheiro(n.valor_frete));
      td(tr,n.linhas_cadastradas);td(tr,new Date(n.criado_em).toLocaleDateString('pt-BR'));
      const botao=document.createElement('button');botao.type='button';botao.className='btn secondary pequeno';
      botao.textContent='Abrir / editar';
      botao.addEventListener('click',async()=>{
        try {preencher(await api('/api/compras/'+n.id));mostrarAba('cadastro');window.scrollTo({top:0,behavior:'smooth'});}
        catch(e){aviso(e.message,'erro');}
      });
      const cel=document.createElement('td');cel.appendChild(botao);tr.appendChild(cel);tbody.appendChild(tr);
    }
    if(!dados.length) { const tr=document.createElement('tr');td(tr,'Nenhuma NF encontrada.').colSpan=7;tbody.appendChild(tr); }
  }
  async function iniciar() {
    $('tabCadastro').addEventListener('click',()=>mostrarAba('cadastro'));
    $('tabHistorico').addEventListener('click',()=>mostrarAba('historico'));
    $('btnItens').addEventListener('click',abrirModal);
    $('btnAdicionarLinha').addEventListener('click',()=>criarLinha());
    $('btnFecharModal').addEventListener('click',()=>$('modalItens').close());
    $('btnConcluirItens').addEventListener('click',()=>{$('modalItens').close();atualizar();});
    $('btnNova').addEventListener('click',()=>{limpar();aviso('Formulário limpo.');});
    $('formCompra').addEventListener('submit',salvar);
    $('valor_nf').addEventListener('input',atualizar);
    $('btnImportar').addEventListener('click',()=>$('fotos').click());
    $('fotos').addEventListener('change',interpretar);
    $('btnFiltrar').addEventListener('click',()=>consultar().catch(e=>aviso(e.message,'erro')));
    $('btnAtualizar').addEventListener('click',()=>consultar().catch(e=>aviso(e.message,'erro')));
    $('busca').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();consultar().catch(err=>aviso(err.message,'erro'));}});
    try {await carregarCatalogos();}catch(e){aviso('Erro ao carregar fornecedores/insumos: '+e.message,'erro');}
    limpar();
  }
  document.addEventListener('DOMContentLoaded',iniciar);
})();
