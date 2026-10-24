# AVN — Montador de Treinos e Biblioteca de Exercícios | Patch de arquivos para GitHub

**Destino:** repositório `fightsurf/catalogo-aluminio-jr` (Render). **Não é para `fightsurf/avn` (APK Android).**

## Aplicação DIRETA — sem instalador e sem comandos obrigatórios

1. Faça backup ou mantenha um commit conhecido antes da aplicação.
2. Extraia este ZIP em uma pasta vazia.
3. Copie o conteúdo das pastas `db/`, `public/`, `src/`, `tests/` e `views/` para a **raiz** do seu clone de `fightsurf/catalogo-aluminio-jr`. Mantenha os caminhos e aceite **substituir SOMENTE os dois arquivos existentes** listados abaixo. Todos os demais são novos.
4. Confira os arquivos alterados no GitHub Desktop ou `git diff`. Faça commit e push na branch da aplicação. O Render inicia a aplicação e executa a migração automaticamente, como já acontece com o AVN.
5. Abra `/avn`, entre em **Atividades Físicas** e clique em **Biblioteca de Exercícios** ou **Montador de Treinos**.

**Importante:** subir o arquivo `.zip` fechado ao GitHub não instala o módulo: é necessário extrair e subir os arquivos preservando as pastas. **Não execute `APLICAR_PATCH_AVN_TREINOS`**; este pacote não possui instalador.

### Arquivos existentes substituídos (somente dois)

- `src/routes/avn/avn-sistema.routes.js` — adiciona quatro telas e a API ao roteador AVN já registrado e autenticado no servidor, integrando os aplicativos na central sem alterar `server.js` da fábrica.
- `src/services/avn/avn-migration.service.js` — mantém os SQLs existentes e inclui a migração idempotente dos treinos e a sincronização do catálogo externo quando a rede permitir.

### Arquivos novos

- `db/sql/20261024_avn_treinos.sql` — novas tabelas `avn_`, 74 exercícios iniciais em PT-BR, 70 URLs de demonstração ilustrada; sem `DROP`, sem mexer nas tabelas da fábrica.
- `src/routes/avn/avn-treinos.routes.js` — API REST de exercícios, grupos, planos, sessões e sincronização ilustrada.
- `src/services/avn/avn-treinos-validacao.js` — validação de dados, IDs, planos e URLs.
- `src/services/avn/avn-treinos-catalogo.service.js` — importa a biblioteca Workout Guide para o PostgreSQL (302 exercícios disponíveis na fonte); verifica os dados antes de importar, com transação.
- `src/services/avn/avn-treinos-ptbr.js` — traduções curatoriais de nomes para português.
- `views/avn/{exercicios,montador,meus-treinos,treinar}.html` — quatro telas responsivas.
- `public/js/avn-treinos.js`, `public/css/avn-treinos.css` — interface e reordenação desktop/celular.
- `tests/*.js` — testes unitários e verificações estruturais sem dependências de teste adicionais.

## Endereços instalados

- `/avn/sistema/exercicios` — biblioteca ilustrada, busca sem acentos, gestão de exercícios, grupo/equipamento e importação.
- `/avn/sistema/montador` — montar dias da semana (segunda a domingo), selecionar exercícios, arrastar e soltar, ajustar séries, repetições, carga e descanso.
- `/avn/sistema/meus-treinos` — listar, editar, executar ou arquivar planos.
- `/avn/sistema/treinar` — registrar execução realizada e consultar histórico.
- `/avn/sistema/api/treinos` — API REST. O login administrativo AVN protege todas essas páginas e a API.

**Por que `/avn/sistema/`?** Porque esse roteador já é ligado e protegido no `server.js` do Render. Usar essa base permite um patch de substituição direta **sem substituir o arquivo central e extenso da fábrica**, reduzindo conflitos com outras funcionalidades.

## Ilustrações e licença

