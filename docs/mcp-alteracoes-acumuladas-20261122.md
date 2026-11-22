# Pacote acumulado de alterações do plugin Alumínio JR — 22/11/2026

Branch de trabalho: `feature/mcp-alteracoes-acumuladas-20261122`.
**Não publicar no Render, não alterar a configuração do plugin do ChatGPT antes da revisão.**

## 1. Consulta de pedidos — código incluído na branch

- Novo `consultar_pedidos`: filtro por número, cliente ou data; resultado limitado e inclui situação, cancelamento, valor, vendedor e carrada quando o legado fornecer.
- Novo `detalhar_pedido`: usa o `id_mestre` real da busca; retorna itens e valores.
- Reutilizar `pesquisarPedidos` e `buscarDetalhePedido` usados na tela /legado/pedidos, sem consulta direta não autenticada ao Firebird.
- Leitura OAuth `clientes:read`, sem efeitos colaterais, no mesmo endpoint `/mcp/clientes`.
- Verificar em ambiente de testes os pedidos 0020020 (cancelado, cliente Kaká) e 0020021 (Eloise Karine, carrada 1697 de 02/12/2026). São apenas exemplos para validação, **não executar escrita nem enviar WhatsApp**.

## 2. Ações do WhatsApp da tela /legado/pedidos — requisitos em desenvolvimento

Botões existentes identificados na tela:

1. **💬 Enviar para WhatsApp**: envia o texto do pedido pela API `POST /api/whatsapp/enviar-pedido`, funcionalidade `pedidos_texto`.
2. **📷💬 Enviar pedido com fotos**: consulta/valida fotos de cada item; envia as imagens em sequência e, por fim, o resumo, via `/api/whatsapp/relatorio-fotos/analisar`, `/enviar-item`, `/finalizar`; funcionalidades `pedidos_fotos` e `pedidos_fotos_finalizacao`. Bloquear envio se alguma foto necessária estiver ausente.
3. **📄💬 Enviar PDF WhatsApp**: usa `POST /api/legado/pedidos/:idMestre/whatsapp/pdf`, funcionalidade `pedidos_pdf`.
4. **🤖 Apresentar pedido com IA → Enviar áudio pelo WhatsApp**: gerar e revisar a apresentação, produzir prévia de áudio ElevenLabs e só então enviar para o telefone validado, conforme fluxo existente.
5. **📋💬 Copiar relatório WhatsApp**: NÃO é disparo; gera texto para copiar (separar das ferramentas de envio).

Regras antes de publicar ferramentas de WhatsApp:
- No mesmo plugin autenticado; autorização de envio distinta da leitura, com revisão dos escopos OAuth; **jamais** expor envio em endpoint MCP público.
- Localizar primeiro um único pedido real; confirmar número, cliente, telefone (preferencialmente dígitos finais), tipo de conteúdo e resumo do que será enviado.
- Preparo/visualização não envia nada. Exigir resposta posterior **expressa** do usuário antes da execução real.
- Validar que pedido não esteja cancelado e que destinatário esteja correto; respeitar a central de bloqueio de WhatsApp e as regras de consentimento.
- Controle contra envio duplicado: chave idempotente registrada por pedido, canal e tentativa; status de envio distinguindo solicitado, aceito pelo provedor, entregue, e falha/resultado incerto.
- Para fotos, estado de envio por item. Em falha parcial, mostrar quantos itens foram enviados e não reenviar automaticamente os anteriores; não declarar sucesso total apenas por recebimento parcial.
- Mensagens proativas somente para o cliente do pedido escolhido. Não enviar nenhuma mensagem em testes sem destinatário controlado e autorização expressa.
- Reaproveitar os serviços e verificações do backend; evitar fazer uma requisição HTTP administrativa sem a sessão adequada.

## Diretriz de arquitetura: reaproveitar ações existentes

