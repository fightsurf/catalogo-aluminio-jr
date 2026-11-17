# Importacao de transportadoras por planilha (Moda Center)

## Acesso
Entre como administrador, abra /admin-logistica e clique em **Importar transportadoras (CSV)**. A pagina e a API em /api/logistica/importacao-modacenter exigem sessao administrativa.

## Origem legal dos dados
Os termos do site do Moda Center restringem a copia e o uso comercial do conteudo. **Este modulo oferece coleta direta mediante confirmacao de autorizacao especifica do titular dos dados para copia e uso comercial.** Tambem aceita planilhas ou exportacoes obtidas com permissao do titular.

## Formato CSV
Exportar no Excel como **CSV UTF-8** (virgula ou ponto e virgula). Colunas aceitas:
- nome (obrigatorio, pode ser "transportadora" ou "excursao")
- origem (preferencia: Cidade - UF)
- uf (opcional, quando a coluna origem nao possui UF)
- telefone, telefone2, telefones, whatsapp
- rota (lista separada por "/", ponto e virgula, "|" ou nova linha, localidades no formato Cidade - UF)
- destino (ex.: vaga/setor/estacionamento)
- tipo (excursao, turismo, transportadora etc.)

Exemplo ilustrativo com dados ficticios:

    nome;origem;telefone;rota;destino;tipo
    Transportadora Exemplo;Campina Grande - PB;(83) 99999-0000;Campina Grande - PB / Joao Pessoa - PB;Setor A;transportadora

## Fluxo
1. Gerar previa (sem gravar) com correspondencias pelo nome/telefone e cidades.
2. Selecionar registros novos ou indicar explicitamente a transportadora existente a associar.
3. Confirmar a gravacao. Registro novo cria transportadora com cidade fixa Santa Cruz do Capibaribe - PE, telefones normalizados com prefixo 55, primeiro como principal, e observacao "Origem: <campo origem do site>". Existente so acrescenta vinculacoes de cidades (nao altera telefone, nome nem observacao).
4. Conferir relatorio de cidades ignoradas e o historico das importacoes. Apenas cidades da rota sao vinculadas; a cidade de origem nao e acrescentada automaticamente. Localidades sem UF sao vinculadas somente se o nome for unico no cadastro de cidades.

Limites: 1.000 registros por lote, 1,6 MB de JSON, previa assinada e valida por 20 minutos.
A validacao e repetida dentro de uma transacao antes de gravar; importacoes simultaneas usam lock. Cidades ausentes/ambiguas no banco sao listadas, mas nao sao criadas automaticamente. A classificacao de excursao nao significa autorizacao para transporte de carga.

## Testes
Executar: node --test tests/importacao-excursoes-utils.test.js

## Futuro
Para sincronizacao automatica, obter autorizacao ou API documentada do Moda Center; manter o fluxo de previa e aprovacao.

## Coleta online (novo)
A pagina /admin-logistica/importacao-modacenter agora tem o botao **Consultar Moda Center e comparar registros**.

- O administrador deve confirmar que possui **autorizacao especifica para copiar os cadastros e utiliza-los comercialmente**. Autorizar transporte ou ter relacionamento com as excursoes nao equivale automaticamente a essa permissao.
- O backend consulta apenas https://omodacenter.com.br/c/excursoes, via HTTPS. Nao tenta contornar bloqueios, logins ou mecanismos anti-automacao.
- A pagina do Moda Center usa paginacao virtual em Next.js: o HTML inclui um payload JSON (Flight) com toda a lista, enquanto somente 10 cards aparecem renderizados. O coletor le os argumentos JSON dos scripts incorporados sem executar JavaScript remoto. No teste contra a fonte real em 17/11/2026, esse payload continha 381 excursões com nome, origem, estacionamento, telefones e rotas. Se o formato mudar ou o payload estiver incompleto, o coletor tenta o mecanismo antigo, com aviso de coleta parcial.
- Na coleta completa pelo payload Next.js basta uma resposta HTML; a interface informa o numero de paginas virtuais cobertas. O mecanismo alternativo utiliza pausas de 400 ms, timeout de 12 segundos por pagina e limite de 45 paginas. O limite de importacao e 1.000 registros, com bloqueio de coletas repetidas durante 90 segundos.
- **A coleta nao grava nada diretamente**. Os dados extraidos sao enviados ao mesmo endpoint de previa do CSV. A confirmacao final continua obrigatoria.
- A lista fonte continha 5 registros sem telefone. Agora todos os 381 aparecem na previa: os sem telefone sao sinalizados e nao entram na opcao automatica "Selecionar apenas novos". Podem ser aprovados individualmente para cadastro sem contato.
- Para nao declarar sucesso enganoso, o status **coleta completa** somente aparece quando o numero de registros unicos atinge o total informado pelo proprio site. Quando nao e possivel acessar as proximas paginas, a interface apresenta aviso de **coleta parcial**.
- Registros com nomes semelhantes, mas sem nome/telefone identicos, podem ser criados separadamente com revisao explicita. Coincidencias fortes permanecem protegidas.
- Ainda exige validacao em producao de rede/paginacao, pois o layout e o comportamento da fonte podem variar. Se a fonte passar a carregar as paginas exclusivamente em JavaScript, sera necessario um acordo de API/exportacao ou um adaptador especifico autorizado.

## Teste do coletor
Execute `node --test tests/coletor-modacenter.test.js`. Para validar com a fonte real, acesse a pagina autenticado, marque a autorizacao, clique em **Consultar Moda Center** e revise numero de paginas e registros antes de confirmar qualquer importacao.
