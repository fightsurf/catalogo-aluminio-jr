# Controle de Compras — Alumínio JR

Novo módulo do aplicativo existente, rota autenticada: **/compras**.

## Campos
Fornecedor (cadastro \`fornecedores\`), número da nota, data opcional,
valor da NF, quantidade de linhas de produtos, valor do frete e ICMS do frete.
Cada NF contém 1 a 500 linhas com descrição, unidade, quantidade, preço unitário,
total calculado e associação opcional ao cadastro \`insumos\`.

## Leitura IA (fotos)
Endpoint privado \`POST /api/compras/interpretar\`, multipart com campo
\`imagens\` (1–5 arquivos JPG/PNG/WEBP até 7 MB cada).
Usa a \`OPENAI_API_KEY\` existente e, opcionalmente, \`COMPRAS_IA_MODEL\`.
O upload fica somente em memória e é encaminhado ao modelo de visão; não
salva os arquivos e não cria lançamentos automaticamente.
O operador revisa a NF, fornecedor e todas as linhas e clica em Salvar.

**Privacidade:** embora não sejam guardadas no banco ou servidor, as fotos
são enviadas para processamento pela API da OpenAI; não inclua imagens
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

**Conferência:** a soma dos insumos é informativa. Não deve haver
validação que exija igualdade com o valor da NF: este pode conter
frete, tributos, descontos e outros lançamentos.

## Testes
\`node --test tests/compras-validator.test.js\`.
