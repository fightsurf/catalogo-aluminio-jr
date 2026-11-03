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
    for(const controle of [descricao,unidade,quantidade,preco]) controle.addEventListener('input',atualizar);
    linha.querySelector('.remove').addEventListener('click',()=>{linha.remove();atualizar();});
    $('linhas').appendChild(linha);
    atualizar();
  }
  function lerItens() {
    return [...$('linhas').querySelectorAll('.linha')].map(linha => ({
      insumo_id: linha.dataset.insumoId ? Number(linha.dataset.insumoId) : null,
      descricao:linha.querySelector('.descricao').value.trim(),
      unidade:linha.querySelector('.unidade').value,
      quantidade:Number(linha.querySelector('.quantidade').value),
      preco_unitario:Number(linha.querySelector('.preco').value)
    }));
  }
  function td(tr,valor) {const cel=document.createElement('td');cel.textContent=String(valor);tr.appendChild(cel);return cel;}
  function atualizar() {
    const itens=lerItens();
    const total=itens.reduce((s,i)=>s+Math.round(i.quantidade*i.preco_unitario*100)/100,0);
    const tbody=$('previewItens');tbody.replaceChildren();
    for(const [indice,item] of itens.entries()) {
      const linha=$('linhas').children[indice];
      linha.querySelector('.numero').textContent='Insumo '+(indice+1);
      linha.querySelector('.subtotal').textContent=dinheiro(item.quantidade*item.preco_unitario);
      const tr=document.createElement('tr');
      td(tr,item.descricao || 'Sem descrição');td(tr,item.quantidade || '—');
      td(tr,item.unidade);td(tr,dinheiro(item.preco_unitario));td(tr,dinheiro(item.quantidade*item.preco_unitario));
      tbody.appendChild(tr);
    }
    if (!itens.length) {
      const tr=document.createElement('tr');td(tr,'Adicione os itens da NF para começar.').colSpan=5;tbody.appendChild(tr);
    }
    const qty=$('quantidade_itens_nf');
    if (!qty.value || Number(qty.value)===ultimaContagem) qty.value=itens.length||'';
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
    $('valor_frete').value=0;$('icms_frete').value=0;
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
    $('quantidade_itens_nf').value=nota.quantidade_itens_nf ?? itens.length;
    $('etiquetaEdicao').textContent=edicaoId ? 'Editando NF #'+nota.numero_nf : 'Importação IA';
    $('btnSalvar').textContent=edicaoId ? 'Salvar alterações' : 'Salvar compra';
    atualizar();
  }
  async function salvar(evento) {
    evento.preventDefault();
    const itens=lerItens();
    if(!itens.length) return aviso('Inclua pelo menos um insumo.','erro');
    if (itens.some(i=>!i.descricao || !Number.isFinite(i.quantidade) || i.quantidade<=0 || !Number.isFinite(i.preco_unitario) || i.preco_unitario<0))
      return aviso('Revise descrição, quantidade e preço de todos os insumos.','erro');
    const payload={
      fornecedor_id:$('fornecedor_id').value,
      numero_nf:$('numero_nf').value,
      data_nf:$('data_nf').value||null,
      valor_nf:$('valor_nf').value,
      quantidade_itens_nf:$('quantidade_itens_nf').value,
      valor_frete:$('valor_frete').value || 0,
      icms_frete:$('icms_frete').value || 0,
      origem, itens
    };
    if (!payload.fornecedor_id || !payload.numero_nf.trim() || payload.valor_nf === '')
      return aviso('Preencha fornecedor, número da NF e valor total.','erro');
    if (Number(payload.quantidade_itens_nf)!==itens.length &&
      !confirm('A quantidade de itens na NF é diferente do número de linhas cadastradas. Deseja continuar?')) return;
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
    const botao=$('btnImportar');botao.disabled=true;botao.textContent='Interpretando fotos...';
    try {
      const resultado=await api('/api/compras/interpretar',{method:'POST',body:form});
      const n=resultado.dados||{};
      preencher({...n, valor_frete:n.valor_frete ?? 0,icms_frete:n.icms_frete ?? 0, origem:'ia'});
      origem='ia';
      $('etiquetaEdicao').textContent='Importação IA — revisar';
      $('quantidade_itens_nf').value=n.quantidade_itens_nf || n.itens?.length || '';
      const mensagens=[...(resultado.avisos||[])];
      if(n.valor_frete===null) mensagens.push('Frete não identificado. Confira se é zero.');
      if(n.icms_frete===null) mensagens.push('ICMS do frete não identificado. Confira se é zero.');
      if(mensagens.length){
        $('avisosIa').hidden=false;
        $('avisosIa').textContent='CONFERÊNCIA NECESSÁRIA\n'+mensagens.join('\n');
      }
      aviso('Dados extraídos. Confira fornecedor, valores e cada insumo antes de salvar.');
      if(n.itens?.length) abrirModal();
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
      td(tr,n.numero_nf);td(tr,n.fornecedor_nome);td(tr,dinheiro(n.valor_nf));td(tr,dinheiro(n.valor_frete));
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
