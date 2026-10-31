# Webhook direto da Z-API — Alumínio JR

## Etapa 1: recebimento e registro (sem automações)

O backend Node.js aceita payload **original** do evento **Ao receber** da Z-API.
Não usa a estrutura `body` do n8n. A rota **não executa comandos,
não envia mensagens e não aciona o atendimento automático**.

- Endpoint POST: `https://catalogo-aluminio-jr.onrender.com/api/whatsapp/webhook/zapi?chave=SEU_SEGREDO`
- Teste de implantação (GET): a mesma URL retorna `success:true` quando o segredo está configurado e correto. Não testa o banco.
- Render > Environment: criar `ZAPI_WEBHOOK_TOKEN` com valor aleatório de **pelo menos 32 caracteres**. Nunca gravar esse valor no GitHub, em prints ou em arquivos públicos.
- Opcional: configurar `ZAPI_WEBHOOK_INSTANCE_ID` com o ID da instância esperado para bloquear registros acidentais de outras instâncias.
- O segredo pode ser fornecido também em `x-zapi-webhook-token` no header, mas para o campo **Ao receber** da Z-API foi prevista a URL com `?chave=`.

### Comportamento

1. Aceita eventos `ReceivedCallback` tanto com `fromMe:false` (clientes) quanto com `fromMe:true` (mensagens enviadas pelo próprio número, inclusive comandos como `@frete`). A direção é armazenada como `ENTRADA` ou `SAIDA`.
2. Extrai `phone`, `instanceId`, `messageId` e o texto ou uma descrição de mídia.
3. Ignora eventos de status, notificações, mensagens próprias e payloads incompletos.
4. Adiciona as colunas `zapi_instancia`, `zapi_message_id` e índice único parcial à tabela já existente `bot_mensagens`. As alterações são idempotentes.
5. Registra a mensagem em `bot_mensagens`, atualiza `bot_contatos` e comunica o painel por WebSocket.
6. Eventos com o mesmo par (instância, messageId) são ignorados, sem duplicar registro.
7. As novas mensagens entram com `processada_ia=true` e a notificação usa `somentePainel=true`, evitando o disparo de IA, primeiro contato e fluxos. Esta etapa **registra** comandos enviados por você, mas **não os executa**.
8. O painel `/bot/admin` mantém a coluna de contatos à esquerda e as mensagens da conversa à direita. Exibe um resumo do webhook acima da conversa e detalhes opcionais dos últimos eventos.

### Teste sem trocar o webhook atual

Após o deploy, conferir o GET autenticado para validar a rota. Depois enviar POST de teste com um `messageId` exclusivo e telefone de teste. Verificar em `bot_mensagens`/painel. Repetir a mesma requisição deve resultar em `motivo:duplicada`. Testar token inválido (401) e ausente no Render (503).

Exemplo **sem** credenciais reais:

```bash
curl -X POST "https://catalogo-aluminio-jr.onrender.com/api/whatsapp/webhook/zapi?chave=SEU_SEGREDO" \
  -H "Content-Type: application/json" \
  -d '{"type":"ReceivedCallback","instanceId":"INSTANCIA_TESTE","messageId":"TESTE_UNICO_1","phone":"5511999999999","fromMe":false,"text":{"message":"Teste de recebimento"}}'
```

### Atenção: não trocar ainda o endereço na Z-API

O endereço atual da Z-API aponta para o n8n, onde também são processados
`@preco`, `@frete`, `@volume`, `@cidades`, `@kits-hoje`,
`@kits-ontem` e relatórios recebidos.

**Alterar o campo Ao receber agora interromperá essas funções** até que sejam
migradas para o Node.js. Não configurar dois processadores que possam gerar
respostas duplicadas. A troca será a etapa posterior, após os testes.

A exportação antiga do n8n incluiu tokens da Z-API diretamente em URLs e
headers. Rotacionar essas credenciais, sem copiá-las para o repositório.
