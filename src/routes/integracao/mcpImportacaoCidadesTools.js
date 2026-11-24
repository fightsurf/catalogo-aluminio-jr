'use strict';

// A mesma validação e gravação da tela administrativa, apenas no MCP autenticado.
const importacao = require('../../services/logistica/importacaoCidades.service');
const leitura = [{ type: 'oauth2', scopes: ['clientes:read'] }];
const escrita = [{ type: 'oauth2', scopes: ['clientes:read', 'logistica:write'] }];

const tools = [
  {
    name: 'preparar_importacao_cidades',
    title: 'Conferir cidades para importar na transportadora',
    description: 'Prepara uma lista de cidades para vincular a UMA transportadora real, sem gravar. Localize antes a transportadora e use seu ID. Informe nome e UF de cada município extraído do material do usuário; não invente cidades nem use a UF da sede como UF das rotas. Confere o cadastro, separa cidades novas, já vinculadas, repetidas e pendências. Mostre a transportadora, municípios, UFs e totais; resolva as pendências antes de confirmar. Não cria municípios nem altera observações.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: leitura,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        transportadora_id: { type: 'integer', minimum: 1, description: 'ID real retornado pela consulta de transportadoras.' },
        cidades: {
          type: 'array', minItems: 1, maxItems: 300,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              nome: { type: 'string', minLength: 1, maxLength: 120 },
              uf: { type: 'string', maxLength: 32, description: 'Sigla da UF informada pelo usuário ou pela fonte. Valores ausentes ou que não sejam uma sigla válida aparecerão como pendência.' },
              codigo_ibge: { type: 'string', minLength: 7, maxLength: 7, description: 'Opcional; apenas se conhecido pela fonte, deve corresponder ao cadastro.' }
            },
            required: ['nome', 'uf']
          }
        }
      },
      required: ['transportadora_id', 'cidades']
    }
  },
  {
    name: 'confirmar_importacao_cidades',
    title: 'Importar cidades conferidas na transportadora',
    description: 'GRAVA os vínculos de cidades da prévia aprovada para a transportadora nela identificada. Use somente o token retornado por preparar_importacao_cidades, após o usuário aprovar a lista apresentada. Preserva vínculos e observações existentes, ignora duplicidades e grava o lote em uma transação. Não altera pedidos nem envia mensagens. Requer logistica:write. Em falha de resposta, consulte listar_cidades_da_transportadora para conferir o resultado antes de continuar.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes: escrita,
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        token_previa: { type: 'string', minLength: 20, maxLength: 131072, description: 'Token íntegro da prévia aprovada, válido por 20 minutos.' },
        confirmacao: { type: 'string', enum: ['CONFIRMO'], description: 'Usar após a aprovação do usuário para importar os vínculos mostrados.' }
      },
      required: ['token_previa', 'confirmacao']
    }
  }
].map(t => ({ ...t, _meta: { securitySchemes: t.securitySchemes } }));

function requiredScopes(name) {
  return tools.find(t => t.name === name)?.securitySchemes[0].scopes || [];
}

async function executeTool(name, args, contexto) {
  if (name === 'preparar_importacao_cidades') {
    return importacao.prepararImportacao(args, contexto);
  }
  if (name === 'confirmar_importacao_cidades' && args.confirmacao === 'CONFIRMO') {
    return importacao.confirmarImportacao({ token_previa: args.token_previa }, contexto);
  }
  const erro = new Error('Importação exige uma prévia válida e a confirmação da lista.');
  erro.isValidation = true;
  throw erro;
}

module.exports = { tools, requiredScopes, executeTool };
