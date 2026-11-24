# Importação de cidades atendidas — Web e MCP 1.4.0

## Na página de logística

1. Abra `/admin-logistica` e selecione a transportadora ou excursão.
2. Clique em **Importar cidades por IA**.
3. Cole a lista ou envie até cinco fotos JPG, PNG ou WebP, ou um PDF. Os arquivos juntos podem ter até 10 MB; o texto pode ter até 20.000 caracteres.
4. Se a fonte não informa estados, escolha explicitamente uma UF padrão. A UF da sede da transportadora não é usada como padrão.
5. Clique em **Analisar com IA**. Revise a lista editável de municípios e UFs. A prévia compara a lista com o cadastro existente.
6. Corrija ou remova os itens pendentes e clique em **Conferir cidades**. Só uma prévia sem pendências habilita **Importar cidades**.

A prévia mostra cidades novas, já vinculadas, repetidas e pendências. O limite é de 300 entradas por lote. Nenhum município é criado automaticamente. Cidades ausentes ou ambíguas precisam ser corrigidas antes de importar. Cidades sem código IBGE são identificadas pelo ID interno e podem ser removidas pelo mesmo ID na lista da tela.

A confirmação acrescenta os vínculos novos em uma transação e preserva todas as observações e os vínculos existentes. Repetir uma lista não duplica os vínculos. A página exige sessão administrativa nos endpoints de extração, prévia e confirmação.

## No MCP autenticado

As ferramentas novas existem somente em `/mcp/clientes`:

| Ferramenta | Permissão | Comportamento |
| --- | --- | --- |
| `preparar_importacao_cidades` | `clientes:read` | Confere a transportadora, os municípios e as UFs; retorna prévia assinada, sem gravar. |
| `confirmar_importacao_cidades` | `clientes:read logistica:write` | Acrescenta os vínculos da prévia aprovada, com token e `confirmacao: "CONFIRMO"`. |

Primeiro localize a transportadora pelas consultas existentes. Prepare a lista com o ID retornado, nomes e UFs fornecidos pelo usuário. Mostre a prévia e resolva as pendências antes de confirmar. Código IBGE é opcional; quando informado, precisa coincidir com o cadastro. O MCP público `/mcp` continua com suas quatro ferramentas somente de leitura.

O token da prévia dura 20 minutos e está associado à conta, transportadora e lista canônica. O servidor verifica novamente os cadastros dentro da transação antes de gravar. Tokens alterados, vencidos ou de outra conta/alvo são recusados. Em perda de resposta, consulte os vínculos atuais antes de prosseguir.

O catálogo do plugin precisa carregar as duas novas ferramentas depois do deploy. Tokens antigos preservam seus escopos; não ganham escrita silenciosamente. A confirmação solicita a autorização `logistica:write` pelo fluxo OAuth quando ela estiver ausente. A tela de consentimento e os metadados OAuth descrevem essa permissão. Não é necessário alterar as permissões de pedidos ou WhatsApp.

## Configuração e implementação

- Reutiliza `OPENAI_API_KEY`; `LOGISTICA_CIDADES_IA_MODEL` é opcional, com padrão `gpt-4o-mini`, seguindo a integração já usada no sistema.
- Reutiliza `ADMIN_SESSION_SECRET` para assinar prévias em um contexto próprio.
- Não exige migração nem variáveis novas obrigatórias.
- A extração por IA não acessa o banco. Arquivos são enviados para a IA em memória e não são salvos pelo aplicativo.
- A gravação Web e MCP chama `importacaoCidades.service`, que reutiliza `logisticaService.vincularCidadePorId` com preservação de vínculos existentes.
- O upload verifica limites, MIME e assinatura; imagens também são decodificadas com limite de pixels. Resposta truncada ou estruturalmente inválida da IA é rejeitada.

## Verificação local

```bash
node --test tests/importacao-cidades*.test.js tests/mcp-*.test.js
```

Os testes usam banco/provedor simulados e verificam prévia sem gravação, validação, repetição, preservação de observações, rollback, adulteração/expiração de token, conta e alvo, escopos OAuth, isolamento do MCP público e os contratos HTTP de upload/prévia/confirmação.
