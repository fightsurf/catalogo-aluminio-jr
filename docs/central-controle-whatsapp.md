# Central de Controle do WhatsApp — Alumínio JR

## Acesso

- Interface: `/whatsapp/central-controle` (requer sessão administrativa).
- Atalho: `/bot/admin` > **Central de controle ON/OFF**.
- API: `GET /whatsapp/central-controle/api/controles` e
  `PUT /whatsapp/central-controle/api/controles/:id`, com JSON
  `{"ativo":false}` ou `{"ativo":true}`.
- Todas as opções começam **ON** para preservar os envios existentes.
- Cada mudança registra usuário e hora em `whatsapp_central_auditoria`;
  configuração persistida em `whatsapp_central_controles`.
- O ON/OFF é verificado **no backend antes da chamada externa** em
  `src/services/integracoes/zapi.service.js`. Uma função desligada não
  encaminha a chamada de envio à Z-API.
- `envios_geral` bloqueia todos os envios do Node. `outros_envios` é o
  controle de segurança para código não associado a uma origem conhecida.
- A consulta de configurações usa o PostgreSQL em cada tentativa de envio;
  não depende de atualizar a página do operador.

## Inventário de envio e mapeamento

| Área | Controle | Origem no sistema | Como é aplicado |
|---|---|---|---|
| Todos | `envios_geral` | Todos os serviços Node que usam a Z-API | Bloqueio no transporte |
| Pedidos | `pedidos_entrada_carrada` | Inserção de pedidos e inclusão na carrada | Verificação no serviço de notificações + contexto de rota |
| Pedidos | `pedidos_saida_carrada` | Saída e transferência de carradas | Verificação por tipo de notificação |
| Pedidos | `pedidos_texto` | Botão **Enviar para WhatsApp** nas telas de inserção/consulta, desktop e mobile | Endpoint `/api/whatsapp/enviar-pedido` |
| Pedidos | `pedidos_pdf` | Botão **Enviar PDF WhatsApp** nas telas de pedido | `POST /api/legado/pedidos/:idMestre/whatsapp/pdf` |
| Pedidos | `pedidos_fotos` | Botão **Enviar pedido com fotos** | `POST /api/whatsapp/relatorio-fotos/enviar-item` |
| Pedidos | `pedidos_fotos_finalizacao` | Resumo final do envio de fotos | `POST /api/whatsapp/relatorio-fotos/finalizar` |
| Pedidos | `pedidos_resumo_imagem` | Histórico do cliente, resumo de pedidos em imagem | `POST /api/legado/pedidos-cliente/:favorecido/whatsapp/resumo-imagem` |
| Pedidos | `pedidos_historico_financeiro` | Envio do saldo/histórico de pagamentos do cliente | Endpoint `/api/whatsapp/enviar-cliente-financeiro` |
| Logística | `carradas_lote` | Mensagens em lote no progresso de carradas | `POST /api/legado/carradas-progresso/:codigo/whatsapp/lote` |
| Logística | `semanas_lote` | Resumo semanal por cliente | `POST /api/legado/semanas/:id/whatsapp/lote` |
| Logística | `fornecedores_semanas` | Resumo semanal enviado a fornecedores | `POST /api/legado/semanas/:id/fornecedores/:fornecedorId/whatsapp` |
| Produção | `progresso_producao` | Entrada em produção e aviso de fase | `/api/legado/carradas-progresso/...` |
| Produção | `progresso_nota_fiscal` | Aviso de nota fiscal | `/api/legado/carradas-progresso/...` |
| Produção | `progresso_etiqueta` | Etiquetas e imagem de impressão | `/api/legado/carradas-progresso/.../etiqueta-...` |
| Produção | `progresso_local_entrega` | Transportadora, redespacho, agência, local de entrega | `/api/legado/carradas-progresso/.../local-entrega` |
| Produção | `progresso_mensagem_cliente` | Mensagem avulsa de progresso da carrada | `/api/whatsapp/enviar-progresso` |
| Financeiro | `pagamentos_mensagens` | Mensagens avulsas de pagamentos web/mobile | `/api/whatsapp/enviar-pagamento` |
| Financeiro | `prestacoes_resumo` | Prestação de contas, resumo WhatsApp | `POST /api/prestacoes/:id/whatsapp/resumo` |
| Financeiro | `prestacoes_pdf` | Prestação de contas, PDF | `POST /api/prestacoes/:id/whatsapp/pdf` |
| Marketing | `mala_direta` | Mala direta, testes e worker que percorre a fila | Verificação antes de reivindicar destinatário + foto/áudio classificados |
| Marketing | `promocao_posvenda` | Promoção pós-venda agendada por pedido | Verificação antes de processar a fila + foto/áudio classificados |
| Marketing | `ofertas_kits` | Central de ofertas, comando `@kits-hoje`/`@kits-ontem` enviado ao Node | `POST /api/ofertas/integracao/kits-whatsapp` |
| Marketing | `ofertas_whatsapp` | Envio manual de arte de oferta pelo backend | `POST /api/ofertas/:id/enviar-whatsapp` |
| Marketing | `status_whatsapp` | Status foto/vídeo, agendamentos e funil de publicações | `/send-image-status`/`/send-video-status` no transporte |
| Atendimento | `bot_atendimento` | Atendimento e ações de intenções do bot Node | Contexto `/bot/...` |
| Atendimento | `envio_manual` | Tela de envio avulso e API de WhatsApp genérica | `POST /api/whatsapp/enviar` |
| Outros | `mirian_pacientes` | Mensagem para paciente do Mirian | Contexto `/mirian/...` |
| Outros | `outros_envios` | Chamadas internas ao transporte sem origem classificada | Controle padrão de segurança |

