# Promoção pós-venda de pedidos

**Acesso:** na tela `/legado/pedidos-insercao-v2`, o botão **Promoção** só aparece depois que o pedido é efetivamente salvo. Ele fica junto dos demais botões do pedido. Clicar no botão abre o modal; salvar não abre o modal automaticamente. O agendamento e os preços/custos só são acessíveis com sessão administrativa válida, verificada pelo servidor (`requireAuth`). A sequência de teclas e o código secreto não são mais usados.

**Modal:** seleciona-se um produto do catálogo, com foto, preço normal e custo atualizado pela composição; informa-se o preço promocional, que deve ser menor que o preço de tabela; a margem de lucro estimada é exibida. É necessário confirmar que o cliente autorizou ofertas no WhatsApp. O preço de tabela e o custo não vão ao cliente.

**Mensagem:** a IA escreve um texto comercial curto, sem inventar benefícios, desconto percentual ou condições de venda. O servidor acrescenta explicitamente o **preço promocional** na legenda. O cliente recebe **somente uma foto do produto com a legenda** contendo o preço novo e o texto da IA. **Não há áudio nem integração ElevenLabs neste fluxo.**

**Agendamento:** a mensagem é preparada ao clicar em **Agendar oferta**, quando o servidor consulta os dados do pedido e o telefone no sistema legado e grava a oferta no PostgreSQL. A previsão é 1 hora após salvar (ou 1 hora após agendar se o modal for utilizado mais de 20 minutos depois). Um trabalhador no servidor verifica a fila a cada 30 segundos. Não é necessário manter a página aberta; só há uma oferta por pedido.

**Segurança:** o backend exige login administrativo e valida foto, preço, custo, telefone, autorização do cliente e números bloqueados. Se o envio for interrompido, o status é marcado como `incerto` para conferência, sem reenvio automático para evitar duplicidade.

**Dependências:** `OPENAI_API_KEY`, Z-API e PostgreSQL configurados. Não é necessário configurar `PROMO_POSVENDA_CODIGO` nem ElevenLabs para essa funcionalidade. O aceite da Z-API não comprova entrega no aparelho; validar as integrações reais e o ambiente do Render antes de uso em produção.
