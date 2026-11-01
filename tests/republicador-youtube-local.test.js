'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const api=require('../src/services/marketing/republicador-youtube.local');
const vid='OgrghBjn_jc';
const id='12345678-abcd-1234-abcd-123456789abc';
const mp4=Buffer.from('000000186674797069736f6d0000000069736f6d','hex');
const prevFetch=global.fetch,prevUrl=process.env.LEGADO_BRIDGE_URL,prevKey=process.env.LEGADO_BRIDGE_API_KEY;
const job=(estado,more={})=>({success:true,data:{id,video_id:vid,estado,etapa:'Teste local',...more}});
const js=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json'}});
async function mock(fetchMock,fn){
  process.env.LEGADO_BRIDGE_URL='https://tunnel.test';
  process.env.LEGADO_BRIDGE_API_KEY='chave-teste';
  global.fetch=fetchMock;
  try{await fn();}
  finally {
    global.fetch=prevFetch;
    if(prevUrl===undefined)delete process.env.LEGADO_BRIDGE_URL;else process.env.LEGADO_BRIDGE_URL=prevUrl;
    if(prevKey===undefined)delete process.env.LEGADO_BRIDGE_API_KEY;else process.env.LEGADO_BRIDGE_API_KEY=prevKey;
  }
}
test('baixa MP4 local através da API e não publica',async()=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'jr-yt-test-'));
  try {
    await mock(async(url,opts)=>{
      assert.equal(opts.redirect,'error');
      assert.equal(opts.headers['x-api-key'],'chave-teste');
      if(url.endsWith('/jobs'))return js(job('aguardando'));
      if(url.endsWith('/jobs/'+id))return js(job('pronto',{bytes:mp4.length}));
      if(url.endsWith('/arquivo'))return new Response(mp4,{headers:{'content-type':'video/mp4','content-length':String(mp4.length)}});
      throw new Error('URL inesperada');
    },async()=>{
      const file=await api.baixarVideo(vid,dir);
      assert.deepEqual(await fsp.readFile(file),mp4);
    });
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
});
test('erro no download não produz MP4',async()=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'jr-yt-test-'));
  try {
    await mock(async url=>url.endsWith('/jobs')?js(job('aguardando')):js(job('erro',{erro:'Falha simulada'})),async()=>{
      await assert.rejects(api.baixarVideo(vid,dir),/Falha simulada/);
      assert.deepEqual(await fsp.readdir(dir),[]);
    });
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
});
test('rejeita tamanho excessivo e conexão insegura',async()=>{
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'jr-yt-test-'));
  try {
    await mock(async url=>{
      if(url.endsWith('/jobs'))return js(job('aguardando'));
      if(url.endsWith('/jobs/'+id))return js(job('pronto',{bytes:mp4.length}));
      return new Response(mp4,{headers:{'content-type':'video/mp4','content-length':String(251*1024*1024)}});
    },async()=>{
      await assert.rejects(api.baixarVideo(vid,dir),/250 MB/);
      process.env.LEGADO_BRIDGE_URL='http://192.168.1.10:3007';
      await assert.rejects(api.baixarVideo(vid,dir),/HTTPS/);
    });
  }finally{await fsp.rm(dir,{recursive:true,force:true});}
});
test('diagnóstico consulta worker sem publicar',async()=>{
  await mock(async()=>js({success:true,data:{node:'v24',yt_dlp:'2026.10.26',youtube_channel_id_configurado:true}}),async()=>{
    const r=await api.diagnostico();
    assert.equal(r.acessivel,true);
    assert.equal(r.canal_configurado,true);
  });
});
