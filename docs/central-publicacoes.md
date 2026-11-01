# Central de Publicações — Alumínio JR

A partir desta alteração, a interface administrativa fica em `/marketing/central-publicacoes` (acesso autenticado).

## Três origens / um executor
- Status WhatsApp: categorias e modos foto / vídeo / foto+vídeo.
- Republicador YouTube: vídeos do mais antigo ao mais novo.
- Central de Ofertas: kits feirinha do mais antigo ao mais novo.

Os controles de agenda saem das três páginas de origem. Essas páginas passam a mostrar só um resumo e um link para a Central. A Central permite configurar separadamente ativação, janela e frequência, além de pausa global, intervalo mínimo entre tarefas e prioridades para solicitações recebidas no mesmo minuto.

A fila PostgreSQL existente continua sendo a fonte de verdade. A pausa geral impede **iniciar** novas tarefas, mas não aborta uma publicação externa já iniciada. A prioridade considera primeiro a idade da solicitação (minuto), depois a classificação entre os três módulos. Um item com mídia assíncrona ainda em andamento sempre tem precedência sobre um envio novo.

## Publicação manual
Os botões de publicação nas três páginas agora enfileiram solicitações persistentes via `/marketing/central-publicacoes/api/manual/{status,youtube,ofertas}`. No Status WhatsApp, **enviar produtos a um cliente** mantém o fluxo de mensagem direta e não é publicação em rede. No Republicador, **Testar download** mantém o comportamento de teste sem publicar. Os endpoints antigos permanecem para compatibilidade, mas chamadas externas a eles não passam automaticamente pelo funil. A recuperação de publicações legadas deve ser realizada com cuidado.

A API de enfileiramento manual exige autenticação e identificador de solicitação (UUID). Ela impede a criação de solicitações conflitantes óbvias: categoria manual ainda pendente, vídeo já registrado ou kit já enfileirado/publicado. O operador deve conferir resultados incertos antes de repetir. Checks de consulta sem trava por conteúdo não equivalem a uma chave única atômica; duas requisições simultâneas com UUIDs diferentes ainda exigem atenção.

## Incidentes e reinícios
Em um reinício, o executor usa registros persistentes. Resultado externo incerto não é reenviado automaticamente. O botão de conciliação exige confirmação do operador. Uma publicação parcialmente confirmada não pode ser automaticamente tratada como totalmente concluída. O processo não pode oferecer garantia de entrega "exactly once" sem suporte das APIs externas.

## Validação
- Conferir rota autenticada e ausência de botões de edição de agenda nos três apps.
- Configurar cada agenda na Central mantendo-as desligadas.
- Testar pausa geral e prioridades sem ativar envios.
- Colocar no funil somente uma publicação manual de teste com aprovação do operador.
- Acompanhar estados, logs e conciliação, inclusive após reinício.
- Não testar envio real durante deploy automático.

**Observação:** a pausa reduz colisões. Ela não garante ausência de restrições das plataformas.