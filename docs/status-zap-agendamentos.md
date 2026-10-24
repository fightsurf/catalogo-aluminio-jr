# Status Zap — agendamento automático de publicações

## O que foi acrescentado

- Botão **Agendamentos de Publicações** na página `/whatsapp/status`.
- Configuração na página `/whatsapp/status/agendamentos`.
- Seleção de categorias com reordenação e rodízio contínuo.
- Intervalo em horas/minutos (1 a 10.080 minutos); intervalo entre produtos separado (3 a 300 segundos).
- Janela de início das publicações, usando **America/Fortaleza**; horários iguais significam 24 horas.
- Seleção de WhatsApp Status, Instagram Stories e Facebook Stories.
- Fotos, vídeos ou ambos; o feed em carrossel do Facebook acompanha o modo **Apenas fotos** quando Facebook estiver selecionado.
- Painel de última categoria, próxima categoria, próxima execução, execução atual e histórico das últimas 25 execuções.
- Histórico de envios por produto/canal no PostgreSQL, com bloqueio de execução concorrente via `pg_try_advisory_lock`.

## Comportamento e segurança

**A automação começa desativada.** O primeiro lote é agendado para um intervalo completo após a ativação, respeitando a janela de horário.

O worker é iniciado pelo `server.js` e verifica a fila a cada 60 segundos, independentemente de a página estar aberta.

As tabelas `status_zap_agendamento`, `status_zap_agendamento_lotes` e `status_zap_agendamento_itens` são criadas automaticamente no PostgreSQL, com `CREATE TABLE IF NOT EXISTS`.

Para imagens, antes do envio externo, o item passa para `enviando`; depois da confirmação, vira `publicado`. Se a execução for interrompida, ou a API externa falhar após o início do envio, o item é marcado como `incerto`, e **não é reenviado automaticamente**, para evitar Stories duplicados. Para vídeo, a integração usa a fila persistente já existente em `status_produto_video_jobs`; após reinícios, os envios pendentes seguem as regras de confirmação do módulo original.

Falhas e itens incertos aparecem no histórico; deve-se conferir a rede de destino antes de decidir republicar manualmente. Isso é intencional: não há garantia universal de publicação exatamente uma vez em APIs externas.

## Hospedagem

A execução automática requer que a instância web no Render fique **continuamente ativa**. Em serviços que suspendem por inatividade, os horários não são garantidos; o worker retoma quando o servidor voltar a executar. A precisão do disparo é aproximadamente de um minuto, além do tempo necessário para terminar o lote anterior.

Não há serviço Cron independente configurado por este patch, nem alteração de variáveis de ambiente. É necessário que o usuário do banco tenha permissão para criar as três tabelas.

## Verificação antes de subir para produção

1. Abrir a página de agendamentos e confirmar que está desativada.
2. Selecionar uma única categoria pequena e somente uma rede, com uma janela ampla.
3. Usar intervalo curto para testes e ativar; conferir o resultado na rede social e no histórico.
4. Testar fotos e vídeos separadamente, inclusive pausa, reinício e reativação.
5. Ampliar as categorias e as redes depois de validar as integrações e os limites de publicação.

Arquivos principais:
- `src/services/whatsapp/status-agendamentos.service.js`
- `src/controllers/whatsapp/status-agendamentos.controller.js`
- `views/whatsapp/status-agendamentos.html`

A branch de desenvolvimento não altera o `main` nem dispara a publicação em produção até ser integrada/deployada.
