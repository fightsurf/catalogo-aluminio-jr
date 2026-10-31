# Identificacao de contatos por telefone e LID

O WhatsApp pode mudar o identificador de um mesmo contato entre numero e `@lid`.
A documentacao da Z-API recomenda usar `chatLid` como identificador
estavel. Nao ha conversao arbitraria de `@lid` para numero.

## Fluxo implementado (sem qualquer alteracao no bot de IA)

1. Quando um webhook da Z-API chega com telefone real e `chatLid`,
   o Node salva o vinculo comprovado em `whatsapp_lid_vinculos`.
   Para mensagens recebidas (`fromMe:false`), `senderLid`
   tambem pode ser usado se `chatLid` nao estiver disponivel.
   Em mensagens enviadas, **nao** atribuir `senderLid` ao destinatario.
2. Para eventos posteriores que chegam so com `@lid`, o Node
   usa apenas vinculos ja conhecidos para exibir o telefone.
3. O Bot Admin consolida a lista e o historico de identificadores
   associados **somente na leitura**: registros originais nao sao apagados.
4. Ao lado dos telefones na lista de conversas, botao **Conferir LID**
   solicita `GET /phone-exists/{numero}` atraves do backend autenticado.
   A consulta ocorre apenas quando o administrador pede; nenhum envio e feito.
   O resultado precisa confirmar o mesmo telefone e um LID valido.
5. Se houver LID ligado a telefones diferentes, nao consolidar. Identificadores
   desconhecidos continuam separados, indicados como nao confirmados.

## Teste manual

- Receber uma mensagem de outro celular e conferir o telefone no Bot Admin.
- Enviar uma resposta pelo WhatsApp da fabrica. Caso a saida apareca como
  `@lid`, clicar em **Conferir LID** na conversa numerica do contato.
- Quando a Z-API devolver LID, as mensagens devem aparecer na conversa
  do telefone, sem alterar nenhum dado antigo.
- Se o retorno nao tiver LID, o sistema nao cria vinculo falso.
- Confirmar que o bot/boas-vindas manteve o estado anterior.

**Dependencias:** variaveis existentes `ZAPI_URL` e `ZAPI_TOKEN`.
A chave de acesso ao webhook continua independente.

Referencias:
- https://z-api-docs.vercel.app/tips/lid
- https://z-api-docs.vercel.app/contacts/get-iswhatsapp
