# Pedidos por voz no mesmo MCP Alumínio JR

> Atualização de 23/11/2026, MCP 1.3.0: a criação grava pedido e carrada sem enviar WhatsApp. O aviso de entrada usa uma prévia e confirmação próprias, conforme [mcp-criacao-e-aviso-separados.md](mcp-criacao-e-aviso-separados.md). Consulta, edição, cancelamento e expedição continuam descritos em [mcp-alteracoes-acumuladas-20261122.md](mcp-alteracoes-acumuladas-20261122.md).

## Carrada pela data no momento de preparar o pedido

O mesmo plugin agora expõe `buscar_carradas`, somente leitura e com escopo
`clientes:read`. Quando o usuário informar a carrada pela data, o assistente
deve fazer essa consulta ao preparar **cada novo pedido**, antes de chamar
`preparar_pedido`. A data da carrada não deve ser confundida com `data`, que
na preparação continua sendo a data de cadastro do pedido.

A ferramenta recebe `data` em `AAAA-MM-DD`, `descricao` opcional e
`pagina`/`limite` para consultar até 30 resultados por página. Reutiliza
`carradasService.listarCarradas({ incluirResumoProducao: false })`, a mesma
consulta que abastece a lista da Inserção V2, sem calcular resumo de produção.
Não há SQL próprio, nova rotina de gravação, cache de códigos nem envio de
mensagens nessa busca. O adaptador filtra a data civil e a descrição e retorna
código, data, descrição e bloqueio de vendas, sem excluir carradas bloqueadas.

- Uma correspondência: usar o código retornado em `carrada_codigo` e apresentar
  a data e descrição da carrada na prévia. O usuário não precisa informar código.
- Várias correspondências: considerar `total_encontrado`, inclusive quando a
  página tem apenas um item, e pedir a escolha pela descrição. Não selecionar
  automaticamente a primeira. Consultar `proxima_pagina` quando necessário.
- Nenhuma correspondência: esclarecer a data com o usuário. Não inventar código
  nem preparar sem carrada quando ele pediu vínculo com uma carrada.
- Falha da origem: informar a falha; ela não significa que a data não tem carrada.

Datas relativas devem ser convertidas em datas concretas antes da consulta;
quando a semana for ambígua, pedir esclarecimento. O rascunho mantém o código
escolhido e a confirmação continua usando o fluxo existente da Inserção V2.

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
- Preço negociado explicitamente informado pode ser inferior, igual ou superior
  ao cadastro. A confirmação revalida a referência sem alterar o preço geral.
- A consulta de vendedores é necessária porque o pedido V2 exige vendedor real.
- O tipo padrão é `orcamento`; `kit-feirinha` fica disponível quando solicitado.
- A criação não envia WhatsApp. Depois de conferir o vínculo com a carrada,
  `preparar_whatsapp_pedido` com `tipo: aviso_carrada` apresenta cliente, telefone,
  carrada e texto. `confirmar_whatsapp_pedido` exige aprovação posterior dessa
  prévia e não repete o pedido. As outras ações mantêm os efeitos que declaram.
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

