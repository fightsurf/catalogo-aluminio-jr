# Promoção pós-venda de pedidos

## Como abrir
Na tela `/legado/pedidos-insercao-v2`, depois de **Salvar pedido** com sucesso, o botão **Promoção** aparece junto às demais ações. O modal não abre automaticamente. Acesso e agendamento exigem sessão de administrador (`requireAuth`); não há código secreto nem sequência de teclas.

## Modal de promoção
Escolha um produto com foto no catálogo: serão mostrados a foto, o preço de tabela, o custo atualizado e a margem bruta estimada. Informe o **preço promocional**, que pode ser menor, igual ou maior que o preço de tabela ou o custo de composição. Produtos sem custo cadastrado também podem ser promovidos; o custo é exibido como indisponível e registrado como zero no histórico da oferta. A margem estimada é apenas informativa e nunca impede o agendamento.

O modal permite **Gerar texto com IA** e editar a mensagem em uma caixa de texto, como em **Apresentar pedido com IA**. O preço promocional é anexado automaticamente pelo servidor ao final do texto. Não escreva outro valor monetário conflitante no texto.

O botão **Configurar ElevenLabs** lista as vozes e os modelos disponíveis e salva as preferências no **mesmo registro PostgreSQL** do modal de apresentação de pedido (`pedido_resumo_ia_voz_config`). A voz e o modelo são compartilhados entre as duas funcionalidades e persistem entre sessões/aparelhos.

Clique em **Gerar áudio ElevenLabs** para ouvir a prévia do texto **com o preço promocional**. Se alterar texto, produto, preço ou configuração de voz/modelo, gere outra prévia antes de agendar. Prévia dura até 10 minutos e pertence à sessão administrativa que a gerou. A oferta não pode ser agendada sem uma prévia válida, correspondente ao texto e às configurações salvas.

Ao clicar em **Agendar oferta**, após confirmar a autorização do cliente para receber ofertas, o servidor salva a foto, o texto, o preço promocional, o MP3 e a configuração usada, junto com os dados da fila em `pedido_promocoes_posvenda`. O áudio não depende do navegador permanecer aberto e não é gerado novamente no horário do envio.

## WhatsApp
O trabalhador consulta a fila a cada 30 segundos, e aproximadamente uma hora após salvar o pedido, envia **duas mensagens consecutivas** pela Z-API:

1. **Foto do produto com legenda:** texto comercial gerado/editado + preço promocional informado. Custos e margens não vão ao cliente.
2. **Áudio ElevenLabs:** lê o mesmo texto e o novo preço.

Se a promoção for agendada mais de 20 minutos após salvar, o prazo passa a ser uma hora após o agendamento.

O trabalhador não faz novas comparações entre preço, custo e tabela no momento do envio. Uma oferta agendada não é cancelada por margem negativa ou ausência de custo. Permanecem exigidos os dados técnicos para envio e o respeito à autorização e ao bloqueio de recebimento registrado pelo cliente.

Somente uma promoção por pedido. A fila preserva agendamentos no PostgreSQL. O envio tem estados `pendente`, `enviando`, `enviado`, `bloqueado` e `incerto`. Falhas depois de iniciar o envio ficam `incerto`, sem reenvio automático, para não duplicar mensagens.

## Dependências e cuidados
É necessário configurar `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, Z-API, PostgreSQL e autenticação administrativa no Render. Antes do uso com clientes, validar a integração real da geração de áudio, da fila, da Z-API e do banco. Se o serviço Render estiver suspenso, o trabalhador interno não envia no horário até a aplicação voltar a executar. O aceite pela Z-API não comprova a entrega no aparelho.

