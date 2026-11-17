'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {EventEmitter}=require('node:events');

const source=fs.readFileSync(path.join(__dirname,'../src/services/mala-direta/mala-direta-audio-gravado.service.js'),'utf8');
function servico(){
  const mod={exports:{}};
  const spawn=()=>{
    const proc=new EventEmitter();
    proc.stdout=new EventEmitter();proc.stderr=new EventEmitter();
    proc.stdin={on(){},end(){
      queueMicrotask(()=>{
        proc.stdout.emit('data',Buffer.alloc(1200,0x55));
        proc.emit('close',0);
      });
    }};
    proc.kill=()=>{};
    return proc;
  };
  const falsoRequire=nome=>nome==='child_process'?{spawn}:nome==='ffmpeg-static'?'/ffmpeg-teste':require(nome);
  new Function('require','module',source)(falsoRequire,mod);
  return mod.exports;
}
const ogg=()=>({originalname:'audio_do_whatsapp.ogg',mimetype:'application/octet-stream',
  buffer:Buffer.concat([Buffer.from('OggS'),Buffer.alloc(1200)])});

test('OGG importado é convertido e mantém origem arquivo',async()=>{
  const audio=await servico().converter(ogg(),{origem:'arquivo'});
  assert.equal(audio.origem,'arquivo');
  assert.equal(audio.formato,'audio/mpeg');
  assert.equal(audio.modelo,'upload');
  assert.equal(audio.bytes.length,1200);
});

test('Rejeita arquivo OGG com assinatura inválida',async()=>{
  const arquivo=ogg();arquivo.buffer.fill(0,0,4);
  await assert.rejects(servico().converter(arquivo,{origem:'arquivo'}),/não contém áudio OGG válido/);
});

test('Rejeita extensão diferente de .ogg',async()=>{
  const arquivo=ogg();arquivo.originalname='audio.mp3';
  await assert.rejects(servico().converter(arquivo,{origem:'arquivo'}),/arquivo \.OGG/);
});

test('Gravação de microfone mantém comportamento anterior',async()=>{
  const audio=await servico().converter({mimetype:'audio/webm',buffer:Buffer.alloc(1200)});
  assert.equal(audio.origem,'gravacao');
  assert.equal(audio.voz,'microfone');
  assert.equal(audio.formato,'audio/mpeg');
});
