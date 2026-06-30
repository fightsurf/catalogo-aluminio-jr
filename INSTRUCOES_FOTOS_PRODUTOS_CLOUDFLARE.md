# Upload de até 6 fotos por produto - Cloudflare Images

## O que este patch faz

- Mantém `produtos.foto` como Foto 1 / foto principal.
- Cria automaticamente no PostgreSQL as colunas opcionais:
  - `foto_2`
  - `foto_3`
  - `foto_4`
  - `foto_5`
  - `foto_6`
- Altera somente o admin `/admin-produtos` para cadastrar até 6 fotos.
- Não altera as páginas públicas do catálogo.
- A Foto 1 continua sendo a foto principal exibida pelo sistema atual.
- Permite salvar URL manualmente ou selecionar arquivo para upload ao Cloudflare Images.

## Banco de dados

Não precisa rodar SQL manualmente.

Ao iniciar o servidor, o sistema executa automaticamente:

```sql
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS foto_2 TEXT,
  ADD COLUMN IF NOT EXISTS foto_3 TEXT,
  ADD COLUMN IF NOT EXISTS foto_4 TEXT,
  ADD COLUMN IF NOT EXISTS foto_5 TEXT,
  ADD COLUMN IF NOT EXISTS foto_6 TEXT;
```

## Variáveis de ambiente

O patch já inclui os nomes no `render.yaml` e no `.env.example`:

```env
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_IMAGES_TOKEN=
CLOUDFLARE_IMAGES_ACCOUNT_HASH=
CLOUDFLARE_IMAGES_VARIANT=public
```

Os valores reais não podem ser criados pelo código. Eles precisam vir da sua conta Cloudflare.

Se o serviço Render já foi criado manualmente, o Render pode não importar as novas variáveis do `render.yaml` automaticamente. Nesse caso, será necessário preencher os valores uma vez no painel do Render.

## Uso no admin

1. Acesse `/admin-produtos`.
2. Edite ou crie um produto.
3. Selecione até 6 fotos.
4. Clique em `Salvar Produto`.
5. O sistema salva o produto e envia as fotos selecionadas ao Cloudflare.
6. As URLs retornadas ficam gravadas no banco.

## Limites

- Tamanho máximo por imagem: 10 MB.
- Formatos aceitos: JPG, PNG, WEBP e GIF.
