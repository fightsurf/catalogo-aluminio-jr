# Atendimento virtual da Alumínio JR — piloto seguro

## Situação
Código proposto, não publicado em produção. O webhook principal da Z-API/n8n não é alterado. Um endpoint separado recebe uma cópia do evento original e só responde aos números da lista de teste.

## Ativação controlada (após revisão, merge e deploy)
1. Preservar o webhook em operação da Z-API. Para o número de teste, impedir que fluxos existentes respondam simultaneamente. Não reativar n8n nem trocar URLs sem confirmar o caminho atual de entrada de mensagens.
2. Configurar estas variáveis somente no Render:
   - ATENDIMENTO_JR_PILOTO=1 (sem isso, nenhuma resposta)
   - ATENDIMENTO_JR_NUMEROS_TESTE=55DDDNÚMERO (lista separada por vírgulas; nunca vazia)
   - Preços: usar diretamente o campo `preco` do cadastro de produtos ativos, sem perfil comercial, acréscimo ou desconto. Não definir `ATENDIMENTO_JR_PERFIL_TOKEN`.
   - ATENDIMENTO_JR_VENDEDOR=55DDDNÚMERO (destino de aviso quando o cliente pede atendimento humano)
   - OPENAI_API_KEY, ZAPI_URL, ZAPI_TOKEN, ZAPI_WEBHOOK_TOKEN, ZAPI_WEBHOOK_INSTANCE_ID (conforme integrações existentes)
   - ELEVENLABS_API_KEY e ATENDIMENTO_JR_VOZ_ID (ou ELEVENLABS_VOICE_ID) para síntese de voz. Modelo padrão: eleven_multilingual_v2.
3. Encaminhar uma cópia do payload Z-API original, incluindo áudio, para
   POST /api/whatsapp/webhook/zapi/atendimento-piloto?chave=SEU_SEGREDO
   com JSON, pelo caminho de eventos que estiver ativo. A rota isolada ainda exige merge e deploy.
   O segredo é o mesmo do webhook configurado no Render; nunca publicá-lo. Evitar troca do webhook principal ou resposta duplicada.
4. Testar texto, preço da tabela sem perfil, valores ausentes/inválidos, múltiplos preços na mesma mensagem, quantidades, áudio, foto/vídeo, pedido, duplicidade de messageId e número não autorizado.
5. Verificar que a intenção de compra muda bot_contatos.nivel_atendimento para HUMANO, envia aviso ao telefone de vendedor configurado e suspende futuras respostas automáticas. O retorno para IA exige ação manual no cadastro.
6. Só depois planejar liberação geral com regras comerciais, monitoramento e deduplicação persistente. O piloto usa apenas o preço cadastrado do produto ativo.

## Limitações deliberadas
- Não ativar para todos ainda. O piloto exige uma lista de telefones autorizados; neste teste, exclusivamente `5583998099164`. O valor deve ser configurado no Render, não apenas documentado.
- O usuário definiu a tabela de preços do cadastro como fonte exclusiva. Não aplicar perfil comercial, margem adicional ou desconto. Caso o preço esteja ausente ou inválido, informar que não está disponível em vez de inventar um valor.
- Modelos semelhantes são apresentados como alternativas em vez de supor qual o cliente deseja.
- A primeira versão responde questões de catálogo/preço e não confirma estoque, desconto, frete ou prazo.
- Áudio recebido é transcrito; se ElevenLabs falhar, responde em texto com aviso, sem fingir ter enviado áudio.
- Contexto e deduplicação são mantidos em memória, adequados apenas para este piloto de uma instância.
- Testes unitários não verificam mensagens entregues pelo WhatsApp. Validar integrações reais antes de ampliar o atendimento.
