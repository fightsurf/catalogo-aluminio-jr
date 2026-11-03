'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const agenda=fs.readFileSync(path.join(root,'src/services/marketing/agendadorModulos.service.js'),'utf8');
const funil=fs.readFileSync(path.join(root,'src/services/marketing/funilPublicacoes.service.js'),'utf8');
const republicador=fs.readFileSync(path.join(root,'src/services/marketing/republicador-youtube.service.js'),'utf8');

test('agendadores somente bloqueiam por trabalhos ativos, nao por revisao',()=>{
  assert.match(agenda,/i\.estado IN \('pendente','executando','aguardando_retry','aguardando_video'\) LIMIT 1/);
  assert.match(agenda,/pend\.estado IN \('incerto','atencao','pendente','executando','aguardando_retry','aguardando_video'\)/);
  assert.match(agenda,/sem_confirmacao/);
  assert.match(agenda,/NOT EXISTS\(SELECT 1 FROM marketing_fila_itens pend/);
  assert.match(agenda,/if\(v\)cicloSelecionado=proximoCiclo/);
  assert.match(agenda,/SET ativo=FALSE,proxima_execucao=NULL,ultimo_erro=\$2/);
});

test('agendamento autorizado inclui kits legados, mas nunca reenvia canal incerto automaticamente',()=>{
  assert.match(funil,/if\(item\.origem==='ofertas_agenda'\)/);
  assert.match(funil,/comparacao_pendente/);
  assert.match(funil,/COALESCE\(o\.whatsapp_status,'nao_publicado'\)='nao_publicado'/);
  assert.match(funil,/j\.atualizado_em < NOW\(\)-INTERVAL '2 minutes'/);
  assert.match(funil,/AND COALESCE\(j\.canais->'facebook_feed'->>'status','pendente'\)='pendente'/);
});

test('republicador detecta partes incertas e impede repeticao cega',()=>{
  const m={exports:{}};
  vm.runInNewContext(republicador,{
    module:m,require:()=>({}),process:{env:{}},console,Date,Buffer,setInterval,setTimeout
  });
  const fn=m.exports.haEnvioSemConfirmacao;
  assert.equal(fn({whatsapp_status:{status:'pendente',partes:{}},facebook_feed:{status:'publicado'}}),false);
  assert.equal(fn({whatsapp_status:{status:'processando',partes:{0:{status:'enviando'}}}}),true);
  assert.equal(fn({instagram_story:{status:'incerto',partes:{0:{status:'publicado'},1:{status:'incerto'}}}}),true);
  assert.equal(fn({whatsapp_status:{status:'publicado',partes:{0:{status:'publicado'}}}}),false);
  assert.match(republicador,/atual\.partes\[i\]=\{status:'enviando'\}/);
  assert.match(republicador,/if \(haEnvioSemConfirmacao\(job\.canais\)\)/);
});
