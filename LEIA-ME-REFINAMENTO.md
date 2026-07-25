# Refinamento da Central de Ofertas

Arquivos alterados:
- `views/ofertas/central-ofertas.html`: filtro digitável de categorias (`datalist`).
- `src/services/ofertas/openaiImagem.service.js`: arte integral usando `/v1/images/edits` e imagens de referência.
- `src/services/ofertas/arteOferta.service.js`: prepara somente a prancha de referência; não cola produtos na arte final.
- `src/services/ofertas/ofertas.service.js`: legenda do Status contendo somente o link público.
- `views/ofertas/oferta-publica.html`: não exibe a arte; destaca o preço médio e reduz o destaque do valor total.
- `public/assets/ofertas/referencia-kit-top.jpg`: referência visual recortada do print fornecido.

Configure no Render:

```env
OPENAI_IMAGE_MODEL_FULL_ART=gpt-image-1
OPENAI_IMAGE_QUALITY=medium
OPENAI_IMAGE_MAX_RETRIES=3
```

Depois do deploy, acesse `/central-ofertas`.
