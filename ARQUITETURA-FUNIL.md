# Funil Central de Publicações — primeira fase

## Fluxo de trabalho

Agendamento Status Zap → `enfileirarLote(...)` → `marketing_fila_lotes` e `marketing_fila_itens`
→ executor com bloqueio PostgreSQL → adaptador Status Zap → redes sociais → logs.

**Somente o Status Zap está conectado neste patch.** Os demais módulos de marketing serão
integrados em fases posteriores, com adaptadores próprios. Nenhum módulo existente foi
alterado além do Status Zap.

## Contrato de persistência

| Tabela | Função |
| --- | --- |
| `marketing_fila_lotes` | Agrupa publicações por módulo, categoria, origem e chave única. |
| `marketing_fila_itens` | Registra individualmente as tarefas, seu estado e ID estável. |
| `marketing_fila_canais` | Confirmação por rede social para publicações fotográficas. |
| `marketing_fila_eventos` | Log de falhas, tentativas, recuperação e decisões do administrador. |
| `status_produto_video_jobs` | Jobs de vídeo já existentes, com histórico de partes e canais. |

## Estados principais

- `pendente`: ainda não enviada.
- `executando`: operação de envio iniciada e persistida previamente.
- `aguardando_video`: vídeo ainda em preparo/processamento, monitorado sem limite artificial de 30 minutos.
- `aguardando_retry`: falha recuperável, com próxima tentativa programada.
- `concluido` / `ignorado`: execução confirmada ou não publicável.
- `incerto`: canal pode ter recebido publicação, exige conferência antes de repetir.
- `atencao`: tentativas automáticas esgotadas; tarefa não é descartada.

Lotes terminam como `concluido` ou `pendencias`. Pendências individuais continuam
registradas e podem ser conciliadas sem republicar tarefas confirmadas.

## Integração de futuros módulos

`src/services/marketing/funilPublicacoes.service.js` exporta `enfileirarLote({origem,
chaveOrigem,categoriaId,categoriaNome,tipoMidia,itens,metadados})`.

O enfileiramento é transacional e usa `chaveOrigem` única para evitar cadastrar
o mesmo lote repetidamente. Atualmente os tipos de tarefa admitidos são
`statuszap_produto` e `statuszap_feed`. Para novos módulos, criar o adaptador
idempotente apropriado e ampliar a validação/roteamento no executor. Não enviar
publicações externas diretamente do endpoint que agenda a tarefa.

## Concorrência e limites

- Um lock consultivo PostgreSQL global protege a execução de um passo por vez,
  inclusive durante a transição do agendador legado.
- A publicação de vídeo é assíncrona; a próxima tarefa só é liberada depois que o
  respectivo job de vídeo conclui, falha definitivamente ou exige reconciliação.
- Um resultado externo incerto **não** autoriza reenvio automático.
- A confirmação manual deixa rastros no log.
- Jobs são preservados após reinício do servidor. A entrega real depende das
  APIs de terceiros; consistência "exactly once" ponta a ponta não é possível
  sem idempotência/consulta de estado garantida pelo provedor.
