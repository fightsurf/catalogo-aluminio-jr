# Pedidos por voz no mesmo MCP Alumínio JR

> Atualização de 22/11/2026: o pacote de consulta e gestão de pedidos, WhatsApp e expedição está descrito em [mcp-alteracoes-acumuladas-20261122.md](mcp-alteracoes-acumuladas-20261122.md), incluindo os novos escopos e os testes. As restrições de escopo da versão inicial abaixo são históricas.

## Escopo

O endpoint atual **POST /mcp/clientes** continua sendo o único plugin autenticado.
As ferramentas existentes de clientes, cidades e excursões continuam funcionando.
A integração adiciona `buscar_produtos`, `buscar_vendedores`, `preparar_pedido`,
`confirmar_pedido` e `consultar_rascunho`. Não existe novo plugin de pedidos.

Um pedido simples envolve: identificar cliente por nome/código, localizar produto
e preço cadastrado, informar quantidades, escolher vendedor válido, criar a prévia,
ler o resumo ao usuário e **somente após autorização expressa em um turno seguinte**
gravar no Firebird por meio do serviço existente de pedidos V2.

- `preparar_pedido` valida cliente, vendedor, produtos, quantidades, perfil e preço;
  calcula o total e grava somente rascunho temporário no PostgreSQL (15 minutos).
- `confirmar_pedido` grava o pedido legado exatamente uma vez mediante ID e
  código de confirmação do rascunho. Em erro incerto, não repete a gravação.
- Nenhum desconto abaixo do preço de referência é permitido.
- A consulta de vendedores é necessária porque o pedido V2 exige vendedor real.
- O tipo padrão é `orcamento`; `kit-feirinha` fica disponível quando solicitado.
- Nenhum envio de mensagem WhatsApp é feito automaticamente pelo MCP.
- Os controles não substituem a revisão de efeitos colaterais da bridge V2
  nem uma prova de integração com banco real.

## Segurança

As ferramentas de leitura usam o escopo OAuth `clientes:read`. Os rascunhos,
suas consultas e a gravação exigem **também `pedidos:write`**.
O plugin usa o login administrativo atual e pede autorização OAuth ampliada
quando a operação de escrita necessita de escopo adicional.

`MCP_PEDIDOS_ENABLED=true` controla a disponibilidade das ferramentas de
pedido. O valor padrão é DESATIVADO. Não configurar
`MCP_PEDIDOS_BEARER_TOKEN`: o mesmo endpoint já possui OAuth, e a
implementação antiga do PR #101 /mcp/pedidos não deve ser publicada.

O servidor agora emite `refresh_token` rotativo durante a troca de
`authorization_code`, mesmo quando o ChatGPT solicita apenas
`clientes:read`. O token de acesso continua válido por 15 minutos;
a renovação automática depende de o cliente utilizar o refresh token.
Confirmar na prática após mais de 15 minutos sem nova conexão.

## Validação e publicação

1. Rodar `node --test tests/mcp-consulta-clientes.test.js tests/mcp-consultas-detalhadas.test.js tests/mcp-pedidos.test.js`.
2. Verificar que `tools/list` com feature flag desligada permanece somente leitura.
3. Revisar a autenticação adicional `pedidos:write` e o consentimento de gravação.
4. Publicar o código no Render no workspace de produção após CI.
5. **Antes de ligar a flag**, executar ensaios da ponte Firebird de homologação,
   confirmando número de pedido, status, vendedor, itens, total e efeitos no sistema.
6. Ativar `MCP_PEDIDOS_ENABLED=true` somente após esses ensaios.
7. Atualizar ferramentas do plugin Alumínio JR no ChatGPT, autorizar
   `pedidos:write` e testar o pedido por voz com um cliente/produto controlados.
8. Confirmar log de renovação OAuth e uma consulta após 15 minutos.

Não declarar que pedidos em produção estão funcionando até concluir uma
gravação controlada e confirmar o pedido na tela do sistema legado.
