# Controle de Compras — Alumínio JR

Novo módulo do aplicativo existente, rota autenticada: **/compras**.

## Campos
Fornecedor (cadastro \`fornecedores\`), número da nota, data opcional,
valor da NF, quantidade de linhas de produtos, valor do frete e ICMS do frete.
Cada NF contém 1 a 500 linhas com descrição, unidade, quantidade, preço unitário,
total calculado e associação opcional ao cadastro \`insumos\`.

## Leitura IA (fotos e PDFs)
Endpoint privado \`POST /api/compras/interpretar\`, multipart com campo
\`imagens\` (1–5 arquivos JPG/PNG/WEBP até 7 MB cada, ou um PDF de até 12 MB).
Usa a \`OPENAI_API_KEY\` existente e, opcionalmente, \`COMPRAS_IA_MODEL\`.
O upload fica somente em memória e é encaminhado ao modelo de visão, que analisa texto e páginas de PDFs digitais ou digitalizados; não
salva os arquivos e não cria lançamentos automaticamente.
A IA tenta reconhecer o fornecedor cadastrado e o número da NF em imagens ou PDF. Quando os dois
são identificados (ou informados previamente na tela), a importação localiza
a nota pela chave **fornecedor_id + numero_nf**. Se existir, complementa
automaticamente campos vazios e adiciona os novos insumos; se não existir,
cria a NF. Reimportar o mesmo arquivo não deve duplicar itens de mesmo nome
normalizado e unidade. Dados previamente informados não são sobrescritos.
O operador deve conferir e pode corrigir o resultado. Se houver divergência
entre número/fornecedor digitado e o reconhecido pela IA, nada é gravado
automaticamente: a tela solicita conferência e salvamento manual.

**Privacidade:** embora não sejam guardados no banco ou servidor, fotos e PDFs
são enviados para processamento pela API da OpenAI; não inclua páginas
desnecessárias.

## Banco e validações
SQL idempotente: \`db/sql/20261103_compras.sql\` (aplicado no startup).
Tabelas \`compras_notas\`, \`compras_itens\`; único \`fornecedor_id+numero_nf\`;
transações de gravação e edição; proteção contra registros duplicados.
Relação opcional de cada linha com \`insumos.id\`, sem criar insumos duplicados.
Manter descrição original informada e histórico consultável.

## APIs autenticadas
- \`GET /api/compras/fornecedores\`
- \`GET /api/compras/insumos\`
- \`GET /api/compras?fornecedor_id=&busca=\` (até 200 registros mais recentes)
- \`GET /api/compras/:id\`
- \`POST /api/compras\`
- \`PUT /api/compras/:id\`
- \`POST /api/compras/interpretar\`

**Testes:** `node --test tests/compras-validator.test.js tests/compras-importacao.test.js tests/compras-ia-arquivos.test.js`.

**Conferência:** a soma dos insumos é informativa. Não deve haver
validação que exija igualdade com o valor da NF: este pode conter
frete, tributos, descontos e outros lançamentos.

## Testes
\`node --test tests/compras-validator.test.js\`.

## Boletos e parcelas — 05/11/2026
Uma NF pode ter **zero ou vários** registros em `public.compras_boletos` (`nota_id` com FK).
A tabela tem vencimento, valor, parcela, documento, nosso número, banco, linha digitável,
código de barras, situação (`a_confirmar`, `pendente`, `pago`, `cancelado`),
data e valor de pagamento, observação e origem.

A IA lê tanto boletos bancários quanto duplicatas/parcelas explicitamente presentes na NF:
- Cobrança bancária identificável: tipo `boleto`, status `pendente`.
- Duplicata/parcela sem boleto bancário: tipo `duplicata`, status `a_confirmar`.
- Apenas prazo genérico: não gera boleto. Nunca presumir pagamento realizado.
- Importação de documento já existente mantém pagamentos, valores manuais e itens.
  Confere parcelas repetidas para não criar duplicidades. Arquivos PDF não são guardados.

A tela possui modal "Boletos desta compra" para edição e terceira aba "Controle de boletos"
para consultar títulos de todos os fornecedores, vencimentos e registrar pagamentos.
Endpoints privados:
- `GET /api/compras/boletos?status=&busca=`
- `PATCH /api/compras/boletos/:id/status`
- `GET /api/compras/:id` devolve `boletos: []`; `POST/PUT /api/compras` aceita `boletos: []`.
Migração idempotente: `db/sql/20261105_compras_boletos.sql`, incluída no startup.
