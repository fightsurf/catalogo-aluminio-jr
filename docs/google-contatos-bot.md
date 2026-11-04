# Google Contatos no Bot Admin da Alumínio JR

## Objetivo
Evitar falso lead e saudação de primeiro contato para números que já estão no Google Contatos
ou no cadastro de clientes da Alumínio JR. Número novo apenas na tabela bot_contatos
não é suficiente para afirmar que é novo cliente.

## Regra ON/OFF
- Bot OFF: receber/exibir mensagens normalmente; nenhuma consulta Google, nenhuma
  sincronização automática, nenhuma saudação automática de primeiro contato.
- Bot ON: sincronizar contatos do Google (aproximadamente a cada 1 hora), consultar
  o snapshot local somente para números novos e conferir cadastro legado da JR.
- Em falha de conexão, dados não sincronizados ou API legado indisponível:
  **não enviar saudação automática** (fail closed).
- É possível desconectar manualmente o Google mesmo com bot OFF.

## Configuração no Google Cloud
1. Crie ou use um projeto Google Cloud de propriedade da Alumínio JR.
2. Ative a **People API**.
3. Configure a tela de consentimento OAuth para a conta autorizada. Escopo:
   https://www.googleapis.com/auth/contacts.readonly
4. Crie uma credencial OAuth Client ID do tipo Web application.
5. Em Authorized redirect URIs, cadastre exatamente:
   https://catalogo-aluminio-jr.onrender.com/bot/admin/google-contatos/callback
6. No modo Testing, tokens podem expirar em 7 dias. Providencie publicação
   e verificação de escopo exigida pelo Google quando aplicável.

## Variáveis do Render (Environment, nunca no GitHub)
- GOOGLE_CONTACTS_CLIENT_ID: ID do cliente OAuth Web.
- GOOGLE_CONTACTS_CLIENT_SECRET: segredo do cliente OAuth Web.
- GOOGLE_CONTACTS_ENCRYPTION_KEY: segredo estável e aleatório de pelo menos
  32 caracteres. Recomendado, embora possa reutilizar ADMIN_SESSION_SECRET
  caso ele já tenha 32 caracteres ou mais.
- GOOGLE_CONTACTS_REDIRECT_URI: opcional se o domínio da JR mudar.

Não inclua credenciais em código, prints ou documentação pública.
Alterar a chave criptográfica depois da conexão exige reconectar o Google.

## Ativar pelo painel
1. Abra /bot/admin autenticado.
2. Ligue o bot.
3. Na seção Google Contatos, clique em Conectar Google.
4. Autorize acesso somente-leitura.
5. Confira Telefones sincronizados e Última sincronização.
6. Teste telefone conhecido apenas no Google e telefone realmente novo.
7. Sincronizar agora atualiza sob demanda; depois a sincronização é periódica
   enquanto o bot estiver ON.
8. Desconectar remove credencial local e contatos sincronizados e tenta revogar
   a autorização do Google.

## Segurança
- Armazena apenas nomes e números do Google no PostgreSQL; não copia
  mensagens, fotos, e-mails ou outros dados da agenda.
- Refresh token criptografado com AES-256-GCM no banco.
- Rotas exigem login administrativo.
- OAuth usa state aleatório e cookie HttpOnly/SameSite=Lax.
- Tokens OAuth não aparecem nas respostas ao navegador.
- Com sincronização ausente ou mais antiga que 24h, saudação automática é bloqueada.
- Não mudar o webhook n8n/Z-API durante essa integração.
