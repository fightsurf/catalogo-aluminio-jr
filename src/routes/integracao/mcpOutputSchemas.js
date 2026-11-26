'use strict';

// Contratos do JSON efetivamente publicado em structuredContent. Campos vindos
// do legado podem ter ids numéricos ou textuais e valores ausentes; não converter
// esses dados, nem esconder resultados parciais, para satisfazer o contrato.
const texto = { type: 'string' };
const textoOpcional = { type: ['string', 'null'] };
const booleano = { type: 'boolean' };
const contagem = { type: 'integer', minimum: 0 };
const numero = { type: 'number' };
const numeroOpcional = { type: ['number', 'null'] };
const identificador = { type: ['integer', 'string', 'null'] };
const lista = items => ({ type: 'array', items });
const objeto = (properties, required = []) => ({
  type: 'object', properties, required, additionalProperties: true
});
const anulavel = schema => ({ ...schema, type: ['object', 'null'] });

const pessoa = objeto({
  favorecido: identificador, nome: texto, cidade: textoOpcional, uf: textoOpcional,
  telefone: textoOpcional, observacao: textoOpcional
});
const cidade = objeto({
  id: identificador, cidade_id: identificador, nome: texto, cidade: texto,
  uf: textoOpcional, codigo_ibge: identificador, observacao: textoOpcional,
  situacao: texto
});
const transportadora = objeto({
  id: identificador, nome: texto, cidade: textoOpcional, uf: textoOpcional,
  cidade_origem: textoOpcional, uf_origem: textoOpcional,
  telefone: textoOpcional, observacao: textoOpcional,
  cidades_vinculadas: lista(cidade)
});
const carrada = anulavel(objeto({
  codigo: identificador, data: textoOpcional, descricao: texto,
  vendas_bloqueadas: booleano
}));
const itemPedido = objeto({
  codigo: identificador, produto_id: identificador, item_legado: identificador,
  nome: texto, descricao: texto, quantidade: numeroOpcional,
  preco: numeroOpcional, preco_unitario: numeroOpcional,
  preco_referencia: numeroOpcional, subtotal: numeroOpcional
});
const pedido = objeto({
  id_mestre: identificador, numero: texto, data: textoOpcional,
  data_expedicao: textoOpcional, data_expedicao_disponivel: booleano,
  sem_data_expedicao: { type: ['boolean', 'null'] },
  cliente: anulavel(pessoa), vendedor: anulavel(pessoa),
  situacao: textoOpcional, cancelado: booleano, total: numeroOpcional,
  total_pago: numeroOpcional, saldo_restante: numeroOpcional,
  volumes: numeroOpcional, carrada, observacao: textoOpcional,
  itens: lista(itemPedido), financeiro_verificado: booleano
});
const filtros = objeto({
  numero: texto, cliente: texto, favorecido: identificador, data: texto,
  descricao: texto, incluir_cancelados: booleano, ultimo: booleano,
  sem_data_expedicao: booleano
});
const paginacao = {
  pagina: { type: 'integer', minimum: 1 },
  limite: { type: 'integer', minimum: 1 },
  exibindo: contagem, tem_mais: booleano,
  proxima_pagina: { type: ['integer', 'null'], minimum: 1 }
};
const resumoPedido = objeto({
  versao_fluxo: contagem, cliente: pessoa, vendedor: pessoa, data: texto,
  modalidade: texto, volumes: contagem, carrada_codigo: identificador,
  observacao: textoOpcional, aviso_whatsapp_carrada: booleano,
  aviso_whatsapp_separado: booleano, itens: lista(itemPedido), total: numero
});
// O resultado bruto da Inserção V2 é preservado no MCP para conferência. Há
// respostas antigas com wrappers data/pedido, sem um formato único de legado.
const resultadoLegado = { ...objeto({
  pedido: anulavel(objeto({ numero: identificador, id_mestre: identificador,
    idMestre: identificador, saida: identificador, total: { type: ['number', 'string', 'null'] } })),
  numero: identificador, id_mestre: identificador, idMestre: identificador,
  saida: identificador, carradaVinculada: anulavel(objeto({
    sucesso: booleano, codigo: identificador, data: textoOpcional, descricao: texto
  }))
}), type: ['object', 'array', 'string', 'number', 'boolean', 'null'] };
const rascunho = {
  rascunho_id: texto, status: texto, expirado: booleano,
  resumo: resumoPedido, pedido_resultado: resultadoLegado,
  erro: textoOpcional, revisao_manual_necessaria: booleano,
  confirmado_em: textoOpcional
};
const progresso = objeto({
  etapa: texto, estado: texto, status: texto, tipo: texto,
  ordem: contagem, total: contagem, produto_id: identificador,
  id_mensagem: identificador, motivo: texto, registrado_em: texto
});
const prestacaoFornecedor = objeto({ prestacao_id: identificador, fornecedor_id: identificador,
  fornecedor: texto, titulo: texto, data_referencia: texto, total_material: numero,
  total_pago: numero, saldo_restante: numero }, ['prestacao_id', 'fornecedor_id', 'fornecedor', 'titulo', 'data_referencia', 'total_material', 'total_pago', 'saldo_restante']);
