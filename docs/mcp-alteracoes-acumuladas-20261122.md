# MCP Alumínio JR — pedidos, WhatsApp e expedição

## Escopo e publicação

Em 22/11/2026 o usuário autorizou implementar o pacote completo, comitar na `main` e realizar o deploy no Render. Essa autorização substitui a orientação anterior de apenas acumular alterações na branch `feature/mcp-alteracoes-acumuladas-20261122`.

O endpoint continua sendo o mesmo `/mcp/clientes`, autenticado por OAuth. O MCP chama os serviços já usados nas telas. Não existe ferramenta MCP de **enviar para todo mundo**: essa solicitação foi cancelada. Todas as ações deste pacote são por pedido individual.

Serviço Render: `catalogo-aluminio-jr`, no workspace `George Fernandes's workspace`. O serviço acompanha `main` com deploy automático por commit. Após o push, acompanhar o deploy do SHA exato até `live`; não provocar um segundo deploy enquanto o automático estiver em andamento.

## 1. Consultas de pedidos

`consultar_pedidos` aceita número/prefixo, cliente por nome ou código `favorecido`, data do pedido, cancelados, paginação, `ultimo` e `sem_data_expedicao`.

- Por cliente, resolve a identidade e usa o histórico existente por código. Homônimos retornam candidatos; não mistura seus pedidos.
- `ultimo: true` usa a ordem decrescente da chave de cadastro `id_mestre`/`SAIDA`, não a data comercial nem a data de expedição.
- O histórico é paginado com até 30 pedidos por página. Percorrer `proxima_pagina` quando o usuário pedir todos.
- `sem_data_expedicao: true` inclui apenas ausência de data **verificada**. Campo omitido pelo bridge não significa pedido sem expedição. Quando necessário, consulta as rotinas existentes de detalhe e resumo da carrada.
- `resultado_completo`, `ultimo_pedido_confirmado`, `expedicao_nao_verificada` e `avisos` informam limitações da origem. Não apresentar uma consulta incompleta como se fosse completa.
- `detalhar_pedido` usa o `id_mestre` interno retornado na consulta e informa itens e valores. Não usar o número visível do pedido como se fosse esse identificador.

Exemplos de linguagem que a integração atende:

1. “Localize o último pedido cadastrado de Eloise Karine.”
2. “Liste os pedidos de Eloise Karine.”
3. “Liste os pedidos de Eloise Karine sem data de expedição.”
4. “Localize o último pedido de Eloise Karine que ainda está sem data de expedição.”
5. “Detalhe o pedido selecionado.”

Os pedidos 0020020 e 0020021 citados anteriormente são referências de conversa. Esta implementação não recria, cancela, altera ou reenvia esses pedidos.

## 2. Alteração e cancelamento

| Prévia | Confirmação | Comportamento |
|---|---|---|
| `preparar_alteracao_pedido` | `confirmar_alteracao_pedido` | Data comercial, vendedor, observação, lista de itens e carrada; usa `atualizarPedido` e, quando aplicável, `alterarCarradaPedido`. |
| `preparar_cancelamento_pedido` | `confirmar_cancelamento_pedido` | Motivo obrigatório; usa `cancelarPedido`. |

A prévia mostra o pedido atual, a proposta e os efeitos. Se `itens` for fornecido, é a **lista completa que substituirá a atual**. Campos omitidos são preservados. Produtos e preços vêm do cadastro; desconto abaixo da referência não é autorizado pelo MCP.

A consulta financeira usa `pagamentos.listarPedidosPorNumero`, incluindo as baixas/créditos do sistema. Ausência de resposta, identidade divergente ou valor não informado bloqueia a operação. O zero padrão do detalhe não é considerado comprovação de pagamento zero. Pedido com baixa para crédito fica bloqueado, e o novo total não pode ser inferior ao valor pago verificado.

A confirmação revalida o estado do pedido, pagamentos, produtos, preços e carrada. Se mudaram depois da prévia, precisa de nova preparação. A origem mantém suas próprias validações transacionais. Alteração de carrada preserva os avisos de saída/entrada usados na tela; falha desses avisos é informada como resultado parcial, sem repetir a gravação.

## 3. WhatsApp

`preparar_whatsapp_pedido` e `confirmar_whatsapp_pedido` operam sobre um pedido real e seu cliente cadastrado. Não aceitam destino livre.

| Tipo | Rotinas reutilizadas |
|---|---|
| `texto` | Formatador compartilhado com a tela de pedidos + `envio-whatsapp.enviarMensagem`. Texto personalizado, quando solicitado, aparece integralmente na prévia. |
| `fotos` | `analisarRelatorio`, `enviarItem` e `finalizarEnvio`. Bloqueia produto inativo ou foto ausente, revalida mídia e registra cada etapa. |
| `pdf` | `pedidoPdf.gerarPdfPedido` e `envio-whatsapp.enviarDocumentoPdf`. Envia os mesmos bytes preparados. |
| `audio_ia` | Resumo IA, preferência de voz e ElevenLabs existentes. Mostra a transcrição e envia os mesmos bytes do áudio aprovado. |

