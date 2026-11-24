# Contrato das ferramentas e protocolo — MCP 1.4.1

## Correções

- As 26 ferramentas do endpoint autenticado `/mcp/clientes` passam a declarar
  `outputSchema` para o JSON devolvido em `structuredContent`. As quatro consultas
  públicas de `/mcp` usam os mesmos contratos de logística. O JSON em `content`
  continua disponível para clientes que usam a representação textual.
- As quatro consultas de logística passam a declarar `openWorldHint: false`.
  Todas as ferramentas publicadas têm os três booleanos explícitos:
  `readOnlyHint`, `destructiveHint` e `openWorldHint`. As classificações existentes
  de criação, alteração, cancelamento, expedição e WhatsApp são preservadas.
- Os dois endpoints validam `params.protocolVersion` na inicialização e o
  cabeçalho `MCP-Protocol-Version` antes de executar ferramentas ou aceitar
  notificações. A única revisão anunciada é `2025-06-18`.
- O endpoint autenticado passa a anunciar `tools.listChanged: false`, assim como
  o público. Não existe um stream que entregue notificações de mudança de catálogo.

O servidor autenticado identifica esta alteração como `1.4.1` em `serverInfo`,
`X-MCP-Versao` e `_meta`. O servidor público passa para `0.1.1`.

## Negociação e compatibilidade

Um `initialize` com a revisão implementada a recebe de volta. Uma proposta de
outra revisão em formato de data válido recebe `2025-06-18`; cabe ao cliente
aceitar a revisão oferecida ou encerrar a conexão. Parâmetros ausentes ou uma
versão malformada são rejeitados como parâmetros inválidos. `initialize`
precisa ser uma requisição JSON-RPC com ID.

Um cabeçalho explícito inválido ou não suportado recebe HTTP 400, inclusive em
GET, DELETE e notificações. Não há despacho de ferramenta nessa situação.
Os controles OAuth continuam sendo executados antes de qualquer acesso ao
endpoint autenticado.

Por compatibilidade com clientes já conectados, a ausência do cabeçalho continua
sendo tolerada sob o contrato implementado de junho. Esta é uma exceção
intencional à recomendação `SHOULD` de assumir `2025-03-26` quando não se conhece
a versão. Não anunciamos suporte completo a março: essa revisão exige batches,
que estas rotas não implementam. Também não anunciamos revisões posteriores sem
implementar seus respectivos contratos.

## Formatos de saída e efeitos

Os schemas documentam campos garantidos e variantes reais: listas vazias,
homônimos, dados ausentes do legado, confirmação já consumida, resultado parcial
e revisão necessária. Campos heterogêneos do legado continuam extensíveis.
Datas de banco são avaliadas na forma JSON transmitida.

Não foi acrescentada uma validação de saída que possa transformar uma escrita
já concluída em uma nova falha. A compatibilidade do contrato é verificada pelos
testes com retornos dos serviços. Erros operacionais mantêm `isError: true`, sem
inventar um resultado estruturado de sucesso.

A mudança não concede escopos OAuth, não altera os controles de confirmação,
não cria pedidos de teste e não envia mensagens. As annotations descrevem os
efeitos; não substituem os controles de autorização.

## Verificação e publicação

```bash
node --test tests/mcp-*.test.js tests/pedidos-insercao-v2-aviso-mcp.test.js tests/relatorio-fotos-previa.test.js
```

Os testes cobrem os contratos de saída, a negociação, o bloqueio antes dos
serviços, a separação de permissões, a idempotência e a manutenção do endpoint
público somente para consultas. A rotina de CI executa esses testes.

O Render acompanha a branch `main`. Após a publicação, verificar o deploy do
commit exato, a versão do servidor, o catálogo público e uma consulta autenticada
sem efeitos. Atualizar o catálogo do plugin no ChatGPT pelo fluxo de Refresh
quando necessário; `listChanged: false` não atualiza um catálogo em cache.

Estas correções eliminam inconsistências identificadas no contrato. Elas não
comprovam que toda recusa do avaliador de autorização tinha a mesma causa, nem
substituem a verificação de um próximo pedido realmente solicitado pelo usuário.

## Referências

- [MCP 2025-06-18 — negociação](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
- [MCP 2025-06-18 — cabeçalho do protocolo](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP 2025-06-18 — ferramentas, saída estruturada e listChanged](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [OpenAI — referência de annotations](https://developers.openai.com/plugins/reference)
