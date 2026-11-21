# MCP privado de pedidos — Alumínio JR (21/11/2026)

## O que foi implementado

Foi criado um servidor MCP remoto em `POST /mcp/pedidos`, separado do MCP público de consultas em `POST /mcp`.

Ferramentas:
- `buscar_clientes` — consulta nomes e códigos no legado;
- `buscar_produtos` — consulta produtos ativos, preços e vínculo com o item legado;
- `preparar_pedido` — valida cliente, vendedor e itens, calcula total e salva **somente um rascunho** no PostgreSQL;
- `confirmar_pedido` — após confirmação explícita, executa a inserção V2 no Firebird via o serviço existente;
- `consultar_rascunho` — retorna o status da tentativa, evitando reenvios indevidos.

O rascunho dura **15 minutos** e contém um identificador UUID e um código aleatório. O servidor usa uma atualização atômica para que a mesma tentativa só seja enviada uma vez ao legado. Se o resultado da bridge for incerto, o rascunho fica em `revisao_necessaria`. **Nunca repetir automaticamente**: confira no sistema se o pedido já foi gravado.

## Regras da primeira versão

- Cliente e vendedor devem existir; o produto deve estar ativo, ser compatível com a modalidade e possuir vínculo `item_legado`.
- Preços são obtidos no cadastro do PostgreSQL. Preços informados abaixo da referência não são permitidos no MCP. Preços acima da referência são aceitos. Não calcula comissão, descontos personalizados, fretes ou preços especiais por cliente.
- O total é calculado no servidor, não fornecido pelo modelo.
- Preços são revalidados antes da gravação. Alterações no cadastro exigem preparar outro rascunho.
- O pedido usa o serviço V2 `src/services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service.js`; a disponibilidade real depende de `LEGADO_BRIDGE_URL` ou `LEGACY_FIREBIRD_API_URL` e da bridge Firebird.
- Não dispara WhatsApp por conta própria. Se houver carrada, a camada V2 pode realizar o vínculo; confira eventuais efeitos adicionais no serviço existente.
- A confirmação expressa do usuário deve ocorrer **depois** da prévia. O código de confirmação é apenas um controle técnico: não substitui controles de autorização e consentimento da plataforma.

## Segurança e implantação

**Não habilitar antes de configurar acesso seguro.** O endpoint está desabilitado por padrão e exige:
- `MCP_PEDIDOS_ENABLED=true`
- `MCP_PEDIDOS_BEARER_TOKEN=<segredo aleatório de 32 caracteres ou mais>`
- HTTPS em produção (`NODE_ENV=production`).
- Conexão ao PostgreSQL e à bridge Firebird já existentes.

O segredo **não deve ser adicionado ao GitHub nem colado em uma conversa**; use as variáveis de ambiente protegidas do Render. O servidor MCP público de logística não herda acesso a clientes ou pedidos.

A autenticação Bearer implementada atende a testes via HTTP. **Antes de usar este endpoint como um app MCP remoto no ChatGPT, verificar a exigência de OAuth 2.0 do conector e implementar o fluxo de autorização apropriado.** Não expor o token Bearer como URL pública nem desativar autenticação para contornar o conector.

## Testes HTTP controlados

Use somente dados de teste; substitua `SERVIDOR` pela URL real de HTTPS e defina o token em variável local:

```sh
export MCP_URL="https://SERVIDOR/mcp/pedidos"
export MCP_TOKEN="TOKEN_CONFIGURADO_NO_AMBIENTE"

curl -sS -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"teste","version":"1"}}}'

curl -sS -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

curl -sS -X POST "$MCP_URL" \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"buscar_clientes","arguments":{"nome":"CLIENTE DE TESTE"}}}'
```

Para executar os testes de unidade simulados, em um clone Node.js do repositório:

```sh
node --test tests/mcp-pedidos.test.js
```

Antes de permitir gravação real, testar com cliente de homologação e validar o pedido gravado na tela `/legado/pedidos`. Nenhum pedido foi criado durante o desenvolvimento.
