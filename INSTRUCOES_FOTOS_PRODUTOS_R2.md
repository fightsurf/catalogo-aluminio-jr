# Patch por cima - Fotos de produtos no Cloudflare R2

Este patch substitui o upload feito para Cloudflare Images pelo upload no Cloudflare R2.

## O que muda

- Mantém a estrutura de até 6 fotos por produto.
- Mantém `foto` como Foto 1 principal.
- Mantém `foto_2` até `foto_6` como fotos opcionais.
- O admin continua usando a mesma rota: `POST /api/produtos/:id/fotos/:posicao`.
- O backend envia a imagem para o Cloudflare R2 e salva a URL pública no produto.
- As páginas públicas do catálogo não foram alteradas.

## Arquivos alterados/adicionados

- `package.json`
- `.env.example`
- `render.yaml`
- `views/produto/admin-produtos.html`
- `src/controllers/produto/produto.controller.js`
- `src/services/cloudflare/cloudflareR2.service.js`

O arquivo antigo abaixo pode ficar no projeto sem problema. Ele não será mais usado pelo controller:

- `src/services/cloudflare/cloudflareImages.service.js`

## Variáveis de ambiente necessárias no Render

Crie no Render:

```env
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_PUBLIC_URL=https://pub-51cb4ace3dfb43a4ac45a4b7c399904d.r2.dev
```

### Atenção

- `CLOUDFLARE_R2_BUCKET` é o nome do bucket no R2, não é a URL pública.
- `CLOUDFLARE_R2_PUBLIC_URL` é a URL pública do bucket. Neste patch já deixei o valor baseado no link que você enviou.
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY` aparece uma vez só ao criar a chave no Cloudflare. Guarde com cuidado.
- Não coloque a `SECRET_ACCESS_KEY` no GitHub.

## Onde criar a chave no Cloudflare

Caminho comum:

Cloudflare → R2 → Manage R2 API Tokens → Create API Token

Permissão necessária:

- Object Read & Write

Depois copie:

- Access Key ID
- Secret Access Key

## Depois de aplicar

1. Suba os arquivos para o GitHub.
2. Faça deploy no Render.
3. Confirme que o build rodou `npm install`, pois foi adicionada a dependência `@aws-sdk/client-s3`.
4. Abra `/admin-produtos`.
5. Edite um produto.
6. Selecione uma imagem em Foto 1.
7. Clique em Salvar Produto.
8. Verifique se a URL salva ficou parecida com:

```text
https://pub-51cb4ace3dfb43a4ac45a4b7c399904d.r2.dev/produtos/ID/foto-1-...
```
