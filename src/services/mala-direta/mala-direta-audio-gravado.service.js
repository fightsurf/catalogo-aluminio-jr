'use strict';
// Converte gravações MediaRecorder (WebM/Opus, Ogg, MP4) para MP3 antes de usar na Z-API.
// Nada é gravado em disco; o áudio de campanha é persistido uma vez em PostgreSQL.
const {spawn} = require('child_process');
const ffmpegPath = process.env.FFMPEG_PATH || require('ffmpeg-static');
const LIMITE_ENTRADA = 6 * 1024 * 1024;
const LIMITE_SAIDA = 5 * 1024 * 1024;

function erro(mensagem, status=400) {const e=new Error(mensagem);e.status=status;return e;}
async function converter(arquivo) {
  if(!arquivo || !Buffer.isBuffer(arquivo.buffer) || !arquivo.buffer.length)throw erro('Gravação não recebida.');
  if(arquivo.buffer.length>LIMITE_ENTRADA)throw erro('Áudio excedeu 6 MB.',413);
  const tipos=['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/x-m4a','audio/m4a'];
  if(!tipos.some(t=>arquivo.mimetype?.toLowerCase().startsWith(t)))throw erro('Formato de gravação não suportado. Use Chrome ou Edge atualizado.');
  if(!ffmpegPath)throw erro('Conversor de áudio não instalado no servidor.',503);
  return new Promise((resolve,reject)=>{
    let terminado=false,excedeu=false,expirou=false;
    const proc=spawn(ffmpegPath,[
      '-hide_banner','-loglevel','error','-nostdin',
      '-i','pipe:0','-vn','-ac','1','-ar','44100','-b:a','64k',
      '-t','180','-f','mp3','pipe:1'
    ],{stdio:['pipe','pipe','pipe']});
    const partes=[];let tamanho=0,detalhe='';
    const timer=setTimeout(()=>{expirou=true;proc.kill('SIGKILL');},30000);
    const finalizar=(e,resultado)=>{
      if(terminado)return;terminado=true;clearTimeout(timer);
      if(e)reject(e);else resolve(resultado);
    };
    proc.stdout.on('data',parte=>{
      tamanho+=parte.length;
      if(tamanho>LIMITE_SAIDA){excedeu=true;proc.kill('SIGKILL');}
      else partes.push(parte);
    });
    proc.stderr.on('data',parte=>{detalhe=(detalhe+parte.toString()).slice(-600);});
    proc.on('error',e=>finalizar(erro('Falha ao iniciar conversão do áudio.',503)));
    proc.on('close',code=>{
      if(expirou)return finalizar(erro('Tempo limite de conversão excedido.',503));
      if(excedeu)return finalizar(erro('Gravação maior que o limite de áudio MP3.',413));
      if(code!==0||tamanho<1024)return finalizar(erro('Não foi possível converter a gravação para MP3. Verifique se o áudio foi capturado.'));
      finalizar(null,{bytes:Buffer.concat(partes),voz:'microfone',modelo:'gravacao',texto:'',formato:'audio/mpeg',origem:'gravacao'});
    });
    proc.stdin.on('error',()=>{}); // FFmpeg pode fechar a entrada antes do fim de um arquivo inválido.
    proc.stdin.end(arquivo.buffer);
  });
}
module.exports={converter};
