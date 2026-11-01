# Escopo de implantação do agendamento unificado

- Status WhatsApp: permanece usando o funil existente.
- Republicador YouTube: agenda automática desativada por padrão; vídeos públicos mais antigos primeiro; uma tarefa em andamento por vez.
- Central de Ofertas: agenda automática desativada por padrão; kits ainda não publicados mais antigos primeiro.
- Os dois novos agendadores usam a mesma tabela de tarefas e o mesmo executor do Status WhatsApp.
- Há controle global de intervalo entre tarefas. Padrão: 15 minutos. Editável em ambos os novos painéis.
- O sucesso só é registrado após confirmação das redes. Um erro incerto exige conciliação humana no Funil Central.
- Reinício do servidor não apaga fila nem reinicia contagem dos vídeos. Retoma consulta do estado persistido.
- Vídeos do Republicador recebem faixa fixa “Consultar preços atualizados” no MP4 encaminhado às redes.
- Os caminhos de publicação **manual** antigos permanecem funcionando como antes e não passam automaticamente pelo novo funil; esta implementação unifica os **agendamentos automáticos**.
- Nenhum agendamento é ligado pelo deploy. O operador precisa ativar explicitamente.

Teste: node --test tests/agendamento-unificado.test.js
