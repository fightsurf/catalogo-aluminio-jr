# WhatsApp financeiro pelo MCP — 25/11/2026 (versão 1.5.0)

## Objetivo

Atender pedidos como: "Localize os três últimos pedidos do Júnior Representante e envie o restante a pagar de cada um pelo WhatsApp".

As duas ferramentas não enviam nada na preparação:

1. **preparar_whatsapp_pagamentos_cliente** recebe cliente (nome) ou favorecido (código), e quantidade (padrão 3; 1–10). Localiza o cliente único, consulta o histórico completo, ignora pedidos cancelados e ordena pelos **números sequenciais numéricos do pedido** (maior primeiro), não por data nem pelo ID interno.
2. Busca o detalhe financeiro pela rotina de pagamentos.buscarPedidoComPagamentos para cada pedido, incluindo pagamentos, saldo e baixas para crédito; usa o mesmo formatador public/js/pagamentos-whatsapp-mensagem.js do **botão preto da tela de Pagamentos** (desktop e mobile).
3. A prévia expõe pedido, cliente, WhatsApp cadastrado, valor total, valor pago, saldo e **mensagem completa de cada pedido**. Salva uma ação de confirmação válida por até dez minutos; o usuário deve aprovar expressamente em uma resposta posterior.
4. **confirmar_whatsapp_pagamentos_cliente** exige acao_id, codigo_confirmacao e confirmacao="CONFIRMO". Reconsulta histórico, valores, textos e telefone e **bloqueia** se houve alteração. Envia uma mensagem por pedido ao **mesmo** número cadastrado usando o serviço do endpoint POST /api/whatsapp/enviar-pagamento e o mesmo switch pagamentos_mensagens da Central.
5. Cada tentativa é persistida **antes** do envio. Em timeout, resultado incerto ou envio parcial, a confirmação não é repetível automaticamente. consultar_acao_pedido permite acompanhar as tentativas.

## Regras de segurança

- Acesso somente pelo MCP autenticado /mcp/clientes, com OAuth clientes:read + whatsapp:send; o MCP público não ganha funções financeiras.
- Nunca usar números de telefone informados avulsamente na conversa. Destinatário vem do detalhe do pedido e é revalidado.
- Histórico incompleto, cliente homônimo, número não numérico, número duplicado na seleção, pedido cancelado, valor ausente, pedido de outro cliente ou telefone inválido bloqueiam a preparação.
- Caso haja menos pedidos ativos que a quantidade solicitada, a prévia informa quantos encontrou. A Central de Controle pode bloquear o envio.
- Resposta de aceitação do provedor não é prova de entrega.

## Validação

- tests/mcp-pagamentos-whatsapp.test.js: formatação, baixa para crédito, ordem numérica, cancelados, prévia sem envio, três mensagens, alteração de valores, histórico incompleto, homônimos, duplicidades e timeout.
- tests/mcp-pacote-integracao.test.js: ferramentas registradas, contratos de saída, escopos OAuth, preparação e confirmação.
- Execute: node --test tests/mcp-pagamentos-whatsapp.test.js tests/mcp-pacote-integracao.test.js

## Produção

A implantação acontece após integrar a branch à principal e o Render concluir o deploy. Não reutilize confirmação preparada antes da publicação da ferramenta.
