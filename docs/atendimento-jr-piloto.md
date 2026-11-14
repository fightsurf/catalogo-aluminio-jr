# Atendimento virtual da Alumínio JR — piloto seguro

## Situação
Código proposto, não publicado em produção. O webhook principal da Z-API/n8n não é alterado. Um endpoint separado recebe uma cópia do evento original e só responde aos números da lista de teste.

## Ativação controlada (após revisão, merge e deploy)
1. Manter o webhook atual do n8n. Para o número de teste, impedir que fluxos existentes respondam simultaneamente.
2. Configurar estas variáveis somente no Render:
   - ATENDIMENTO_JR_PILOTO=1 (sem isso, nenhuma resposta)
   - ATENDIMENTO_JR_NUMEROS_TESTE=55DDDNÚMERO (lista separada por vírgulas; nunca vazia)
   - ATENDIMENTO_JR_PERFIL_TOKEN=TOKEN_COMERCIAL_ATIVO (token do perfil comercial aprovado; nunca usar preço-base sem perfil)
   - ATENDIMENTO_JR_VENDEDOR=55DDDNÚMERO (destino de aviso quando o cliente pede atendimento humano)
   - OPENAI_API_KEY, ZAPI_URL, ZAPI_TOKEN, ZAPI_WEBHOOK_TOKEN, ZAPI_WEBHOOK_INSTANCE_ID (conforme integrações existentes)
   - ELEVENLABS_API_KEY e ATENDIMENTO_JR_VOZ_ID (ou ELEVENLABS_VOICE_ID) para síntese de voz. Modelo padrão: eleven_multilingual_v2.
3. No n8n, encaminhar uma cópia do payload Z-API original, incluindo áudio, para
   POST /api/whatsapp/webhook/zapi/atendimento-piloto?chave=SEU_SEGREDO
   com JSON. O segredo é o mesmo do webhook configurado no Render; nunca publicá-lo.
4. Testar texto, múltiplos preços na mesma mensagem, quantidades, áudio, foto/vídeo, pedido, duplicidade de messageId e número não autorizado.
5. Verificar que a intenção de compra muda bot_contatos.nivel_atendimento para HUMANO, envia aviso ao telefone de vendedor configurado e suspende futuras respostas automáticas. O retorno para IA exige ação manual no cadastro.
6. Só depois planejar liberação geral com tabela comercial padrão, vínculo cliente-perfil, monitoramento e deduplicação persistente.

## Limitações deliberadas
- Não ativar para todos ainda. O piloto exige uma lista de telefones autorizados.
- A tabela padrão para novos clientes precisa ser aprovada. O vínculo entre cliente cadastrado e perfil de preço ainda não foi implementado; o piloto usa um único perfil comercial configurado.
- Modelos semelhantes são apresentados como alternativas em vez de supor qual o cliente deseja.
- A primeira versão responde questões de catálogo/preço e não confirma estoque, desconto, frete ou prazo.
- Áudio recebido é transcrito; se ElevenLabs falhar, responde em texto com aviso, sem fingir ter enviado áudio.
- Contexto e deduplicação são mantidos em memória, adequados apenas para este piloto de uma instância.
- Testes unitários não verificam mensagens entregues pelo WhatsApp. Validar integrações reais antes de ampliar o atendimento.
