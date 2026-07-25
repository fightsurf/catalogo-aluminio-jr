# Central de Ofertas — Kit Feirinha

## Rotas novas
- `/central-ofertas` — página administrativa protegida por login.
- `/ofertas/:codigo` — relatório público para o cliente.
- `/api/ofertas/*` — criação, arte, publicação, histórico e métricas.

A página `/kits-feirinha` não foi modificada.

## Variáveis de ambiente
```env
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-1-mini
OPENAI_IMAGE_QUALITY=medium
APP_PUBLIC_URL=https://catalogo-aluminio-jr.onrender.com
```

As variáveis já existentes do Cloudflare R2, Z-API, PostgreSQL e login administrativo continuam obrigatórias.

## Funcionamento da arte
1. A OpenAI gera somente o cenário, sem produtos e sem texto.
2. O Sharp coloca as fotos reais dos produtos em cartões organizados.
3. Nomes, quantidade, preço médio, total e contatos são desenhados pelo servidor.
4. A imagem final é salva no R2 e publicada pela integração Z-API existente.

Sem `OPENAI_API_KEY`, o sistema usa um fundo gráfico local para permitir testes.

## Implantação
1. Substitua os arquivos pelo ZIP completo ou aplique o ZIP de patch.
2. Execute `npm install` (a dependência `sharp` foi adicionada).
3. Configure as variáveis acima no Render.
4. Faça o deploy.
5. Entre em `/central-ofertas`.

A estrutura do banco também é criada automaticamente no primeiro uso. O SQL está em `db/sql/20260725_central_ofertas.sql` para execução manual opcional.
