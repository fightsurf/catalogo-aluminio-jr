# Agendamento unificado — Alumínio JR

Aplicativos: Status WhatsApp, Republicador YouTube e Central de Ofertas.

## Fluxo
Os agendadores automáticos registram uma tarefa por vez no Funil Central (PostgreSQL):
- Status WhatsApp: adaptadores existentes de fotos e vídeos.
- Republicador YouTube: novo tipo `youtube_video`, job com ID persistente, publicação nas três redes.
- Central de Ofertas: novo tipo `oferta_kit`, publicador existente que usa WhatsApp Status, Instagram, Facebook Stories e Facebook Feed.

## Agendamento
As novas agendas iniciam desligadas. Intervalo padrão de 90 minutos, janela padrão de 06:00 até 22:00 (America/Fortaleza). A pausa global do funil tem padrão de 15 minutos e é compartilhada com o agendamento do Status WhatsApp. A pausa passa a contar depois de uma tarefa terminada ou incerta.

O Republicador lista todas as páginas públicas da playlist (limite 3000), ordena por data ascendente, pula vídeos de duração fora de 3–660 segundos e já publicados com sucesso, e usa IDs de tarefa estáveis por vídeo. A Central de Ofertas percorre os kits não publicados por data crescente, sem repetir kits já publicados manualmente.

Banco preserva fila, último vídeo ou kit concluído e pendências. Em queda do Render, envios que não confirmaram o resultado precisam de conferência; não há reenvio automático inseguro. Use a tela do Funil Central em `/whatsapp/status` para conciliar.

## Faixa nos vídeos
O FFmpeg aplica permanentemente “Consultar preços atualizados” no vídeo vertical antes do upload ao R2. A publicação usa esse MP4 tanto para o Facebook Feed quanto para recortes de Stories/Status.

## Limites
Esta integração encaminha os **agendamentos automáticos** dos três aplicativos ao mesmo funil. Botões de publicação manual existentes mantêm seu comportamento atual. Plataformas externas não fornecem garantia total de envio exatamente uma vez; resultados incertos exigem conferência humana.

Ative explicitamente em `/marketing/republicador-youtube` e `/central-ofertas` apenas após revisar horários e intervalo.