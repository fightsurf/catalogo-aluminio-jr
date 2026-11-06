# Piloto: transcrição de áudios do WhatsApp — Alumínio JR

## Objetivo

Um áudio enviado de **um número autorizado** à instância WhatsApp da fábrica chega pelo webhook da Z-API, é baixado no Render, transcrito pela OpenAI e exibido em uma página web. O piloto **não responde** ao remetente e **não executa ações** do sistema.

- Front-end (login administrativo): `/whatsapp/transcricoes`
- Consulta do front-end: `GET /whatsapp/transcricoes/api` (login obrigatório)
- Webhook direto Z-API existente: `POST /api/whatsapp/webhook/zapi?chave=TOKEN`
- **Webhook alternativo exclusivo para encaminhamento do n8n**: `POST /api/whatsapp/webhook/zapi/transcricao-piloto?chave=TOKEN`. Não passa pelo fluxo de atendimento, não responde, não executa comandos.

## Configuração no Render

1. `WHATSAPP_TRANSCRICAO_NUMEROS`: obrigatório. Um ou mais números WhatsApp autorizados, em formato 55 + DDD + número, separados por vírgula. Exemplo fictício: `5583999991234`. Sem esse valor, nenhuma mensagem é transcrita.
2. `OPENAI_API_KEY`: obrigatório. Pode aproveitar a chave que já está configurada no sistema para outras integrações de IA.
3. `ZAPI_WEBHOOK_TOKEN`: token existente do webhook (mínimo 32 caracteres). Não incluir segredo no GitHub.
4. `ZAPI_WEBHOOK_INSTANCE_ID` ou identificação equivalente da instância na configuração Z-API existente: necessária para filtrar callbacks de outra instância.
5. `WHATSAPP_TRANSCRICAO_MODELO`: opcional; padrão `gpt-transcribe`.
6. `WHATSAPP_TRANSCRICAO_DOMINIOS`: opcional. Por padrão são aceitos domínios de mídia `z-api.io`, `amazonaws.com`, `cloudfront.net`, `whatsapp.net`, `r2.dev`. Se o áudio real vier de outro domínio legítimo, acrescente **somente o domínio verificado da mídia**.

## Como ligar sem interromper as automações atuais do n8n

Se a Z-API ainda aponta para o n8n, **não altere o webhook principal**.

No fluxo do n8n que recebe o evento original da Z-API:

1. Acrescente um ramo independente que identifique apenas mensagens recebidas com `audio.audioUrl`, `fromMe:false`, `isGroup:false` e `isNewsletter:false`.
2. Envie um POST JSON (corpo original da Z-API; `$json.body` quando o webhook do n8n envolver o payload em `body`) ao endpoint exclusivo `/api/whatsapp/webhook/zapi/transcricao-piloto?chave=TOKEN`. Use o mesmo token seguro existente do webhook, configurado no ambiente do n8n. **Não exponha esse valor em logs**.
3. Mantenha o restante do fluxo n8n como está. A resposta do endpoint do piloto contém somente `{success:true,aceito:boolean}`.

Se a Z-API **já** aponta para o endpoint direto `/api/whatsapp/webhook/zapi`, não precisa configurar o ramo no n8n: a transcrição é iniciada pelo recebimento existente.

## Enviar áudio para o próprio número

Se o WhatsApp conectado à Z-API for o mesmo que o número autorizado, áudios enviados para a conversa consigo mesmo chegam marcados com `fromMe:true` quando a opção de notificar mensagens **enviadas por mim** estiver habilitada na Z-API. O piloto aceita somente essa conversa própria, confirmada por `connectedPhone === phone`, e rejeita outros envios de saída e mensagens enviadas pela API.

Se o número conectado na Z-API for o número comercial da Alumínio JR, diferente do número pessoal, **enviar para a própria conversa pessoal não passa pela Z-API da fábrica**. O áudio deve ser enviado ao número conectado à instância da Z-API.

O painel mostra horário, tipo (áudio/texto/outro), direção, presença de link de áudio, reconhecimento do número autorizado e instância, além dos 12 últimos callbacks. Esses dados são somente metadados voláteis: não armazena números de clientes, URL de áudio, mensagem ou credenciais. Se `connectedPhone` não vier no callback, o piloto pode aceitar um envio para si quando `phone` coincidir com a lista autorizada e `fromMe:true`, desde que a instância autenticada corresponda à da fábrica. Se não chegar webhook, confira o destino no painel da Z-API e a notificação de mensagens enviadas pelo próprio aparelho.

## Correção para mensagens @lid (06/11)

