# Limite de uploads no Status Vídeos

O Status Vídeos reconhece `uploadLimitExceeded` no início da sessão e na resposta
do upload. A API mantém o motivo estruturado e o HTTP da resposta; a mensagem
legada exata também é reconhecida. `quotaExceeded`, erros de autenticação e
outros HTTP 400 continuam sendo falhas distintas.

## Comportamento

- Uma rejeição real por limite grava uma pausa de 24 horas no PostgreSQL.
- Outros vídeos da mesma conexão aguardam essa pausa sem chamar o YouTube.
- Consultar o resultado ou percorrer a fila não estende a espera.
- O worker verifica pendências a cada minuto e também ao iniciar o serviço.
- A tentativa posterior recupera o vídeo final já salvo no R2 e publica somente
  no YouTube. Os resultados e identificadores das outras redes são preservados.
- Nova rejeição real por limite inicia outra pausa de 24 horas. Esse prazo é uma
  política de nova tentativa, não uma garantia de liberação do YouTube.
- A tela mostra o aviso amarelo com a próxima tentativa em horário de Brasília.
  “Consultar última publicação” recupera o resultado após atualizar a página.

O Republicador YouTube atual consulta/baixa vídeos do canal e publica no WhatsApp,
Instagram e Facebook. Ele não chama a API de upload do YouTube; portanto esse
limite de envio não se aplica a seu fluxo atual.

## Persistência e envio sem confirmação

As tabelas `youtube_upload_fila` e `youtube_upload_pausas` são criadas de forma
idempotente pelo serviço. A chave do trabalho é `(origem, request_id)`. O ID do
canal configurado identifica a pausa; sem ID, usa-se um hash da conexão OAuth,
sem armazenar as credenciais. Trocar essa identidade impede que pendências
antigas sejam enviadas para uma conta diferente.

Bloqueios de sessão no PostgreSQL serializam os uploads por canal. O estado de
envio é gravado antes da transmissão. Se a instância cair durante um envio ou
não conseguir gravar sua confirmação, a retomada marca o resultado como
`incerto`; não envia outra cópia automaticamente. Erros explícitos de limite
podem ser reagendados porque indicam rejeição da publicação.

O contexto das quatro outras redes é guardado antes da primeira tentativa no
YouTube. Sua recuperação funciona após reiniciar o Render ou expirar o cache
de duas horas. A fila não oferece uma reserva do pipeline anterior ao YouTube:
interrupções durante o processamento inicial das outras redes continuam
exigindo conferência. Erros ocorridos antes desta versão não são migrados do
cache volátil para a nova fila.

O MP4 de `status-videos/` permanece no R2; apenas arquivos locais temporários
são removidos. A retomada aceita HTTPS no domínio e prefixo R2 configurados,
sem redirecionamentos, com download em fluxo limitado a 250 MB.

## Validação

Testes isolados, sem publicação externa:

```sh
node --test tests/youtube-upload-limit.test.js tests/youtube-fila.test.js tests/status-videos-youtube.test.js tests/republicador-youtube-local.test.js tests/agendamento-unificado.test.js tests/funil-agendadores-recuperacao.test.js
```

Eles cobrem os dois pontos de rejeição do upload, prazo, persistência,
concorrência, recuperação do R2, não repetição de destinos, falhas de banco,
resultados incertos e apresentação do aviso na interface.

Referências oficiais:

- [Erros da YouTube Data API](https://developers.google.com/youtube/data/reference/rest/v3/errors)
- [Erros comuns de envio e recomendação de nova tentativa em 24 horas](https://support.google.com/youtube/answer/10383400?hl=pt-BR)
