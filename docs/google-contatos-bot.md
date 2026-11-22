# Google Contatos como importador do historico permanente da Alumínio JR

## Objetivo
O botão **Conectar e copiar Google** autoriza o acesso somente-leitura ao Google e importa os telefones para o PostgreSQL.
A tabela `bot_google_contatos` e o historico permanente de contatos conhecidos, independente do OAuth.

## Regras implementadas
- A importação e **acumulativa**: faz UPSERT por telefone. Números já conhecidos permanecem no banco, mesmo que sejam removidos do Google.
- Ao reconectar, a autorização e atualizada sem apagar o historico de contatos.
- Ao clicar **Desconectar**, apenas o token OAuth local e revogado e excluído. Os telefones importados continuam registrados.
- Não há sincronização automática em segundo plano; importar só ocorre após **Conectar e copiar Google** ou **Copiar novamente**.
- Com o bot ON, uma mensagem de primeira entrada só dispara a saudação se o número:
  1. for novo em `bot_contatos`;
  2. não existir no arquivo permanente do Google, considerando equivalência do nono dígito brasileiro;
  3. não existir no cadastro legado da JR;
  4. não tiver recebido abordagem da Mala Direta.
- O bot **não depende de conexão Google ativa nem de uma cópia feita nas últimas 24 horas**.
- Se o histórico local estiver vazio ou uma consulta de identificação falhar, bloquear a saudação por segurança.
- Com o bot OFF, não há saudação automática.
- Mensagens não são persistidas por esta integração. O histórico armazena somente dados dos contatos.

## Configuração Google Cloud
Configure o app OAuth e habilite People API com o escopo `https://www.googleapis.com/auth/contacts.readonly`.
Redirect URI padrão:
`https://catalogo-aluminio-jr.onrender.com/bot/admin/google-contatos/callback`

Variáveis de ambiente no Render (não colocar no GitHub):
- `GOOGLE_CONTACTS_CLIENT_ID`
- `GOOGLE_CONTACTS_CLIENT_SECRET`
- `GOOGLE_CONTACTS_ENCRYPTION_KEY` (alternativamente `ADMIN_SESSION_SECRET`, com ao menos 32 caracteres)
- `GOOGLE_CONTACTS_REDIRECT_URI` (opcional)

## Procedimento
1. No `/bot/admin`, ligar o bot e clicar **Conectar e copiar Google**.
2. Autorizar a conta. O callback importa automaticamente os números, sem substituir o histórico.
3. Verificar **Contatos preservados no histórico local**.
4. Em atualizações futuras, clicar **Copiar novamente** ou reconectar.
5. Mesmo se a autorização expirar ou for desconectada, os contatos já copiados continuam protegendo contra saudações indevidas.

**Importante:** O botão não grava conversas. Os contatos do legado e da Mala Direta continuam sendo consultados independentemente do Google.