const pagamentoFornecedor = objeto({ data: texto, valor: numero, observacao: texto });
const resumoAcao = objeto({
  prestacao: prestacaoFornecedor, pagamento: pagamentoFornecedor, saldo_previsto: numero, total_pago_previsto: numero,
  prestacao_id: identificador, fornecedor: texto, quantidade_pagamentos: contagem,
  acao: texto, tipo: texto, pedido, pedido_atual: pedido,
  cliente: pessoa, destinatario: objeto({ telefone: texto, final: texto }),
  proposto: objeto({ data: textoOpcional, observacao: textoOpcional,
    itens: lista(itemPedido), total: numeroOpcional, carrada }),
  motivo: texto, efeito: texto, regra: texto, carrada,
  data_atual: textoOpcional, data_proposta: texto,
  lista_de_itens_substituida: booleano, aviso_whatsapp: textoOpcional,
  envio_em_lote: booleano, mensagem: texto, expira_em: texto,
  confirmacao_obrigatoria: booleano, aviso: texto,
  documento: objeto({ nome: texto, bytes: contagem, legenda: texto }),
  audio: objeto({ texto, voz: texto, modelo: texto, caracteres: contagem,
    bytes: contagem, referencia_previa: textoOpcional, observacao: texto }),
  fotos: objeto({ total: numero, quantidadeProdutos: contagem }),
  resumo_final: objeto({ produtos: contagem, multiplicador: numero, total: numero })
});
const resultadoAcao = anulavel(objeto({
  prestacao: prestacaoFornecedor, pagamento: objeto({ id: identificador, data_pagamento: texto, valor: { type: ['number','string'] }, observacao: textoOpcional }),
  fornecedor: texto, whatsapp_enviado: booleano,
  status: texto, mensagem: texto, pedido, pedido_alterado: booleano,
  motivo: texto, data_registrada: booleano, id_mestre: identificador,
  numero: identificador, numeroPedido: identificador, pedido_numero: identificador,
  carrada_codigo: identificador, concluido: booleano, dataExpedicao: texto,
  telefone_final: texto, aceitos: contagem, total: contagem,
  resultados: lista(progresso), entrega_confirmada: booleano,
  entrega_whatsapp_confirmada: booleano, revisao_manual_necessaria: booleano,
  pode_reexecutar: booleano, observacao: texto
}));
const acao = {
  acao_id: texto, tipo: texto, status: texto, resumo: resumoAcao,
  progresso: lista(progresso), resultado: resultadoAcao,
  expirado: booleano, concluido_em: textoOpcional,
  revisao_manual_necessaria: booleano, pode_reexecutar: booleano, mensagem: texto
};
const prepararAcao = objeto({
  acao_id: texto, tipo: texto, status: { type: 'string', enum: ['aguardando_confirmacao'] },
  codigo_confirmacao: texto, expira_em: texto, expira_em_minutos: contagem,
  resumo: resumoAcao, instrucoes: texto
}, ['acao_id', 'tipo', 'status', 'codigo_confirmacao', 'expira_em', 'expira_em_minutos', 'resumo', 'instrucoes']);
const confirmarAcao = objeto(acao,
  ['acao_id', 'tipo', 'status', 'progresso', 'resultado', 'revisao_manual_necessaria', 'pode_reexecutar']);

