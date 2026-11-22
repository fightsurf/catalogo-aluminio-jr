# MCP de consulta de clientes — Alumínio JR

Implementação **somente leitura**, independente do piloto de transportadoras e da proposta de MCP com gravação de pedidos.

## Endpoints

- `POST /mcp/clientes`: MCP Streamable HTTP, autenticado via OAuth 2.1, com `buscar_clientes` e quatro ferramentas de consulta logística.
- `GET /.well-known/oauth-protected-resource/mcp/clientes`: descoberta do recurso.
- `GET /.well-known/oauth-authorization-server`: descoberta do servidor OAuth.
- `GET /oauth/mcp-clientes/authorize`: autentica com o login administrativo da Alumínio JR e mostra consentimento expresso.
- `POST /oauth/mcp-clientes/authorize`: concede/nega o acesso.
- `POST /oauth/mcp-clientes/token`: troca código com PKCE S256 e renova refresh tokens com rotação.

A consulta de clientes retorna somente `favorecido`, `nome`, `cidade` e `uf`, no máximo 10 resultados. Filtro de nome obrigatório (mínimo três caracteres). Não retorna telefone, documentos, observações ou detalhes de pedidos. Também são oferecidas `consultar_transportadoras`, `buscar_cidades`, `listar_cidades_da_transportadora` e `transportadoras_por_cidade`, reaproveitando o código do MCP de logística já existente. Não retornam telefones, documentos nem observações. Não há ferramenta de escrita neste endpoint.

## Segurança

- Desabilitado por padrão: exige `MCP_CLIENTES_ENABLED=true` no ambiente e login administrativo funcional (`ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`).
- Origem HTTPS identificada por `MCP_CLIENTES_PUBLIC_ORIGIN`, padrão `https://catalogo-aluminio-jr.onrender.com`. Para domínio personalizado, mudar essa variável antes de conectar o ChatGPT.
- OAuth authorization code com PKCE S256; identificador CIMD fixo do ChatGPT `https://chatgpt.com/oauth/client.json`, metadados verificados por HTTPS, redirect autorizado fixo `https://chatgpt.com/connector_platform_oauth_redirect`.
- `clientes:read` é o único escopo de negócio; `offline_access` permite refresh token (15 minutos para acesso, 30 dias para refresh). Tokens opacos armazenados apenas pelo hash SHA-256 em PostgreSQL. Refresh e authorization codes são de uso único.
- Sem autenticação, o endpoint de dados retorna 401 e um desafio OAuth apontando para os metadados. Falha no banco ou na validação retorna erro, nunca acesso anônimo.
- Desativar `MCP_CLIENTES_ENABLED` bloqueia todos os acessos imediatamente. Para revogar tokens existentes, invalidar os registros nas tabelas `mcp_clientes_oauth_acessos` e `mcp_clientes_oauth_refresh` ou aguardar sua expiração. Desconectar o plugin **não equivale** a revogar o token no servidor.
- **Revisar o OAuth antes de uso amplo**: é uma implementação específica para o usuário administrativo já existente, não uma solução geral de identidade multiusuário.

## Publicação segura

1. Rodar `node --test tests/mcp-consulta-clientes.test.js` e observar o GitHub Actions.
2. Integrar somente o PR de consulta de clientes à branch `main`; não integrar o PR de escrita de pedidos.
3. Publicar no Render. Inicialmente o endpoint fica bloqueado com 503, porque a variável está desabilitada por padrão.
4. Conferir presença do login administrativo e acesso à bridge Firebird; então habilitar `MCP_CLIENTES_ENABLED=true` no Render.
5. Conferir descoberta OAuth em `/.well-known/oauth-protected-resource/mcp/clientes`, autenticação sem token (deve dar 401) e consentimento no navegador. **Não testar com dados sensíveis em logs.**
6. No ChatGPT web, criar app MCP remoto com URL `https://catalogo-aluminio-jr.onrender.com/mcp/clientes`; selecionar OAuth com CIMD, autorizar como administrador e executar `buscar_clientes` com nome de teste, depois `consultar_transportadoras` e `transportadoras_por_cidade`. **Não é necessário criar outro plugin:** a URL conectada permanece `/mcp/clientes`. Talvez seja necessário iniciar uma nova conversa/atualizar o plugin para que o ChatGPT descubra as ferramentas adicionadas.
7. Quando funcionar na web, testar a mesma consulta por voz no Android, sujeito à disponibilidade dos plugins na conta.

A criação de código e os testes de unidade **não comprovam funcionamento real** no Render ou na ponte Firebird. A implementação não altera cadastros nem salva pedidos.
