'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const dinheiro = valor => Number(valor || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let fornecedores = [], catalogo = [], edicaoId = null, origem = 'manual', ultimaContagem = 0;
  const unidades = ['un','kg','g','m','cm','mm','l','ml','cx','pct','outro'];
  const nomeStatus = {a_confirmar:'A confirmar',pendente:'Pendente',pago:'Pago',cancelado:'Cancelado'};
  const nomeTipo = {boleto:'Boleto',duplicata:'Duplicata / parcela'};
  const formatarData = iso => {
    if(!iso)return '—';
    const d=String(iso).slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4) : '—';
  };
  const dataHoje=() => {
    const d=new Date(),ajustado=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return ajustado.toISOString().slice(0,10);
  };
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
    const historico = aba === 'historico',controle=aba==='boletos';
    $('painelCadastro').hidden = historico||controle;
    $('painelHistorico').hidden = !historico;
    $('painelBoletos').hidden = !controle;
    $('tabCadastro').classList.toggle('active',!historico&&!controle);
    $('tabHistorico').classList.toggle('active',historico);
    $('tabBoletos').classList.toggle('active',controle);
    if(historico) consultar().catch(e=>aviso(e.message,'erro'));
    if(controle) consultarBoletos().catch(e=>aviso(e.message,'erro'));
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
  function criarBoleto(b={}) {
    const linha=document.createElement('div');
    linha.className='boleto-linha';
    linha.dataset.boletoId=b.id||'';
    linha.dataset.origem=b.origem||'manual';
    linha.innerHTML='<div class="boleto-topo"><strong class="boleto-numero">Boleto</strong><button type="button" class="remove boleto-remover">Remover</button></div>'+
      '<div class="boleto-campos">'+
      '<label>Parcela<input class="b-parcela" maxlength="30" placeholder="Ex.: 1/3"></label>'+
      '<label>Vencimento *<input class="b-vencimento" type="date" required></label>'+
      '<label>Valor (R$) *<input class="b-valor" type="number" step="0.01" min="0.01" placeholder="0,00" required></label>'+
      '<label>Nº documento<input class="b-documento" maxlength="80"></label>'+
      '<label>Nosso número<input class="b-nosso" maxlength="80"></label>'+
      '<label>Banco<input class="b-banco" maxlength="120"></label>'+
      '<label>Tipo<select class="b-tipo"><option value="boleto">Boleto</option><option value="duplicata">Duplicata / parcela</option></select></label>'+
      '<label>Situação<select class="b-status"><option value="a_confirmar">A confirmar</option><option value="pendente">Pendente</option><option value="pago">Pago</option><option value="cancelado">Cancelado</option></select></label>'+
      '<label class="b-linha-campo">Linha digitável (47 ou 48 dígitos)<input class="b-linha" maxlength="80" placeholder="Opcional"></label>'+
      '<label>Data pagamento<input class="b-pagamento" type="date"></label>'+
      '<label>Valor pago (R$)<input class="b-valor-pago" type="number" step="0.01" min="0"></label>'+
      '<label class="b-obs-campo">Observações<input class="b-obs" maxlength="400"></label></div>';
    const valores={
      '.b-parcela':b.parcela,
      '.b-vencimento':b.vencimento,
      '.b-valor':b.valor,
      '.b-documento':b.numero_documento,
      '.b-nosso':b.nosso_numero,
      '.b-banco':b.banco,
      '.b-tipo':b.tipo||'boleto',
      '.b-status':b.status||(b.tipo==='duplicata'?'a_confirmar':'pendente'),
      '.b-linha':b.linha_digitavel,
      '.b-pagamento':b.data_pagamento,
      '.b-valor-pago':b.valor_pago,
      '.b-obs':b.observacao
    };
    for(const [sel,valor] of Object.entries(valores)) {
      if(valor!==null&&valor!==undefined) {
        linha.querySelector(sel).value=sel==='.b-vencimento'||sel==='.b-pagamento' ? String(valor).slice(0,10) : String(valor);
      }
    }
    const mudarStatus=()=>{
      const pago=linha.querySelector('.b-status').value==='pago';
      linha.querySelector('.b-pagamento').disabled=!pago;
      linha.querySelector('.b-valor-pago').disabled=!pago;
      atualizarBoletos();
    };
    linha.querySelector('.b-status').addEventListener('change',mudarStatus);
    linha.querySelector('.b-tipo').addEventListener('change',()=>{
      if(linha.querySelector('.b-tipo').value==='duplicata'&&linha.querySelector('.b-status').value==='pendente')
        linha.querySelector('.b-status').value='a_confirmar';
      mudarStatus();
    });
    linha.querySelector('.boleto-remover').addEventListener('click',()=>{linha.remove();atualizarBoletos();});
    linha.querySelectorAll('input').forEach(el=>el.addEventListener('input',atualizarBoletos));
    $('boletosLinhas').append(linha);
    mudarStatus();
  }
  function lerBoletos() {
    return [...$('boletosLinhas').querySelectorAll('.boleto-linha')].map(linha=>{
      const campo=cls=>linha.querySelector('.b-'+cls).value.trim();
      return {
        id:linha.dataset.boletoId?Number(linha.dataset.boletoId):null,
        origem:linha.dataset.origem,
        tipo:campo('tipo'),status:campo('status'),parcela:campo('parcela'),
        vencimento:campo('vencimento'),valor:campo('valor'),
        numero_documento:campo('documento'),nosso_numero:campo('nosso'),
        banco:campo('banco'),linha_digitavel:campo('linha'),
        data_pagamento:campo('pagamento'),valor_pago:campo('valor-pago'),observacao:campo('obs')
      };
    });
  }
  function atualizarBoletos() {
    const boletos=lerBoletos();
    const tbody=$('previewBoletos');tbody.replaceChildren();
    boletos.forEach((b,i)=>{
      const linha=$('boletosLinhas').children[i];
      linha.querySelector('.boleto-numero').textContent='Boleto / parcela '+(i+1);
      const tr=document.createElement('tr');
      td(tr,b.parcela||b.numero_documento||nomeTipo[b.tipo]||'Boleto');
      td(tr,formatarData(b.vencimento));td(tr,b.valor?dinheiro(b.valor):'—');
      td(tr,nomeStatus[b.status]||'—');tbody.append(tr);
    });
    if(!boletos.length){const tr=document.createElement('tr');td(tr,'Nenhum boleto cadastrado.').colSpan=4;tbody.append(tr);}
    const total=boletos.reduce((s,b)=>s+Number(b.valor||0),0);
    const abertos=boletos.filter(b=>b.status==='pendente'||b.status==='a_confirmar')
      .reduce((s,b)=>s+Number(b.valor||0),0);
    $('resumoBoletos').textContent=boletos.length+' boleto(s) / parcela(s) vinculado(s) à NF.';
    $('contadorBoletos').textContent=boletos.length+' título(s)';
    $('totalBoletos').textContent=dinheiro(total);
    $('totalBoletosAbertos').textContent=dinheiro(abertos);
    $('totalModalBoletos').textContent='Total: '+dinheiro(total);
  }
  function abrirModalBoletos(){ $('modalBoletos').showModal(); }
  async function consultarBoletos() {
    const params=new URLSearchParams();
    if($('buscaBoleto').value.trim())params.set('busca',$('buscaBoleto').value.trim());
    if($('filtroStatusBoleto').value)params.set('status',$('filtroStatusBoleto').value);
    const lista=await api('/api/compras/boletos?'+params.toString());
    const tbody=$('tabelaControleBoletos');tbody.replaceChildren();
    const totalAberto=lista.filter(b=>['pendente','a_confirmar'].includes(b.status))
      .reduce((t,b)=>t+Number(b.valor||0),0);
    $('resumoControleBoletos').textContent=lista.length+' título(s) encontrado(s) · Em aberto/a confirmar: '+dinheiro(totalAberto)+'.';
    for(const b of lista){
      const tr=document.createElement('tr');
      td(tr,b.fornecedor_nome+' / NF '+b.numero_nf);
      td(tr,[b.parcela,b.numero_documento].filter(Boolean).join(' · ')||'Sem número');
      td(tr,formatarData(b.vencimento));
      td(tr,dinheiro(b.valor));
      const situacao=td(tr,nomeStatus[b.status]||b.status);
      if(b.atrasado)situacao.classList.add('vencido');
      const cel=document.createElement('td'),acoes=document.createElement('div');acoes.className='acoes-boleto';
      const abrir=document.createElement('button');abrir.type='button';abrir.className='btn ghost pequeno';abrir.textContent='Abrir NF';
      abrir.addEventListener('click',async()=>{
        try{preencher(await api('/api/compras/'+b.nota_id));mostrarAba('cadastro');window.scrollTo({top:0,behavior:'smooth'});}
        catch(e){aviso(e.message,'erro');}
      });
      acoes.append(abrir);
      if(b.status==='pendente'||b.status==='a_confirmar'||b.status==='pago'){
        const proximo=b.status==='pago'?'pendente':'pago';
        const mudar=document.createElement('button');mudar.type='button';mudar.className='btn secondary pequeno';
        mudar.textContent=proximo==='pago'?'Registrar pagamento':'Reabrir';
        mudar.addEventListener('click',async()=>{
          const texto=proximo==='pago'?'Confirmar que este boleto foi pago?':'Reabrir este boleto como pendente?';
          if(!window.confirm(texto))return;
          mudar.disabled=true;
          try{
            const atualizado=await api('/api/compras/boletos/'+b.id+'/status',{
              method:'PATCH',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({status:proximo,data_pagamento:proximo==='pago'?dataHoje():null,
                valor_pago:proximo==='pago'?Number(b.valor):null})
            });
            if(Number(edicaoId)===Number(b.nota_id)){
              const linha=[...$('boletosLinhas').children].find(x=>Number(x.dataset.boletoId)===Number(b.id));
              if(linha){
                linha.querySelector('.b-status').value=atualizado.status;
                linha.querySelector('.b-pagamento').value=String(atualizado.data_pagamento||'').slice(0,10);
                linha.querySelector('.b-valor-pago').value=atualizado.valor_pago||'';
                linha.querySelector('.b-status').dispatchEvent(new Event('change'));
              }
            }
            await consultarBoletos();
          }catch(e){aviso(e.message,'erro');mudar.disabled=false;}
        });
        acoes.append(mudar);
      }
      cel.append(acoes);tr.append(cel);tbody.append(tr);
    }
    if(!lista.length){const tr=document.createElement('tr');td(tr,'Nenhum boleto encontrado.').colSpan=6;tbody.append(tr);}
  }
  function limpar() {
    $('formCompra').reset();
    $('linhas').replaceChildren();
    $('boletosLinhas').replaceChildren();
    edicaoId=null;origem='manual';ultimaContagem=0;
    $('etiquetaEdicao').textContent='Nova nota';
    $('btnSalvar').textContent='Salvar compra';
    $('avisosIa').hidden=true;$('avisosIa').textContent='';
    $('fotos').value='';
    $('valor_frete').value='';$('icms_frete').value='';
    atualizar();atualizarBoletos();
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
    (nota.boletos || []).forEach(criarBoleto);
    $('quantidade_itens_nf').value=nota.quantidade_itens_nf ?? (itens.length || '');
    $('etiquetaEdicao').textContent=edicaoId ? 'Editando NF #'+nota.numero_nf : 'Importação IA';
    $('btnSalvar').textContent=edicaoId ? 'Salvar alterações' : 'Salvar compra';
    atualizar();atualizarBoletos();
  }
  async function salvar(evento) {
    evento.preventDefault();
    const itens=lerItens();
    const boletos=lerBoletos();
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
      origem, itens, boletos
    };
    if (!payload.fornecedor_id || !payload.numero_nf.trim())
      return aviso('Fornecedor e número da NF são obrigatórios.','erro');
    if(boletos.some(b=>!b.vencimento||!b.valor||Number(b.valor)<=0))
      return aviso('Confira o vencimento e o valor de todos os boletos.','erro');
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
    const pdfs=arquivos.filter(a=>a.type==='application/pdf'||/\.pdf$/i.test(a.name));
    if(pdfs.length && arquivos.length!==1) return aviso('Selecione um único PDF, sem misturar com fotos.','erro');
    if(!pdfs.length && arquivos.length>5) return aviso('Selecione até 5 fotos.','erro');
    if(pdfs.length && pdfs[0].size>12*1024*1024) return aviso('PDF maior que 12 MB.','erro');
    if(!pdfs.length && arquivos.some(a=>a.size>7*1024*1024))
      return aviso('Cada foto deve ter até 7 MB.','erro');
    const form=new FormData();arquivos.forEach(arquivo=>form.append('imagens',arquivo));
    if($('fornecedor_id').value) form.append('fornecedor_id',$('fornecedor_id').value);
    if($('numero_nf').value.trim()) form.append('numero_nf',$('numero_nf').value.trim());
    const botao=$('btnImportar');botao.disabled=true;botao.textContent=pdfs.length?'Interpretando PDF...':'Interpretando fotos...';
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
          ' '+registro.itensIncluidos+' novo(s) insumo(s), '+registro.itensCompletados+' item(ns) completado(s), '+
          (registro.boletosIncluidos||0)+' novo(s) boleto(s)/parcela(s). Confira os dados.');
      } else {
        aviso('Dados extraídos, mas não gravados automaticamente. Confira fornecedor e número da NF e clique em Salvar.');
      }
      if((registro?.nota.itens?.length || n.itens?.length)) abrirModal();
    } catch(e){aviso(e.message,'erro');}
    finally{botao.disabled=false;botao.textContent='Importar fotos ou PDF';$('fotos').value='';}
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
      td(tr,n.linhas_cadastradas);td(tr,n.boletos_quantidade||0);td(tr,new Date(n.criado_em).toLocaleDateString('pt-BR'));
      const botao=document.createElement('button');botao.type='button';botao.className='btn secondary pequeno';
      botao.textContent='Abrir / editar';
      botao.addEventListener('click',async()=>{
        try {preencher(await api('/api/compras/'+n.id));mostrarAba('cadastro');window.scrollTo({top:0,behavior:'smooth'});}
        catch(e){aviso(e.message,'erro');}
      });
      const cel=document.createElement('td');cel.appendChild(botao);tr.appendChild(cel);tbody.appendChild(tr);
    }
    if(!dados.length) { const tr=document.createElement('tr');td(tr,'Nenhuma NF encontrada.').colSpan=8;tbody.appendChild(tr); }
  }
  async function iniciar() {
    $('tabCadastro').addEventListener('click',()=>mostrarAba('cadastro'));
    $('tabHistorico').addEventListener('click',()=>mostrarAba('historico'));
    $('tabBoletos').addEventListener('click',()=>mostrarAba('boletos'));
    $('btnBoletos').addEventListener('click',abrirModalBoletos);
    $('btnAdicionarBoleto').addEventListener('click',()=>criarBoleto());
    $('btnFecharBoletos').addEventListener('click',()=>$('modalBoletos').close());
    $('btnConcluirBoletos').addEventListener('click',()=>{
      const boletos=lerBoletos();
      if(boletos.some(b=>!b.vencimento||!b.valor||Number(b.valor)<=0)){
        return aviso('Confira os vencimentos e valores dos boletos.','erro');
      }
      $('modalBoletos').close();atualizarBoletos();
    });
    $('btnFiltrarBoletos').addEventListener('click',()=>consultarBoletos().catch(e=>aviso(e.message,'erro')));
    $('btnAtualizarBoletos').addEventListener('click',()=>consultarBoletos().catch(e=>aviso(e.message,'erro')));
    $('buscaBoleto').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();consultarBoletos().catch(err=>aviso(err.message,'erro'));}});
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