const schemas = {
  buscar_prestacoes_fornecedor: objeto({ total_encontrado: contagem, pagina: contagem, limite: contagem, exibindo: contagem,
    proxima_pagina: { type: ['integer','null'] }, prestacoes: lista(prestacaoFornecedor), aviso: texto },
    ['total_encontrado','pagina','limite','exibindo','proxima_pagina','prestacoes','aviso']),
  preparar_pagamento_fornecedor: prepararAcao,
  confirmar_pagamento_fornecedor: confirmarAcao,
  preparar_whatsapp_resumo_fornecedor: prepararAcao,
  confirmar_whatsapp_resumo_fornecedor: confirmarAcao,
  consultar_acao_prestacao: objeto(acao, ['acao_id','tipo','status','resumo','progresso','resultado','expirado','concluido_em','revisao_manual_necessaria','pode_reexecutar']),
  buscar_clientes: objeto({
    total_encontrado: contagem, exibindo: contagem, clientes: lista(pessoa)
  }, ['total_encontrado', 'exibindo', 'clientes']),
  consultar_cliente: objeto({
    encontrado: booleano, cliente: anulavel(pessoa)
  }, ['encontrado', 'cliente']),
  listar_excursoes_transportadoras: objeto({
    total_encontrado: contagem, ...paginacao,
    tem_proxima_pagina: booleano, cadastros: lista(transportadora)
  }, ['total_encontrado', 'pagina', 'limite', 'exibindo', 'tem_proxima_pagina', 'cadastros']),
  consultar_transportadoras: objeto({
    total_encontrado: contagem, exibindo: contagem, transportadoras: lista(transportadora)
  }, ['total_encontrado', 'exibindo', 'transportadoras']),
  buscar_cidades: objeto({
    total: contagem, cidades: lista(cidade)
  }, ['total', 'cidades']),
  listar_cidades_da_transportadora: objeto({
    transportadora_id: identificador, total_encontrado: contagem, cidades: lista(cidade)
  }, ['transportadora_id', 'total_encontrado', 'cidades']),
  transportadoras_por_cidade: objeto({
    tipo: { type: 'string', enum: ['resultado', 'sugestao', 'sem_frete', 'nao_encontrada'] },
    cidade: texto, uf: textoOpcional, total: contagem,
    transportadoras: lista(transportadora), cidades: lista(cidade)
  }, ['tipo']),
  buscar_produtos: objeto({
    total_encontrado: contagem,
    produtos: lista(objeto({
      produto_id: identificador, nome: texto, preco_referencia: numeroOpcional,
      item_legado: identificador, pode_inserir: booleano, pontuacao_busca: numero
    })),
    busca_por_descricao: booleano, requer_confirmacao_produto: booleano, mensagem: texto
  }, ['total_encontrado', 'produtos', 'busca_por_descricao', 'requer_confirmacao_produto', 'mensagem']),
  buscar_vendedores: objeto({
    total_encontrado: contagem, vendedores: lista(pessoa)
  }, ['total_encontrado', 'vendedores']),
  buscar_carradas: objeto({
    filtros, total_encontrado: contagem, ...paginacao,
    necessita_escolha_carrada: booleano, carradas: lista(carrada),
    somente_leitura: booleano, instrucao: texto
  }, ['filtros', 'total_encontrado', 'exibindo', 'pagina', 'limite', 'tem_mais',
    'proxima_pagina', 'necessita_escolha_carrada', 'carradas', 'somente_leitura', 'instrucao']),
  consultar_pedidos: objeto({
    filtros, cliente: pessoa, cliente_encontrado: booleano,
    necessita_escolha_cliente: booleano, total_clientes: contagem, clientes: lista(pessoa),
    instrucao: texto, fonte: texto, ordenacao: texto,
    encontrados: contagem, total_origem: { type: ['number', 'string', 'null'] }, ...paginacao,
    resultado_completo: booleano, ultimo_pedido_confirmado: { type: ['boolean', 'null'] },
    expedicao_nao_verificada: contagem, avisos: lista(texto), pedidos: lista(pedido),
    somente_leitura: booleano
  }, ['filtros', 'encontrados', 'exibindo', 'pedidos', 'somente_leitura']),
  detalhar_pedido: objeto({
    encontrado: booleano, id_mestre: identificador, pedido: anulavel(pedido), somente_leitura: booleano
  }, ['encontrado', 'pedido', 'somente_leitura']),
  preparar_pedido: objeto({
    status: { type: 'string', enum: ['aguardando_confirmacao'] },
    rascunho_id: texto, codigo_confirmacao: texto, expira_em_minutos: contagem,
    resumo: resumoPedido, instrucoes: texto
  }, ['status', 'rascunho_id', 'codigo_confirmacao', 'expira_em_minutos', 'resumo', 'instrucoes']),
  confirmar_pedido: objeto({
    ...rascunho, pedido_gravado: booleano, numero_pedido: texto, id_mestre: identificador,
    resultado: resultadoLegado, mensagem: texto, observacao_envio: texto,
    aviso_whatsapp_carrada: objeto({ status: texto, motivo: texto }),
    proximo_passo: anulavel(objeto({
      ferramenta: texto, argumentos: objeto({ id_mestre: identificador, tipo: texto, numero: texto }),
      instrucao: texto
    }))
  }, ['status', 'rascunho_id']),
  consultar_rascunho: objeto(rascunho,
    ['rascunho_id', 'status', 'expirado', 'resumo', 'erro', 'revisao_manual_necessaria']),
  preparar_alteracao_pedido: prepararAcao,
  confirmar_alteracao_pedido: confirmarAcao,
  preparar_cancelamento_pedido: prepararAcao,
  confirmar_cancelamento_pedido: confirmarAcao,
  preparar_expedicao_pedido: prepararAcao,
  confirmar_expedicao_pedido: confirmarAcao,
  preparar_whatsapp_pedido: prepararAcao,
  confirmar_whatsapp_pedido: confirmarAcao,
  preparar_whatsapp_pagamentos_cliente: prepararAcao,
  confirmar_whatsapp_pagamentos_cliente: confirmarAcao,
  consultar_acao_pedido: objeto(acao, ['acao_id', 'tipo', 'status', 'resumo', 'progresso',
    'resultado', 'expirado', 'concluido_em', 'revisao_manual_necessaria', 'pode_reexecutar']),
  preparar_importacao_cidades: objeto({
    transportadora, cidades: lista(cidade),
    pendencias: lista(objeto({ nome: texto, uf: texto, motivo: texto }, ['nome', 'uf', 'motivo'])),
    resumo: objeto({ informadas: contagem, novas: contagem, ja_vinculadas: contagem,
      repetidas: contagem, pendentes: contagem }, ['informadas', 'novas', 'ja_vinculadas', 'repetidas', 'pendentes']),
    token_previa: textoOpcional, pode_confirmar: booleano, expira_em: textoOpcional
  }, ['transportadora', 'cidades', 'pendencias', 'resumo', 'token_previa', 'pode_confirmar', 'expira_em']),
  confirmar_importacao_cidades: objeto({
    status: { type: 'string', enum: ['concluido'] }, transportadora,
    adicionadas: contagem, ja_vinculadas: contagem, total_vinculadas: contagem
  }, ['status', 'transportadora', 'adicionadas', 'ja_vinculadas', 'total_vinculadas'])
};

function outputSchemaFor(name) {
  if (!Object.prototype.hasOwnProperty.call(schemas, name)) {
    throw new Error('Ferramenta MCP sem contrato de saída: ' + name);
  }
  return schemas[name];
}

module.exports = { outputSchemaFor };
