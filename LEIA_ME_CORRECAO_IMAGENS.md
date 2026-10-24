# AVN / Patch corretivo de imagens + catálogo completo

Data: 24/10/2026. Destino: **repositório Render `fightsurf/catalogo-aluminio-jr`**, não a API local Firebird e não o aplicativo Android.

## Por que as imagens não apareciam?

1. O arquivo SVG original da biblioteca Workout Guide utiliza um único `path` com `fill="#fff"` (branco). O AVN exibiu a imagem sobre fundo também claro.
2. O primeiro patch utilizava links de terceiros no jsDelivr e tentava importar o manifesto durante a inicialização. Uma falha de rede deixava o banco com apenas a parte inicial do catálogo e/ou URLs inacessíveis.

## O que muda

- Adiciona a dependência de produção **`@bryllim/workout-guide@1.0.0`**. O Render a instala com `npm install` no build; o pacote inclui os **302 exercícios e 906 SVGs**.
- Disponibiliza os arquivos no **mesmo domínio do AVN**, sob `/avn/sistema/midias/<slug>/frame-1.svg`, protegidos por login.
- Carrega o manifesto do próprio `node_modules` em vez de consultar servidor externo.
- No primeiro reinício, atualiza URLs antigas do catálogo e preenche os exercícios faltantes, sem excluir os planos existentes nem os exercícios personalizados.
- Corrige o contraste dos SVGs brancos com filtros na imagem e uma moldura clara; a animação continua usando três quadros.
- Permite editar registros que contenham uma URL local do próprio AVN, mantendo bloqueio de protocolos inseguros.

## Instalação direta — SEM EXECUTAR INSTALADOR

1. Faça backup do repositório e do PostgreSQL antes da alteração.
2. Extraia este ZIP; sua raiz contém `package.json`, pastas `src`, `public` e `tests`.
3. Envie **os arquivos da raiz e suas respectivas pastas** à raiz do repositório `fightsurf/catalogo-aluminio-jr`, sobrescrevendo os arquivos de mesmo caminho (não crie pasta extra `render/`).
4. Faça commit e acione o deploy do Render. Seu `render.yaml` usa `npm install`: a nova dependência virá no build automaticamente.
5. Acesse `/avn/sistema/exercicios` (autenticado). Verifique o supino reto, rosca Scott e panturrilha.

Não há comando SQL manual. O projeto já possui migração idempotente na inicialização.

## Checagem

- Nos logs: `[AVN] Catálogo ilustrado sincronizado: 302 exercícios.` (na primeira execução; em deploys seguintes poderá saltar a importação).
- Com login, abra: `/avn/sistema/midias/bench-press/frame-1.svg`. Deve retornar `image/svg+xml` com HTTP 200.
- Acesse `/avn/sistema/api/treinos/exercicios?busca=supino` e verifique se `midia_url` usa `/avn/sistema/midias/...`, não `cdn.jsdelivr.net`.
- A Biblioteca exibe silhuetas escuras sobre fundo claro; não é necessário apertar “Atualizar catálogo local” se a migração terminou.

## Licenças e autoria

- Código da biblioteca: MIT.
- Ilustrações originais e quadros derivados: CC BY-SA 4.0; autores **Bryl Lim** e **Everkinetic**. A atribuição está nos rodapés das quatro páginas AVN. Os termos originais acompanham o pacote npm.
- Fontes: https://github.com/bryllim/workout-guide ; https://github.com/bryllim/workout-guide/blob/main/ATTRIBUTION.md

## Limitações

- Não verificamos o PostgreSQL do Render nesta sessão. Testes locais validam a sintaxe e a estrutura do patch; confirme o funcionamento pós-deploy.
- O pacote contém as imagens através da dependência npm (servidas localmente pelo Render após o build); o ZIP não embute todos os 906 SVGs.
- Algumas dezenas de exercícios manuais sem equivalente na biblioteca podem continuar sem imagem; os 302 da fonte oficial ficam ilustrados.