- Base aberta: **Workout Guide**, por Bryl Lim, com desenhos derivados de **Everkinetic**. São 302 exercícios, com 3 quadros SVG transparentes por exercício.
- A importação externa no início do servidor tenta popular os 302 (com tradução de nomes); se a rede externa estiver indisponível, **não impede o AVN de iniciar**: os 74 exercícios locais continuam utilizáveis. Na biblioteca existe o botão **Atualizar ilustrações** para tentar novamente.
- O seed inicial configura 70 URLs externas de demonstração para exercícios em português. **O arquivo ZIP não contém 906 SVGs**: as imagens são exibidas por URL HTTPS do CDN jsDelivr/GitHub, por isso dependem de acesso à rede e da manutenção dessa fonte. Nenhum GIF pago foi incluído.
- A interface alterna os três quadros originais para ilustrar os movimentos; **não é vídeo biomecânico contínuo**. Desabilita a alternância se o dispositivo pedir movimento reduzido.
- Atribuição a Bryl Lim e Everkinetic e links de licença são exibidos nas páginas. Arte **CC BY-SA 4.0**; modificações do material devem manter os avisos e respeitar a licença. Código próprio do AVN não recebe automaticamente esta licença.
- Fontes: https://github.com/bryllim/workout-guide, https://github.com/everkinetic/data, https://github.com/bryllim/workout-guide/blob/main/LICENSE-ASSETS e https://github.com/bryllim/workout-guide/blob/main/ATTRIBUTION.md .
- A confiabilidade visual e técnica de qualquer exercício deve ser validada antes de utilizá-lo como orientação de execução. O módulo organiza treinos, não substitui avaliação profissional.

## Integração e dados

- Compartilha a instância PostgreSQL do Render, somente em tabelas novas com prefixo `avn_`.
- Usa `avn_usuario` existente; cada plano e sessão possui `usuario_id`. O login atual é administrativo único, sem autenticação individual por aluno nesta etapa.
- Arquivamento preserva planos e sessões passadas.
- Sessões manuais NÃO registram calorias nem alteram automaticamente as sessões recebidas do Health Connect, evitando duplicidade.
- Migração é reexecutável: `CREATE TABLE IF NOT EXISTS`, `INSERT ... ON CONFLICT DO NOTHING` e `UPDATE ... WHERE midia_url IS NULL`.

## Checklist de implantação

1. Após deploy, abra `/avn` e encontre os quatro cards no grupo **Atividades Físicas**.
2. Entre em Biblioteca, pesquise `biceps`, `gluteos` e `rosca scott` (busca sem acentos).
3. Verifique imagens e o total de exercícios. Se houver apenas os 74 do seed, clique em **Atualizar ilustrações**.
4. Escolha um usuário criado em `/avn/usuarios`. Crie um plano com dias e séries.
5. Salve, feche, reabra em **Meus Treinos**, reordene e salve outra vez.
6. Use **Registrar Treino** para salvar a sessão realizada e confira no histórico.
7. Teste no celular os botões **+ Adicionar**, ↑ e ↓, além de arrastar com o dedo pela alça ⋮⋮.
8. Teste sessão não autenticada: `/avn/sistema/...` deve pedir login.

## Validação técnica local (opcional)

- `node --test tests/avn-treinos.test.js tests/avn-treinos-integracao.test.js`
- `node --check src/routes/avn/avn-sistema.routes.js`
- `node --check src/routes/avn/avn-treinos.routes.js`
- `node --check public/js/avn-treinos.js`

**Não foram realizados testes conectados ao PostgreSQL de produção nem deploy real.** Código e SQL foram verificados estaticamente e os testes unitários foram executados. Recomendado testar primeiro em homologação/branch de avaliação e ter backup do banco.

## Rollback

Reverta o commit dos arquivos do patch e faça novo deploy. As tabelas `avn_` do módulo permanecerão intactas para preservar os dados; não execute comandos `DROP TABLE` para reverter. Se houver outra alteração recente em um dos dois arquivos substituídos, mescle a diferença antes de aplicar, em vez de sobrescrever cegamente.
