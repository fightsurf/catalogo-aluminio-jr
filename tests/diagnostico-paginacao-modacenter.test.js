'use strict';
const test = require('node:test');
const cheerio = require('cheerio');
const { extrairDadosIncorporados, coletarExcursoes } = require('../src/services/logistica/coletorModaCenter.service');
test('diagnostico da paginacao publica - sem dados pessoais', async () => {
  try {
    const response = await fetch('https://omodacenter.com.br/c/excursoes', {signal:AbortSignal.timeout(12000)});
    console.log('PAGINACAO_DIAG status',response.status,'type',response.headers.get('content-type'));
    if(!response.ok)return;
    const html=await response.text();const $=cheerio.load(html);
    const parsed=extrairDadosIncorporados(html);
    console.log('PAGINACAO_DIAG RESULT', {parsed:parsed.length,firstRoute:parsed[0]?.rota.split(' / ').length,firstPhones:parsed[0]?.telefones.split(' / ').length});
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
    
    const inlineScripts=$('script:not([src])').map((_,el)=>$(el).text()).get().join('\n');
    const flight=[];
    const re=/self\.__next_f\.push\((\[\s*\d+\s*,\s*"(?:\\.|[^"\\])*"\s*\])\)/g;
    for(const m of inlineScripts.matchAll(re)){
      try{const tuple=JSON.parse(m[1]);if(tuple[0]===1)flight.push(tuple[1]);}catch(e){console.log('PAGINACAO_DIAG FLIGHT PARSE ERRO',e.message)}
    }
    const flightText=flight.join('');
    console.log('PAGINACAO_DIAG FLIGHT', {chunks:flight.length,bytes:flightText.length,excursionsIndex:flightText.indexOf('"excursions"')});
    const entries=flightText.split(/\n(?=[0-9a-f]+:)/);
    console.log('PAGINACAO_DIAG RSC ENTRIES',entries.length,entries.map(e=>e.slice(0,35)).slice(0,12));
    for(const entry of entries){
      if(entry.includes('"excursions"')){
        const jsonText=entry.slice(entry.indexOf(':')+1).trim();
        try{
          const object=JSON.parse(jsonText);
          console.log('PAGINACAO_DIAG RSC ROOT',Object.keys(object));
          function walk(value,depth=0){
            if(depth>18 || !value || typeof value!=='object')return;
            if(Array.isArray(value)){
              if(value.length>=100)console.log('PAGINACAO_DIAG BIG ARRAY',depth,'len',value.length,'firstKeys',value[0] && typeof value[0]==='object'?Object.keys(value[0]):typeof value[0]);
              for(const v of value)walk(v,depth+1);
              return;
            }
            for(const [key,v] of Object.entries(value)){
              if(key==='excursions'){
                console.log('PAGINACAO_DIAG EXCURSIONS',Array.isArray(v),v?.length,Array.isArray(v)&&v[0]&&Object.keys(v[0]),Array.isArray(v)&&v[0]&&Object.fromEntries(Object.entries(v[0]).map(([k,val])=>[k,Array.isArray(val)?'array('+val.length+')':typeof val])));
                if(Array.isArray(v)){
                  const {telefones,chave}=require('../src/services/logistica/importacaoExcursoesUtils');
                  const seen=new Set(); const stats={withoutName:0,withoutCity:0,withoutPhone:0,duplicates:0,inactive:0};
                  for(const row of v){
                    const nome=String(row.name||'').trim(),origem=String(row.city||'').trim(),fones=telefones((row.phones||[]).map(p=>p?.phone).join(' / '));
                    if(!nome)stats.withoutName++;
                    if(!origem)stats.withoutCity++;
                    if(!fones.length)stats.withoutPhone++;
                    if(row.active===false)stats.inactive++;
                    const key=chave(nome)+'|'+chave(origem)+'|'+fones.join(',');
                    if(seen.has(key))stats.duplicates++;
                    seen.add(key);
                  }
                  console.log('PAGINACAO_DIAG PERDAS',stats);
                }
                if(Array.isArray(v)&&v[0])console.log('PAGINACAO_DIAG SHAPE',{routeFirst:v[0].route?.[0],phoneKeys:Object.keys(v[0].phones?.[0]||{}),location:v[0].localization,originCity:v[0].city,originState:v[0].state});
              }
              else if(typeof v==='object')walk(v,depth+1);
            }
          }
          walk(object);
        }catch(e){console.log('PAGINACAO_DIAG RSC JSON ERRO',e.message,jsonText.length)}
      }
    }

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
