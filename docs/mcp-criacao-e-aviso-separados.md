# Criação de pedido e aviso de carrada — MCP 1.3.0

## Problema e evidência

A confirmação de criação passou a reunir duas ações com efeitos diferentes:
gravar o pedido no sistema privado e enviar uma mensagem ao cliente. Um bloqueio
da chamada combinada no cliente impedia ambas antes de a confirmação chegar ao
servidor. Permissões OAuth concedidas e o modo de permissão do plugin, sozinhos,
não identificam nem removem uma rejeição de segurança do cliente.

A comparação das versões mostrou que as gravações bem-sucedidas anteriores
ocorreram antes da inclusão do aviso automático. Isso identifica uma mudança
relevante, mas não comprova a regra interna responsável pela rejeição: essa
regra não aparece nos registros do servidor.

## Fluxo atual

1. Buscar cliente, vendedor, produtos e a carrada pela data informada.
2. `preparar_pedido` apresenta itens, preço negociado, total e carrada. Informa
   que a confirmação grava o pedido sem enviar WhatsApp.
3. Após aprovação expressa, `confirmar_pedido` chama a Inserção V2 uma única vez,
   com `aviso_whatsapp_carrada: false`. A resposta distingue pedido gravado e
   aviso ainda não enviado.
4. Se o aviso foi solicitado e o vínculo da carrada foi confirmado, preparar
   `preparar_whatsapp_pedido` com o `id_mestre` real e `tipo: aviso_carrada`.
   Se o legado retornar somente o número, consultar o pedido para obter o ID.
5. Apresentar cliente, telefone, data e descrição da carrada e o texto exato.
   Após aprovação expressa dessa prévia, usar `confirmar_whatsapp_pedido`.
6. Em falha do aviso, consultar a ação. O pedido permanece gravado; não repetir
   gravação ou mensagem automaticamente. Aceite do provedor não é entrega.

O aviso reutiliza o mesmo construtor de texto da Inserção V2. O fluxo da tela
continua podendo solicitar seu aviso automático. A separação aplica-se à
criação pelo MCP; os efeitos declarados de alteração e expedição continuam
nos respectivos contratos.

## Permissões e limites

| Operação | Escopos | Efeito |
| --- | --- | --- |
| Preparar/confirmar pedido | `clientes:read pedidos:write` | Rascunho ou pedido/carrada, sem mensagem |
| Preparar aviso de carrada | `clientes:read whatsapp:send` | Prévia persistente sem envio |
| Confirmar aviso | `clientes:read whatsapp:send` | Um envio ao cliente verificado |

`confirmar_pedido` declara escrita aditiva e `openWorldHint: false` porque o
envio foi removido de fato. `confirmar_whatsapp_pedido` declara escrita,
`destructiveHint: true` e `openWorldHint: true`, porque uma mensagem enviada
não pode ser desfeita pelo MCP. As anotações não substituem autorização,
confirmação ou a revisão de ações do cliente.

Novos rascunhos usam `versao_fluxo: 2`. Prévia da versão anterior não pode
acionar o antigo envio combinado pela nova confirmação: deve ser refeita.
Expiração de 15 minutos, reserva atômica e proteção contra repetição continuam.

O aviso congela e revalida pedido, destinatário, carrada e texto antes de enviar.
Não admite telefone arbitrário nem texto personalizado no tipo `aviso_carrada`.
A Central de WhatsApp e o registro persistente do progresso permanecem ativos.

## Diagnóstico

As respostas de ferramentas incluem `_meta.aluminiojr/versao` e um identificador
de rastreio. Os registros `[mcp/auditoria]` guardam versão, ferramenta, rastreio
e etapa: chegada, escopo insuficiente, parâmetros inválidos, resultado ou erro.
Não incluem argumentos, cliente, telefone, tokens ou códigos de confirmação.

Uma chamada negada antes de alcançar o servidor não produz esse registro.
A ausência de uma etapa de ferramenta, isoladamente, não comprova esse cenário:
a requisição também pode parar na autenticação ou na validação do protocolo.
A partir da versão 1.3.1, recusas de autenticação têm rastreio próprio nos logs,
na resposta e nos headers `X-MCP-Rastreio` e `X-MCP-Versao`.
Correlacionar horário e rastreio com a mensagem exata do cliente e os logs HTTP;
não interpretar HTTP 200 como sucesso da operação nem repetir uma ação de
resultado incerto. Ver [estabilidade e diagnóstico de 23/11](mcp-estabilidade-20261123.md).

## Validação e publicação

Os testes isolados verificam gravação sem envio mesmo com carrada, preços
negociados, expiração, execução única, rejeição do rascunho antigo, prévia exata
do aviso, alterações de destinatário/carrada, falhas de envio, escopos e logs
sem dados sensíveis. Não usam clientes, pedidos ou mensagens reais.

Após publicar, verificar a versão e uma consulta autenticada. Se o catálogo
da conversa ainda mostrar o contrato combinado antigo, atualizar as ferramentas
pela interface suportada do plugin. Uma publicação bem-sucedida e testes
isolados não comprovam que uma nova gravação será aprovada pelo ChatGPT: a
validação final exige um próximo pedido real autorizado, sem criar pedidos
fictícios em produção.

Referências oficiais:

- [Definição de ferramentas e separação de efeitos](https://developers.openai.com/plugins/plan/tools).
- [Permissões de apps e limites das aprovações](https://help.openai.com/en/articles/20001495-managing-app-permissions-in-chatgpt).
