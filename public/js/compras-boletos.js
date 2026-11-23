"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const dinheiro = valor => Number(valor || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const nomeStatus = {a_confirmar:'A confirmar',pendente:'Pendente',pago:'Pago',cancelado:'Cancelado'};
  const formatarData = iso => {
    if(!iso)return '—';
    const d=String(iso).slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4) : '—';
  };
  const dataHoje=() => {
    const d=new Date(),ajustado=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    return ajustado.toISOString().slice(0,10);
  };
  let notaAtual=null,notaCarregada=false,alterado=false,carregandoNota=false,salvando=false,acaoStatus=false;
  let buscaNotasAtual=0,buscaBoletosAtual=0,cargaNotaAtual=0;
  function aviso(mensagem,tipo='ok') {
    const el=$('aviso');el.textContent=mensagem;el.hidden=false;el.classList.toggle('erro',tipo==='erro');
    el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function api(url,op={}) {
    const resposta=await fetch(url,{credentials:'same-origin',...op});
    let dados;
    try{dados=await resposta.json();}catch{
      throw new Error(resposta.status===401?'Faça login como administrador.':'O servidor não retornou uma resposta válida.');
    }
    if(!resposta.ok)throw new Error(dados.erro||dados.message||'Falha ao conectar.');
    return dados;
  }
  function td(tr,valor){const cel=document.createElement('td');cel.textContent=String(valor);tr.append(cel);return cel;}
  function opcaoNota(nota) {
    const op=document.createElement('option');op.value=String(nota.id);
    op.textContent='NF '+nota.numero_nf+' — '+nota.fornecedor_nome;
    return op;
  }
  function atualizarPermissoes() {
    const ocupado=carregandoNota||salvando||acaoStatus;
    $('editorBoletos').disabled=ocupado||!notaCarregada;
    $('nota_id').disabled=ocupado;
    $('btnBuscarNotas').disabled=ocupado;
    $('btnRecarregarNota').disabled=ocupado||!notaAtual;
    document.querySelectorAll('[data-acao-status]').forEach(el=>{
      el.disabled=ocupado||alterado;
      el.title=alterado?'Salve ou recarregue os boletos em edição antes de registrar pagamentos.':'';
    });
    document.querySelectorAll('[data-abrir-nota]').forEach(el=>{el.disabled=ocupado;});
    $('estadoEdicao').textContent=salvando?'Salvando boletos...':carregandoNota?'Carregando boletos...':
      !notaCarregada&&notaAtual?'Recarregue os boletos antes de salvar.':alterado?'Alterações ainda não salvas.':'';
  }
  function marcarAlteracao(){alterado=true;atualizarPermissoes();}
  function atualizarBoletos() {
    const lista=lerBoletos();
    [...$('boletosLinhas').children].forEach((linha,i)=>{linha.querySelector('.boleto-numero').textContent='Boleto / parcela '+(i+1);});
    $('contadorBoletos').textContent=lista.length+' título(s)';
    $('semBoletos').hidden=lista.length>0;
    $('totalBoletos').textContent=dinheiro(lista.reduce((s,b)=>s+Number(b.valor||0),0));
    $('totalBoletosAbertos').textContent=dinheiro(lista.filter(b=>['pendente','a_confirmar'].includes(b.status)).reduce((s,b)=>s+Number(b.valor||0),0));
  }
  function preencherNota(nota) {
    if(!nota||!Number.isSafeInteger(Number(nota.id))||Number(nota.id)<1||!Array.isArray(nota.boletos))
      throw new Error('Não foi possível carregar os boletos desta nota.');
    notaAtual=nota;notaCarregada=true;
    $('boletosLinhas').replaceChildren();
    nota.boletos.forEach(criarBoleto);
    $('tituloNota').textContent='Boletos da NF '+nota.numero_nf;
    $('resumoNota').textContent=nota.fornecedor_nome+' · Valor da NF: '+(nota.valor_nf==null?'Não informado':dinheiro(nota.valor_nf));
    $('voltarNota').href='/compras?nota_id='+encodeURIComponent(nota.id);
    if(![...$('nota_id').options].some(op=>op.value===String(nota.id)))$('nota_id').append(opcaoNota(nota));
    $('nota_id').value=String(nota.id);
    $('painelNota').hidden=false;
    alterado=false;atualizarBoletos();atualizarPermissoes();
    const url=new URL(window.location.href);url.searchParams.set('nota_id',String(nota.id));
    window.history.replaceState(null,'',url);
  }
  async function consultarNotas() {
    const tentativa=++buscaNotasAtual;
    const params=new URLSearchParams();
    if($('buscaNota').value.trim())params.set('busca',$('buscaNota').value.trim());
    const lista=await api('/api/compras?'+params.toString());
    if(tentativa!==buscaNotasAtual)return;
    const select=$('nota_id');select.replaceChildren();
    const vazio=document.createElement('option');vazio.value='';vazio.textContent='Selecione uma nota fiscal';select.append(vazio);
    lista.forEach(n=>select.append(opcaoNota(n)));
    if(notaAtual&&!lista.some(n=>String(n.id)===String(notaAtual.id)))select.append(opcaoNota(notaAtual));
    select.value=notaAtual?String(notaAtual.id):'';
    $('resumoNotas').textContent=lista.length
      ?lista.length+' nota(s) encontrada(s). Pesquise pelo número ou fornecedor para localizar outras notas.'
      :'Nenhuma nota encontrada. Cadastre a nota na página de compras ou altere a pesquisa.';
  }
  async function carregarNota(id,{confirmar=true}={}) {
    const numero=Number(id);
    if(!Number.isSafeInteger(numero)||numero<1){aviso('Selecione uma nota fiscal válida.','erro');return false;}
    if(confirmar&&alterado&&!window.confirm('Descartar as alterações ainda não salvas nos boletos?')){
      $('nota_id').value=notaAtual?String(notaAtual.id):'';return false;
    }
    const tentativa=++cargaNotaAtual;
    carregandoNota=true;atualizarPermissoes();
    try {
      const nota=await api('/api/compras/'+numero);
      if(tentativa!==cargaNotaAtual)return false;
      if(Number(nota.id)!==numero)throw new Error('A nota carregada não corresponde à seleção.');
      preencherNota(nota);return true;
    } catch(e) {
      if(tentativa===cargaNotaAtual){$('nota_id').value=notaAtual?String(notaAtual.id):'';aviso(e.message,'erro');}
      return false;
    } finally {if(tentativa===cargaNotaAtual){carregandoNota=false;atualizarPermissoes();}}
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
      '<label class="b-linha-campo">Código de barras (44 dígitos)<input class="b-codigo" maxlength="60" placeholder="Opcional"></label>'+
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
      '.b-codigo':b.codigo_barras,
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
      if(pago && !linha.querySelector('.b-pagamento').value)linha.querySelector('.b-pagamento').value=dataHoje();
      if(pago && !linha.querySelector('.b-valor-pago').value)
        linha.querySelector('.b-valor-pago').value=linha.querySelector('.b-valor').value;
      atualizarBoletos();
    };
    linha.querySelector('.b-status').addEventListener('change',()=>{mudarStatus();marcarAlteracao();});
    linha.querySelector('.b-tipo').addEventListener('change',()=>{
      if(linha.querySelector('.b-tipo').value==='duplicata'&&linha.querySelector('.b-status').value==='pendente')
        linha.querySelector('.b-status').value='a_confirmar';
      mudarStatus();marcarAlteracao();
    });
    linha.querySelector('.boleto-remover').addEventListener('click',()=>{linha.remove();atualizarBoletos();marcarAlteracao();});
    linha.querySelectorAll('input').forEach(el=>el.addEventListener('input',()=>{atualizarBoletos();marcarAlteracao();}));
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
        banco:campo('banco'),linha_digitavel:campo('linha'),codigo_barras:campo('codigo'),
        data_pagamento:campo('pagamento'),valor_pago:campo('valor-pago'),observacao:campo('obs')
      };
    });
  }

  async function salvarBoletos(evento) {
    evento.preventDefault();
    if(salvando||carregandoNota||acaoStatus)return;
    if(!notaAtual||!notaCarregada)return aviso('Carregue uma nota antes de salvar os boletos.','erro');
    const lista=lerBoletos();
    if(!$('formBoletos').reportValidity())return;
    if(lista.some(b=>!b.vencimento||!b.valor||!Number.isFinite(Number(b.valor))||Number(b.valor)<=0))
      return aviso('Confira o vencimento e o valor de todos os boletos.','erro');
    salvando=true;atualizarPermissoes();
    try {
      const resultado=await api('/api/compras/'+notaAtual.id+'/boletos',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({boletos:lista})
      });
      if(!Array.isArray(resultado.boletos)||Number(resultado.nota_id)!==Number(notaAtual.id)){
        notaCarregada=false;
        throw new Error('O servidor recebeu o salvamento, mas não retornou a lista de boletos. Recarregue a nota para conferir.');
      }
      preencherNota({...notaAtual,boletos:resultado.boletos});
      aviso('Boletos da NF '+notaAtual.numero_nf+' salvos com sucesso.');
      try{await consultarBoletos();}catch(e){aviso('Boletos salvos. Não foi possível atualizar a consulta: '+e.message,'erro');}
    } catch(e){aviso(e.message,'erro');}
    finally{salvando=false;atualizarPermissoes();}
  }
  async function consultarBoletos() {
    const tentativa=++buscaBoletosAtual;
    const params=new URLSearchParams();
    if($('buscaBoleto').value.trim())params.set('busca',$('buscaBoleto').value.trim());
    if($('filtroStatusBoleto').value)params.set('status',$('filtroStatusBoleto').value);
    const lista=await api('/api/compras/boletos?'+params.toString());
    if(tentativa!==buscaBoletosAtual)return;
    const tbody=$('tabelaControleBoletos');tbody.replaceChildren();
    const totalAberto=lista.filter(b=>['pendente','a_confirmar'].includes(b.status)).reduce((t,b)=>t+Number(b.valor||0),0);
    $('resumoControleBoletos').textContent=lista.length+' título(s) encontrado(s) · Em aberto/a confirmar: '+dinheiro(totalAberto)+'.';
    for(const b of lista){
      const tr=document.createElement('tr');
      td(tr,b.fornecedor_nome+' / NF '+b.numero_nf);
      td(tr,[b.parcela,b.numero_documento].filter(Boolean).join(' · ')||'Sem número');
      td(tr,formatarData(b.vencimento));td(tr,dinheiro(b.valor));
      const situacao=td(tr,nomeStatus[b.status]||b.status);if(b.atrasado)situacao.classList.add('vencido');
      const cel=document.createElement('td'),acoes=document.createElement('div');acoes.className='acoes-boleto';
      const abrir=document.createElement('button');abrir.type='button';abrir.className='btn ghost pequeno';
      abrir.textContent='Editar boletos';abrir.dataset.abrirNota='';
      abrir.addEventListener('click',async()=>{
        if(carregandoNota||salvando||acaoStatus)return;
        if(await carregarNota(b.nota_id))$('painelNota').scrollIntoView({behavior:'smooth',block:'start'});
      });
      acoes.append(abrir);
      if(['pendente','a_confirmar','pago'].includes(b.status)){
        const proximo=b.status==='pago'?'pendente':'pago';
        const mudar=document.createElement('button');mudar.type='button';mudar.className='btn secondary pequeno';
        mudar.textContent=proximo==='pago'?'Registrar pagamento':'Reabrir';mudar.dataset.acaoStatus='';
        mudar.addEventListener('click',async()=>{
          if(alterado||salvando||carregandoNota||acaoStatus)return;
          const texto=proximo==='pago'?'Confirmar que este boleto foi pago?':'Reabrir este boleto como pendente?';
          if(!window.confirm(texto))return;
          acaoStatus=true;atualizarPermissoes();
          try{
            await api('/api/compras/boletos/'+b.id+'/status',{
              method:'PATCH',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({status:proximo,data_pagamento:proximo==='pago'?dataHoje():null,
                valor_pago:proximo==='pago'?Number(b.valor):null})
            });
            let editorAtualizado=true;
            if(notaAtual&&Number(notaAtual.id)===Number(b.nota_id)){
              // Após um pagamento, recarregar o editor evita salvar a situação anterior.
              notaCarregada=false;
              editorAtualizado=await carregarNota(notaAtual.id,{confirmar:false});
            }
            const mensagem=proximo==='pago'?'Pagamento registrado.':'Boleto reaberto como pendente.';
            aviso(editorAtualizado?mensagem:mensagem+' Recarregue os boletos da nota antes de continuar.',editorAtualizado?'ok':'erro');
            try{await consultarBoletos();}catch(e){aviso('Situação atualizada. Não foi possível atualizar a consulta: '+e.message,'erro');}
          }catch(e){aviso(e.message,'erro');}
          finally{acaoStatus=false;atualizarPermissoes();}
        });
        acoes.append(mudar);
      }
      cel.append(acoes);tr.append(cel);tbody.append(tr);
    }
    if(!lista.length){const tr=document.createElement('tr');td(tr,'Nenhum boleto encontrado.').colSpan=6;tbody.append(tr);}
    atualizarPermissoes();
  }
  async function iniciar() {
    $('formBuscaNotas').addEventListener('submit',e=>{e.preventDefault();consultarNotas().catch(err=>aviso(err.message,'erro'));});
    $('nota_id').addEventListener('change',()=>{
      if($('nota_id').value)carregarNota($('nota_id').value);
      else $('nota_id').value=notaAtual?String(notaAtual.id):'';
    });
    $('formBoletos').addEventListener('submit',salvarBoletos);
    $('btnAdicionarBoleto').addEventListener('click',()=>{criarBoleto();marcarAlteracao();});
    $('btnRecarregarNota').addEventListener('click',()=>{if(notaAtual)carregarNota(notaAtual.id);});
    $('formBuscaBoletos').addEventListener('submit',e=>{e.preventDefault();consultarBoletos().catch(err=>aviso(err.message,'erro'));});
    $('btnAtualizarBoletos').addEventListener('click',()=>consultarBoletos().catch(e=>aviso(e.message,'erro')));
    window.addEventListener('beforeunload',e=>{if(alterado){e.preventDefault();e.returnValue='';}});
    atualizarPermissoes();
    const pesquisas=await Promise.allSettled([consultarNotas(),consultarBoletos()]);
    pesquisas.forEach((r,i)=>{if(r.status==='rejected'){
      $(i===0?'resumoNotas':'resumoControleBoletos').textContent='Não foi possível carregar a consulta.';
      aviso(r.reason.message,'erro');
    }});
    const id=new URLSearchParams(window.location.search).get('nota_id');
    if(id)await carregarNota(id,{confirmar:false});
  }
  document.addEventListener('DOMContentLoaded',iniciar);
})();
