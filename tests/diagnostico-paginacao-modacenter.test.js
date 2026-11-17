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
