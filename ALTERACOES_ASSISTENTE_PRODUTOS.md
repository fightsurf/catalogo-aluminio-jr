# Alteração — API segura de produtos para o Hermes

## Objetivo

Criar uma API somente leitura para o Hermes consultar produtos e preços sem acessar o banco diretamente.

## Nova variável de ambiente

Configure no projeto Render da Alumínio JR:

```text
ASSISTENTE_API_TOKEN=<token longo e secreto>
```

Use o mesmo valor no projeto Hermes.

## Nova rota

```http
POST /api/assistente/produtos/consultar
Authorization: Bearer <ASSISTENTE_API_TOKEN>
Content-Type: application/json
```

Exemplo:

```json
{
  "termo": "panela 4",
  "quantidade": 10
}
```

Resposta:

```json
{
  "ok": true,
  "mensagem_curta": "Panela nº 4: R$ 35,00. 10 unidade(s): R$ 350,00.",
  "produtos": []
}
```

## Segurança

- A rota exige `ASSISTENTE_API_TOKEN`.
- A rota não altera dados.
- A rota não expõe banco, SQL, credenciais ou dados de clientes.
