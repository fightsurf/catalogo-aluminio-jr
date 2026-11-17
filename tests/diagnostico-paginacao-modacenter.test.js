'use strict';
const test = require('node:test');
const cheerio = require('cheerio');
test('diagnostico da paginacao publica - sem dados pessoais', async () => {
  try {
    const response = await fetch('https://omodacenter.com.br/c/excursoes', {signal:AbortSignal.timeout(12000)});
    console.log('PAGINACAO_DIAG status',response.status,'type',response.headers.get('content-type'));
    if(!response.ok)return;
    const html=await response.text();const $=cheerio.load(html);
    console.log('PAGINACAO_DIAG HTML',html.length,'scripts', $('script[src]').map((_,e)=>$(e).attr('src')).get().slice(0,40));
    console.log('PAGINACAO_DIAG counts', {origem:(html.match(/Origem:/g)||[]).length, conferir:(html.match(/Conferir rota/g)||[]).length, heading:$('h3').length, nextScripts:(html.match(/self\\.__next_f\\.push/g)||[]).length});
    const chunk='/_next/static/chunks/app/c/excursoes/page-a7832169bf156013.js';
    const jsResponse=await fetch(new URL(chunk,'https://omodacenter.com.br'),{signal:AbortSignal.timeout(12000)});
    const js=await jsResponse.text();console.log('PAGINACAO_DIAG CHUNK',jsResponse.status,js.length);
    for(const term of ['fetch(', '/api/', 'axios', 'pageSize', 'page:', 'pagina:', 'offset:', 'take:', 'limit:', 'setPage', 'setCurrentPage', 'pagination', 'paginacao', 'totalPages', 'totalPaginas']){
      const locations=[];let p=-1;
      while ((p=js.indexOf(term,p+1))>=0 && locations.length<4) locations.push(js.slice(Math.max(0,p-160),Math.min(js.length,p+240)).replace(/[0-9]{10,}/g,'[n]'));
      if(locations.length)console.log('PAGINACAO_DIAG JS',term,locations);
    }
    console.log('PAGINACAO_DIAG INLINE', $('script:not([src])').length, $('script:not([src])').map((_,e)=>$(e).text().length).get().filter(Boolean).sort((a,b)=>b-a).slice(0,8));
    console.log('PAGINACAO_DIAG RSC', {tokenCount:html.split('self.__next_f.push').length-1, nameCount:html.split('\\\\"name\\\\"').length-1, itemCount:html.split('initialCurrentItems').length-1});
    const marker=html.indexOf('Abdon Turismo');
    if(marker>=0)console.log('PAGINACAO_DIAG CONTEXTO',html.slice(Math.max(0,marker-230),marker+260).replace(/\\\\/g,'\\\\').replace(/\\d{5,}/g,'[numero]'));
    const rev=html.indexOf('pageSize');if(rev>=0)console.log('PAGINACAO_DIAG PAGE SIZE CONTEXTO',html.slice(Math.max(0,rev-180),rev+190).replace(/\\d{5,}/g,'[numero]'));
    console.log('PAGINACAO_DIAG PAGER', $('button,a,[role=button]').filter((_,e)=>/^\s*(2|3|>|>>)\s*$/.test($(e).text())).slice(0,12).map((_,e)=>$(e).prop('outerHTML').slice(0,750)).get());
    console.log('PAGINACAO_DIAG STATE', $('script[type="application/json"],#__NEXT_DATA__,script[data-nuxt-data]').map((_,e)=>({attrs:$(e).attr(),size:$(e).text().length,peek:$(e).text().slice(0,160)})).get().slice(0,8));
    for(const q of ['?page=2','?pagina=2','?p=2','?pageNumber=2','?current_page=2']){
      try{
        const r=await fetch('https://omodacenter.com.br/c/excursoes'+q,{signal:AbortSignal.timeout(6000)});
        const page=await r.text();const $p=cheerio.load(page);
        console.log('PAGINACAO_DIAG CANDIDATO',q,r.status, $p('h3').filter((_,el)=>$p(el).parent().text().includes('Origem:')).slice(0,3).map((_,e)=>$p(e).text()).get());
      }catch(e){console.log('PAGINACAO_DIAG CANDIDATO',q,'erro',e.message)}
    }
  }catch(e){console.log('PAGINACAO_DIAG erro',e.message)}
});
