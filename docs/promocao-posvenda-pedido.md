# Promoção pós-venda de pedidos (código secreto)

**Configuração necessária no Render:** cadastrar a variável de ambiente `PROMO_POSVENDA_CODIGO` com um código de **no mínimo oito caracteres**, exclusivo do responsável. Não registrar esse segredo no GitHub nem enviá-lo em mensagens. Sem essa variável, o desbloqueio fica inativo.

**Como acessar:** na tela `/legado/pedidos-insercao-v2`, com foco fora de campos editáveis, pressionar a sequência de setas **↑ ↑ ↓ ↓ ← → ← →**, e informar o código no diálogo. A sequência não é a senha: apenas permite solicitar o código. O código é validado no servidor; a autorização dura 30 minutos na aba atual. Não aparece nenhum botão público para os demais operadores.

**Fluxo:** após a confirmação da gravação do pedido, surge o modal apenas na aba autorizada. Ele mostra foto, preço de tabela e custo calculado pela composição. Escolha o produto, informe um preço menor que o de tabela, confirme que o cliente autorizou ofertas e agende. O sistema consulta o pedido e o telefone diretamente no legado, cria texto com OpenAI, sintetiza o áudio com a voz/modelo já salvos da ElevenLabs e persiste tudo em PostgreSQL. A data prevista é uma hora após o salvamento (ou uma hora após o agendamento se o modal for usado mais de 20 minutos depois).

**Envio:** um trabalhador no servidor verifica a fila a cada 30 segundos. Na hora prevista, envia pela Z-API a imagem com a legenda produzida pela IA e, em seguida, o áudio. Não é preciso manter o navegador aberto. A fila preserva a promoção em reinicializações, com apenas uma oferta por pedido.

**Segurança e falhas:** o backend valida preço, custo, foto, telefone, autorização e a lista de números bloqueados, independentemente do navegador. Agendamentos são únicos por pedido. Os estados internos incluem `pendente`, `enviando`, `enviado`, `bloqueado` e `incerto`. Se uma chamada ao WhatsApp for interrompida, o status fica `incerto` para conferência manual: **não há reenvio automático**, evitando mensagens duplicadas.

**Dependências:** `OPENAI_API_KEY` e `ELEVENLABS_API_KEY` configuradas; voz e modelo selecionados previamente no modal “Apresentar pedido com IA”; Z-API funcionando e banco PostgreSQL disponível. Se a IA ou ElevenLabs não puderem gerar a mensagem/áudio, o agendamento falha sem enviar nada.

**Limitação:** o aceite da Z-API não comprova a entrega no aparelho do cliente. Os dados reais de produção e credenciais externas precisam ser testados no Render antes de liberar a funcionalidade para operação contínua.