Quando o webhook entrega o áudio com `phone: "...@lid"` e `connectedPhone` informa o número autorizado, **não é seguro** presumir que a conversa é consigo mesmo: `connectedPhone` é a conta que enviou, não o destinatário.

O piloto verifica a identidade do destinatário pela chamada já existente `conferirNumero` (`GET /phone-exists/{numero}` da Z-API), para o **único número da lista permitida**, apenas no evento `fromMe:true`, `fromApi:false`, em conversa individual e na instância esperada. Só aceita o áudio se a API retornar o mesmo telefone, o mesmo LID recebido no webhook e uma confirmação sem conflito no banco. Se não houver LID confirmado, não transcreve (falha fechada).

A chamada ocorre de forma assíncrona no webhook principal, sem atrasar os comandos de clientes. O painel mostra `Verificação LID: Confirmado`, `LID não corresponde` ou `Falha ao consultar Z-API`. Conferir `ZAPI_URL` e `ZAPI_TOKEN` caso a consulta falhe. Não armazenar o LID nos eventos expostos no frontend.

## Diagnóstico de callbacks e resolução independente (06/11)

O webhook autenticado inicia o processamento do piloto logo após validar o payload e a instância, **antes** das consultas de contatos, dos eventos de bot e dos comandos comerciais. A verificação não deve depender da conclusão do atendimento normal; o fluxo do bot permanece como estava, sem transcrição duplicada.

O diagnóstico agora exibe se `connectedPhone` pertence aos números autorizados (sem expor o valor), mais resultados `Evento descartado`, `Instância divergente` e `Erro ao iniciar`. Uma verificação LID que ficar presa terá prazo total de até 25 segundos, exibindo `Falha/timeout` em vez de permanecer indefinidamente em `Verificando`.

A conclusão da verificação ainda exige comprovação do LID pelo endpoint `phone-exists`: o número conectado, sozinho, não comprova que o áudio foi enviado para si mesmo.

## Divergência do connectedPhone (06/11)

A Z-API documenta `connectedPhone` como o telefone conectado à instância. Mesmo quando `fromMe:true`, `phone` pode conter um LID que identifica a conversa, não necessariamente a própria conta. Para não liberar transcrição de outros destinatários, o piloto exige que `connectedPhone` seja o telefone autorizado e que `phone` corresponda ao LID confirmado pela Z-API.

O painel de diagnóstico agora mostra apenas a **terminação de quatro dígitos, a quantidade de dígitos e o formato** de `connectedPhone`, além do mesmo resumo da lista autorizada. Por exemplo, `****2085 (13 dígitos)` versus `****2085 (12 dígitos)` mostra uma diferença de formatação/número sem expor os telefones inteiros. Se o formato for LID/JID/outro, o sistema não transforma arbitrariamente seu identificador em telefone. É preciso confirmar a identidade pela Z-API antes de alterar a autorização.

## Teste

1. Abra `https://catalogo-aluminio-jr.onrender.com/whatsapp/transcricoes` autenticado.
2. Confira o indicador "Preparado". Se mostrar configuração pendente, revise a variável listada.
3. Envie um áudio do número autorizado ao WhatsApp da fábrica. Diga: "Quanto vendemos hoje?".
4. A tela deve mostrar número, horário, "Transcrevendo" e, em seguida, "Quanto vendemos hoje?".
5. Faça um teste com número não autorizado; ele não deve aparecer.
6. Se o áudio não chegar, verifique o encaminhamento n8n ou o webhook direto. Se aparecer "Falha", examine o aviso da tela e o domínio da mídia.

## Privacidade e limites

- Mensagens individuais de número autorizado e, excepcionalmente, mensagens do número conectado enviadas a si mesmo.
- Sem persistência em PostgreSQL, sem salvar arquivo de áudio; lista em memória por até 2 horas (60 eventos no máximo).
- Reinício ou novo deploy apagam o histórico. Em múltiplas instâncias do Render, o monitor deve ser consultado na mesma instância que processou o evento; este MVP não sincroniza entre réplicas.
- Tamanho máximo de 20 MB por áudio. Fila sequencial de até 15 pendentes. Download e transcrição possuem timeouts.
- Evita registrar payload, link do áudio e credenciais nos logs.
- A transcrição pode ter erro de reconhecimento. Nenhuma consulta ao Firebird/PostgreSQL é executada nesta fase.
- A cobrança da API de transcrição depende da conta OpenAI e do uso real.

## Verificação local

```bash
node --test tests/transcricoes-piloto.test.js
```
