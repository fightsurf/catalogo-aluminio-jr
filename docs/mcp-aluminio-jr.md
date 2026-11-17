# MCP Alumínio JR — piloto de consultas (17/11/2026)

Este piloto usa o servidor Node.js existente, sem criar interface de voz ou outro aplicativo.

## Endpoints
- `POST /mcp`: MCP Streamable HTTP, protocolo 2025-06-18, resposta JSON.
- `GET /mcp/status`: diagnóstico básico, sem dados de negócio.
- `GET /mcp`: HTTP 405 (não há canal SSE por GET).

Ferramentas somente leitura: `consultar_transportadoras`, `buscar_cidades`, `listar_cidades_da_transportadora`, `transportadoras_por_cidade`.
Reutilizam serviços de logística; não há funções de criação, atualização ou exclusão. Respostas não expõem telefones nem observações.

## Teste local (Node 18+)
```bash
curl -s -X POST "http://localhost:3000/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"teste","version":"1"}}}'
curl -s -X POST "http://localhost:3000/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

## ChatGPT web
Abra Configurações > Plugins / Apps > Configurações avançadas (modo de desenvolvedor, se disponível). Crie um app/conector MCP remoto com a URL HTTPS do serviço Render acrescentada de `/mcp`, sem OAuth neste piloto. Teste uma chamada `consultar_transportadoras` e uma chamada `transportadoras_por_cidade`. A disponibilidade depende do plano e das permissões da conta.

## Atenção
**Este piloto não exige login no endpoint MCP.** Qualquer pessoa na internet capaz de acessar o endereço poderá consultar **nomes de transportadoras e cidades**. Não ative ferramentas de escrita até configurar autenticação e autorização. Remover o endpoint público ou colocar OAuth/controle de acesso é obrigatório antes de incluir pedidos, clientes, telefones ou dados sensíveis.

Para desativar rapidamente, remova `app.use('/mcp', mcpLogisticaRoutes)` do `server.js` e publique.