## Recebimentos

O campo **Ao receber** da Z-API pode apontar no futuro diretamente para
`/api/whatsapp/webhook/zapi?chave=...`. O recebimento é independente
dos controles de envio, inclusive do botão geral OFF.

Os registros são exibidos em `/bot/admin` (conversas e resumo) e na
seção **Recebimentos** desta central. Há distinção entre
`fromMe:true` (mensagem enviada pelo proprietário do número, incluindo
comandos `@frete`) e `fromMe:false` (recebida do contato).

## Limites e cuidados operacionais

1. A central governa os envios que **passam pelo Node e pelo serviço
   `src/services/integracoes/zapi.service.js`**. Não tem controle direto
   sobre fluxos do **n8n** que chamam a Z-API sem passar por esse serviço.
   Esses fluxos só poderão ser subordinados aos botões após migração.
2. Links externos `wa.me`, `web.whatsapp.com` e `whatsapp://`
   abrem o WhatsApp no dispositivo do operador e **não são disparos
   enviados pela Z-API do Node**. Um ON/OFF de backend não consegue impedir
   que o operador envie manualmente uma mensagem no WhatsApp fora do app.
3. Desativar uma função **não cancela** mensagem que a Z-API já aceitou;
   fotos já enviadas antes de OFF permanecem enviadas. Workers de mala
   direta e pós-venda não retiram novos itens da fila com o controle OFF.
4. Quando bloqueado, o transporte devolve erro
   `WHATSAPP_ENVIO_DESATIVADO` (HTTP recomendado 409). Telas que capturam
   falhas exibem a mensagem correspondente. Para tarefas com filas,
   houve cuidado para não tomar novas tarefas com o controle OFF.
5. O sistema tem várias telas antigas. Este inventário cobre os pontos
   identificados nas buscas por Z-API, funções de envio e endpoints dos
   frontends. Se surgir um novo serviço de envio, ele cairá em
   `outros_envios` até receber uma classificação própria. Não afirmar
   que envios externos ou futuros estão sob os switches de envio atual.
6. Desligar o envio não substitui a necessidade de autorização do
   destinatário, proteção de dados e políticas do WhatsApp.