- **Pedido (inserção):** as ferramentas MCP `preparar_pedido` e `confirmar_pedido` são apenas a camada de interface/segurança por voz. A confirmação já invoca `src/services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service.js` → `inserirPedido(payload)`, que chama o mesmo bridge `POST /api/pedidos-insercao-v2`. Não duplicar lógica de gravação no Firebird.
- **Pedido (edição e cancelamento):** acrescentar duas operações MCP com prévia e confirmação explícita, delegando a `src/services/legado/pedido/pedidosLegado.service.js` → `atualizarPedido` e `cancelarPedido`. Verificar status, bloqueios financeiros, divergências e idempotência antes de liberar.
- **Progresso (data de expedição):** acrescentar comando MCP que delegue a `src/services/legado/carradas-progresso/carradas-progresso.service.js` → `salvarDataExpedicao({ codigoCarrada, numeroPedido, dataExpedicao, silencioso: false })`, preservando o comportamento da tela, inclusive a notificação WhatsApp configurada.
- Para data de expedição, localizar o pedido e conferir a carrada, mostrar a data atual e a proposta (formato DD/MM/AAAA), informar que a mesma ação **pode disparar WhatsApp** e pedir confirmação explícita antes de executar. Não disparar na prévia; não executar repetidamente em resposta incerta.
- Antes de publicar, testar com dados controlados sem enviar mensagens a clientes reais; validar central de bloqueio e autorização OAuth de escrita. Publicação na produção permanece proibida nesta etapa.

## Correção confirmada: aviso da carrada após inserir pedidos pelo MCP

- **Causa identificada:** o backend da Inserção V2 grava pedido e carrada, mas o aviso WhatsApp era uma segunda requisição iniciada pelo JavaScript da tela `views/legado/pedidos-insercao-v2/pedidos-insercao-v2.html`, usando `POST /api/whatsapp/enviar-pedido`. O MCP chamava apenas `inserirPedido`, sem executar essa segunda ação. No caso do pedido 0020021 de Eloise, não presumir que a mensagem tenha sido entregue: foi observada ausência de envio pelo fluxo MCP, sem auditoria externa do provedor.
- **Correção na branch:** aviso de entrada em carrada passou a ser tratado uma vez pelo servidor no próprio serviço `src/services/legado/pedidos-insercao-v2/pedidos-insercao-v2.service.js`, por meio de `aviso_whatsapp_carrada: true`. A tela de Inserção V2 e o MCP fornecem essa opção; o JavaScript da tela não envia mais a segunda mensagem, evitando duplicidade.
- Condições: disparar apenas quando `carradaVinculada.sucesso` e número do pedido confirmados; obter telefone do cadastro real do cliente; usar serviço de envio Z-API existente e a funcionalidade `pedidos_texto` como na rota anterior. A preparação por voz informa que a confirmação do pedido em carrada também tenta avisar o cliente.
- A API retorna `avisoWhatsappCarrada.status`: `aceito_pelo_provedor`, `nao_enviado` ou `resultado_incerto`. Aceitação do provedor não confirma entrega. Falha no aviso não desfaz o pedido já gravado; nunca reenviar o pedido nem a mensagem automaticamente ao encontrar resultado incerto.
- A flag não é passada ao bridge Firebird e os demais consumidores do serviço não passam a enviar WhatsApp por padrão. Nenhuma mensagem foi enviada a clientes nesta alteração de código.
- Validar testes automatizados `tests/pedidos-insercao-v2-aviso-mcp.test.js` e teste integrado em homologação, inclusive telefone ausente, carrada não vinculada e central de bloqueio desligada. **Não fazer replay do pedido 0020021.**

## Publicação e validação

- Antes de atualizar o plugin, validar sintaxe/testes, testar consulta no bridge Firebird, inspecionar autorização OAuth e fluxos de envio em homologação.
- Publicar branch somente após revisão/merge. Serviço de produção Render: `catalogo-aluminio-jr` no workspace `George Fernandes's workspace`.
- Recarregar as ferramentas do plugin no ChatGPT após o deploy. Até lá, as novas ferramentas NÃO aparecem na sessão existente.
- Continuar acumulando novas solicitações **nesta branch**, sem alterar `main` diretamente.
