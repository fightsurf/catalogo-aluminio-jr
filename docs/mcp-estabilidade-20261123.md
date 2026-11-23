# Estabilidade da conexão e diagnóstico de pedidos — MCP 1.3.1

## Problemas corrigidos

A troca de código de autorização e a renovação de tokens consumiam a credencial
antiga antes de persistir os dois tokens novos, em consultas independentes.
Uma falha intermediária de banco podia deixar a conexão sem refresh utilizável
e causar `invalid_grant` na tentativa seguinte. O defeito foi reproduzido com
banco simulado, sem chamadas de produção.

O consumo e a emissão agora ocorrem na mesma transação, usando uma conexão
dedicada. Falhas anteriores ao commit fazem rollback. A decisão de consentimento
e a emissão do código também são atômicas. Se o rollback falhar, a conexão é
descartada. Não há migração nem mudança de validade, escopos, cliente/recurso,
PKCE ou proteção de uso único.

Isso cobre falhas de persistência anteriores ao commit. A perda da confirmação
do COMMIT no transporte do banco, ou da resposta HTTP depois de um commit
concluído, continua sendo um resultado incerto; não se libera reutilização de
refresh consumido. O teste de falha no COMMIT simula erro antes da efetivação.

O challenge de permissão insuficiente agora inclui `error_description`, além
de `error`, em `_meta["mcp/www_authenticate"]`, como exige a documentação de
autenticação do cliente. O texto de consentimento também acompanha o fluxo
publicado: criar pedido/carrada não envia WhatsApp; mensagens têm permissão
e confirmação próprias.

## O que a auditoria comprovou

Consulta aos registros do serviço de produção em 23/11/2026:

- Sete chamadas de `confirmar_pedido` alcançaram `confirmado`, entre 11h58 e
  13h47 no horário de Brasília. Isso comprova execução naquele período,
  sem garantir aprovação de ações futuras.
- Na tentativa das 15h53, `preparar_pedido` chegou a
  `aguardando_confirmacao`; às 15h54 a consulta do rascunho ainda mostrou
  esse estado. Não há evento de entrada de `confirmar_pedido` nessa janela.
- Houve HTTP 401 às 15h50min30s, anterior à preparação bem-sucedida.
  Ausência de evento de ferramenta não basta para atribuir a causa à
  revisão do cliente: a auditoria anterior começava depois da autenticação.
- O catálogo carregado e a implementação publicada usavam o mesmo fluxo
  separado da versão 1.3.0. Não foi identificado descompasso que justificasse
  solicitar outra reconexão por esse motivo.

O problema transacional é comprovável, mas os registros não demonstram que
ele causou a recusa da confirmação das 15h53. Nenhum pedido foi criado ou
recriado e nenhuma mensagem foi enviada para validar esta correção.

## Diagnóstico a partir da versão 1.3.1

Cada requisição recebe um UUID gerado pelo servidor. O mesmo identificador
aparece nos headers `X-MCP-Rastreio` / `X-MCP-Versao`, no `_meta` das respostas
de ferramenta e nos eventos da auditoria.

| Evidência | Interpretação |
| --- | --- |
| `autenticacao_necessaria`, HTTP 401 | Credencial ausente, expirada ou inválida; não executou a ferramenta. |
| `servico_desativado`, HTTP 503 | Integração desabilitada; não executou a ferramenta. |
| `autenticacao_indisponivel`, HTTP 503 | Falha ao verificar a credencial; não executou a ferramenta. |
| `recebida` e `escopo_insuficiente` | Requisição autenticada, mas faltou permissão; retorna challenge completo. |
| `recebida` e `confirmado` | A rotina confirmou a gravação; conferir também o resultado devolvido. |
| `em_processamento` / `revisao_necessaria` | Consultar o estado; não repetir a gravação automaticamente. |
| Nenhum evento compatível | Correlacionar logs HTTP e mensagem exata do cliente; não concluir apenas pela ausência. |

Os novos eventos de autenticação não registram ferramenta arbitrária, usuário,
argumentos, tokens, códigos de confirmação, telefone ou texto de mensagens.

Uma rejeição explícita da revisão de segurança do ChatGPT não é removida por
alterar anotações, ampliar escopos ou reconectar repetidamente. As anotações
de escrita e as confirmações continuam intactas. A aceitação de uma futura
gravação só pode ser comprovada por uma operação realmente autorizada.

## Validação

Os 149 testes passaram. Eles usam dependências simuladas, sem PostgreSQL, Firebird, clientes ou
mensagens reais. Cobrem rollback em falhas de emissão, concorrência com apenas
um par de tokens emitido, PKCE, consentimento, expiração, escopos, vínculo com
cliente/recurso e diagnóstico sem dados sensíveis. O carregador de testes de
pedidos passou a incluir o módulo puro de descrição de produtos, adicionado
anteriormente ao serviço, para voltar a executar as regressões de gravação.

```sh
node --test tests/mcp-*.test.js tests/pedidos-insercao-v2-aviso-mcp.test.js tests/relatorio-fotos-previa.test.js
```

Após a publicação, confirmar o deploy ativo e correlacionar uma consulta
autenticada com a versão 1.3.1 nos logs. Essa consulta valida a conexão e o
deploy; não substitui a validação de uma escrita futura autorizada.

## Referências

- [Autenticação e challenge OAuth](https://developers.openai.com/plugins/build/auth.md#triggering-authentication-ui).
- [Falhas de ações e bloqueios explícitos](https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt).