A preparação não envia WhatsApp. A produção da prévia de áudio usa os serviços de geração já existentes. PDFs e áudios internos têm limite de 5 MB; seus bytes não são incluídos na resposta visível. As prévias de WhatsApp expiram em 10 minutos.

A confirmação confere novamente pedido, cancelamento, destinatário, conteúdo e Central de Controle. Fotos mantêm o intervalo utilizado na tela. Em falha parcial, informa as etapas aceitas e interrompe; não reenvia os itens anteriores. Os resultados distinguem aceite pelo provedor, não envio, parcial e resultado incerto. Aceite não é confirmação de entrega.

### Aviso após inserir pedido em carrada

A causa do aviso ausente era a segunda requisição feita somente pelo JavaScript da Inserção V2. O MCP criava o pedido, mas não executava essa requisição.

O serviço de Inserção V2 agora executa o aviso quando recebe `aviso_whatsapp_carrada: true`, depois de confirmar o vínculo e o número do pedido. A tela e o MCP fornecem a opção, e a tela deixa de enviar uma segunda mensagem. O aviso usa a mesma funcionalidade `pedidos_texto` aplicada pela rota anterior.

Falha no aviso não desfaz nem repete o pedido. Central desligada retorna `nao_enviado`; falhas incertas são separadas. Erros brutos do provedor não são expostos no resultado.

## 4. Data de expedição

`preparar_expedicao_pedido` confere o pedido, sua carrada, a data atual e a proposta. `confirmar_expedicao_pedido` chama exatamente:

```js
progresso.salvarDataExpedicao({
  codigoCarrada,
  numeroPedido,
  dataExpedicao,
  silencioso: false
});
```

A execução usa o contexto de WhatsApp `progresso_producao`, igual ao middleware da tela. Mantém o registro da data e a notificação/áudio automáticos configurados. Não separa artificialmente a ação nem chama envio em lote. Se a data for salva e um aviso falhar, o resultado é parcial e identifica que a data já foi registrada.

## 5. Confirmação, permissões e repetição

Cada ação exige prévia, apresentação dos efeitos e **resposta posterior explícita** do usuário. Os confirmadores recebem o identificador da ação, código técnico da mesma prévia e `confirmacao: "CONFIRMO"`.

As novas ações ficam em `mcp_pedidos_acoes`, associadas à conta OAuth. A reserva atômica permite consumir a tentativa uma única vez. O progresso é persistido antes de cada efeito externo. Em queda, timeout, falha parcial ou resultado incerto, a tentativa permanece consumida. `consultar_acao_pedido` consulta seu estado e não reexecuta. Binários são removidos do payload ao concluir/encerrar ou expirar a prévia.

| Escopo | Permissão |
|---|---|
| `clientes:read` | Consultas de clientes, logística e pedidos. |
| `pedidos:write` | Criação de pedido; não concede gestão dos pedidos existentes. |
| `pedidos:manage` | Alterar, cancelar e registrar expedição mediante confirmação. |
| `whatsapp:send` | Envios de WhatsApp individuais confirmados e avisos previstos nas ações. |

Criação e edição com possibilidade de aviso, assim como expedição, anunciam também `whatsapp:send`. O token antigo não recebe permissões novas automaticamente. O servidor devolve o desafio OAuth das permissões faltantes. O catálogo de ferramentas do plugin pode precisar ser atualizado após o deploy; as novas ações solicitarão a autorização correspondente no próprio fluxo do plugin.

## Validação

A suíte do pacote é executada por:

```sh
node --test tests/mcp-*.test.js \
  tests/pedidos-insercao-v2-aviso-mcp.test.js \
  tests/relatorio-fotos-previa.test.js
```

O workflow `MCP Alumínio JR - clientes, logística e pedidos` executa esses testes e valida sintaxe em pushes relevantes na `main` e na branch do pacote. Os testes usam dependências simuladas e cobrem consultas, paginação com 350 pedidos, homônimos, data desconhecida, OAuth, campos inválidos, confirmação por conta, concorrência, pagamentos, cancelamento, expedição, alterações simultâneas, fotos e resultados parciais.

Validação operacional após deploy: consultar primeiro o histórico/último pedido e o filtro de expedição pelo plugin atualizado. Escritas e mensagens reais ficam para pedidos escolhidos pelo usuário, com a prévia e confirmação normais. Nenhum pedido ou mensagem real foi executado durante os testes automatizados.
