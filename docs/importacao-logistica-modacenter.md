# Importacao de transportadoras por planilha (Moda Center)

## Acesso
Entre como administrador, abra /admin-logistica e clique em **Importar transportadoras (CSV)**. A pagina e a API em /api/logistica/importacao-modacenter exigem sessao administrativa.

## Origem legal dos dados
Os termos do site do Moda Center restringem a copia e o uso comercial do conteudo. **Este modulo nao coleta informacoes do site.** Use somente planilhas ou exportacoes obtidas com permissao do titular ou por outra fonte autorizada. Nao oferece sincronizacao automatica sem API/cessao licenciada.

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
3. Confirmar a gravacao. Registro novo cria transportadora; existente so acrescenta vinculacoes de cidades (nao altera telefone, nome nem observacao).
4. Conferir relatorio de cidades ignoradas e o historico das importacoes.

Limites: 1.000 registros por lote, 1,6 MB de JSON, previa assinada e valida por 20 minutos.
A validacao e repetida dentro de uma transacao antes de gravar; importacoes simultaneas usam lock. Cidades ausentes/ambiguas no banco sao listadas, mas nao sao criadas automaticamente. A classificacao de excursao nao significa autorizacao para transporte de carga.

## Testes
Executar: node --test tests/importacao-excursoes-utils.test.js

## Futuro
Para sincronizacao automatica, obter autorizacao ou API documentada do Moda Center; manter o fluxo de previa e aprovacao.
