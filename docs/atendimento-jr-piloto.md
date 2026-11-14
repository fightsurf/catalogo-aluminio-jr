# Atendimento virtual da Alumínio JR — piloto seguro

## Situação
Código proposto, ainda não publicado em produção. O webhook direto da Z-API já utilizado pelo sistema é aproveitado para despachar o piloto quando explicitamente ativado. Um endpoint isolado continua disponível, mas não precisa do n8n. Apenas o número da lista de teste pode receber respostas do piloto.

## Ativação controlada (após revisão, merge e deploy)
1. Preservar o webhook em operação da Z-API (`POST /api/whatsapp/webhook/zapi`), sem trocar URLs. O fluxo atual de registro e comandos `@` permanece. Para o número de teste, impedir que outro fluxo também responda automaticamente. Não depende do n8n.
2. Configurar estas variáveis somente no Render:
   - ATENDIMENTO_JR_PILOTO=1 (sem isso, nenhuma resposta)
   - ATENDIMENTO_JR_NUMEROS_TESTE=55DDDNÚMERO (lista separada por vírgulas; nunca vazia)
   - Preços: usar diretamente o campo `preco` do cadastro de produtos ativos, sem perfil comercial, acréscimo ou desconto. Não definir `ATENDIMENTO_JR_PERFIL_TOKEN`.
   - ATENDIMENTO_JR_VENDEDOR=55DDDNÚMERO (destino de aviso quando o cliente pede atendimento humano)
   - OPENAI_API_KEY, ZAPI_URL, ZAPI_TOKEN, ZAPI_WEBHOOK_TOKEN, ZAPI_WEBHOOK_INSTANCE_ID (conforme integrações existentes)
   - ELEVENLABS_API_KEY e ATENDIMENTO_JR_VOZ_ID (ou ELEVENLABS_VOICE_ID) para síntese de voz. Modelo padrão: eleven_multilingual_v2.
3. Após merge e deploy, o callback já recebido no webhook direto aciona o piloto somente quando `ATENDIMENTO_JR_PILOTO=1` e o telefone pertence à allowlist; não é necessário encaminhar cópia ou reativar n8n. Para ambientes que ainda usam outro gateway, há rota autenticada isolada `POST /api/whatsapp/webhook/zapi/atendimento-piloto`, mas NÃO conectar as duas fontes ao mesmo tempo. Nunca publicar o segredo.
4. Testar texto, preço da tabela sem perfil, valores ausentes/inválidos, múltiplos preços na mesma mensagem, quantidades, áudio, foto/vídeo, pedido, duplicidade de messageId e número não autorizado.
5. Verificar que a intenção de compra muda bot_contatos.nivel_atendimento para HUMANO, envia aviso ao telefone de vendedor configurado e suspende futuras respostas automáticas. O retorno para IA exige ação manual no cadastro.
6. Só depois planejar liberação geral com regras comerciais, monitoramento e deduplicação persistente. O piloto usa apenas o preço cadastrado do produto ativo.

## Limitações deliberadas
- Não ativar para todos ainda. O piloto exige uma lista de telefones autorizados; neste teste, exclusivamente `5583998099164`. O valor deve ser configurado no Render, não apenas documentado.
- O usuário definiu a tabela de preços do cadastro como fonte exclusiva. Não aplicar perfil comercial, margem adicional ou desconto. Caso o preço esteja ausente ou inválido, informar que não está disponível em vez de inventar um valor.
- Modelos semelhantes são apresentados como alternativas em vez de supor qual o cliente deseja.
- A primeira versão responde questões de catálogo/preço e não confirma estoque, desconto, frete ou prazo. O aviso ao vendedor só é enviado quando `ATENDIMENTO_JR_VENDEDOR` estiver corretamente configurado; na ausência dele a conversa ainda é marcada como HUMANO no banco.
- Áudio recebido é transcrito; se ElevenLabs falhar, responde em texto com aviso, sem fingir ter enviado áudio.
- Contexto e deduplicação são mantidos em memória, adequados apenas para este piloto de uma instância.
- Testes unitários não verificam mensagens entregues pelo WhatsApp. Validar integrações reais antes de ampliar o atendimento.
