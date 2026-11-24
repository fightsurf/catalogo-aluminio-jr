# MCP de consulta de clientes — Alumínio JR

> Atualização de 24/11/2026: a versão 1.4.1 declara os schemas de saída, completa as annotations de logística e valida a negociação do protocolo. Detalhes em [mcp-contrato-20261124.md](mcp-contrato-20261124.md).

> Atualização de 24/11/2026: a versão 1.4.0 acrescenta [importação de cidades pela Web e pelo MCP](importacao-cidades-ia-mcp.md), com prévia validada e a permissão específica `logistica:write`. O MCP público permanece somente leitura.

> Atualização de 22/11/2026: o pacote de consulta e gestão de pedidos, WhatsApp e expedição está descrito em [mcp-alteracoes-acumuladas-20261122.md](mcp-alteracoes-acumuladas-20261122.md), incluindo os novos escopos e os testes. As restrições de escopo da versão inicial abaixo são históricas.

Implementação **somente leitura**, independente do piloto de transportadoras e da proposta de MCP com gravação de pedidos.

## Endpoints

- `POST /mcp/clientes`: MCP Streamable HTTP, autenticado via OAuth 2.1, com `buscar_clientes`, `consultar_cliente`, `listar_excursoes_transportadoras` e quatro ferramentas de consulta logística.
- `GET /.well-known/oauth-protected-resource/mcp/clientes`: descoberta do recurso.
- `GET /.well-known/oauth-authorization-server`: descoberta do servidor OAuth.
- `GET /oauth/mcp-clientes/authorize`: autentica com o login administrativo da Alumínio JR e mostra consentimento expresso.
- `POST /oauth/mcp-clientes/authorize`: concede/nega o acesso.
- `POST /oauth/mcp-clientes/token`: troca código com PKCE S256 e renova refresh tokens com rotação.

`buscar_clientes` retorna até 10 clientes por nome (mínimo três caracteres), com `favorecido`, `nome`, `cidade`, `uf`, `telefone` (número) e `observacao` se a API legada a disponibilizar. `consultar_cliente` retorna esses mesmos campos para o código de favorecido informado. **No momento a API de clientes do legado não disponibiliza observações**, portanto a resposta apresenta `observacao: null`; não inventamos esse dado.

`listar_excursoes_transportadoras` consulta a tabela compartilhada de excursões/transportadoras, com `id`, `nome`, `cidade`, `uf`, `telefone` (prefere telefone principal), `observacao`, e `cidades_vinculadas` (cidade, UF, código IBGE e observação do vínculo). Permite filtro opcional por nome e paginação de 1 até 50 registros, expondo `tem_proxima_pagina` para percorrer todos os cadastros. A base não separa formalmente excursões das transportadoras nessa consulta.

As quatro ferramentas anteriores (`consultar_transportadoras`, `buscar_cidades`, `listar_cidades_da_transportadora`, `transportadoras_por_cidade`) continuam com seus formatos resumidos e **sem dados de contato**, inclusive no MCP público `/mcp`. As ferramentas detalhadas são declaradas apenas no MCP autenticado `/mcp/clientes` e requerem OAuth administrativo. Não há ferramenta de escrita nem retorno de documentos ou pedidos.

## Segurança

- Desabilitado por padrão: exige `MCP_CLIENTES_ENABLED=true` no ambiente e login administrativo funcional (`ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`).
- Origem HTTPS identificada por `MCP_CLIENTES_PUBLIC_ORIGIN`, padrão `https://catalogo-aluminio-jr.onrender.com`. Para domínio personalizado, mudar essa variável antes de conectar o ChatGPT.
- OAuth authorization code com PKCE S256; identificador CIMD fixo do ChatGPT `https://chatgpt.com/oauth/client.json`, metadados verificados por HTTPS, redirect autorizado fixo `https://chatgpt.com/connector_platform_oauth_redirect`.
- `clientes:read` é o único escopo de negócio; `offline_access` permite refresh token (15 minutos para acesso, 30 dias para refresh). Tokens opacos armazenados apenas pelo hash SHA-256 em PostgreSQL. Refresh e authorization codes são de uso único.
- Sem autenticação, o endpoint de dados retorna 401 e um desafio OAuth apontando para os metadados. Falha no banco ou na validação retorna erro, nunca acesso anônimo.
- Desativar `MCP_CLIENTES_ENABLED` bloqueia todos os acessos imediatamente. Para revogar tokens existentes, invalidar os registros nas tabelas `mcp_clientes_oauth_acessos` e `mcp_clientes_oauth_refresh` ou aguardar sua expiração. Desconectar o plugin **não equivale** a revogar o token no servidor.
- **Revisar o OAuth antes de uso amplo**: é uma implementação específica para o usuário administrativo já existente, não uma solução geral de identidade multiusuário.

## Publicação segura

1. Rodar `node --test tests/mcp-consulta-clientes.test.js tests/mcp-consultas-detalhadas.test.js` e observar o GitHub Actions.
2. Integrar somente o PR de consulta de clientes à branch `main`; não integrar o PR de escrita de pedidos.
3. Publicar no Render. Inicialmente o endpoint fica bloqueado com 503, porque a variável está desabilitada por padrão.
4. Conferir presença do login administrativo e acesso à bridge Firebird; então habilitar `MCP_CLIENTES_ENABLED=true` no Render.
5. Conferir descoberta OAuth em `/.well-known/oauth-protected-resource/mcp/clientes`, autenticação sem token (deve dar 401) e consentimento no navegador. **Não testar com dados sensíveis em logs.**
6. No ChatGPT web, criar app MCP remoto com URL `https://catalogo-aluminio-jr.onrender.com/mcp/clientes`; selecionar OAuth com CIMD, autorizar como administrador e executar `buscar_clientes` com nome de teste, depois `consultar_transportadoras` e `transportadoras_por_cidade`. **Não é necessário criar outro plugin:** a URL conectada permanece `/mcp/clientes`. Talvez seja necessário iniciar uma nova conversa/atualizar o plugin para que o ChatGPT descubra as ferramentas adicionadas.
7. Quando funcionar na web, testar a mesma consulta por voz no Android, sujeito à disponibilidade dos plugins na conta.

A criação de código e os testes de unidade **não comprovam funcionamento real** no Render ou na ponte Firebird. A implementação não altera cadastros nem salva pedidos.
