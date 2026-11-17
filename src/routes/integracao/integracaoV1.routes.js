'use strict';

const express = require('express');
const router = express.Router();
const transportadorasService = require('../../services/logistica/transportadoraService');
const logisticaService = require('../../services/logistica/logisticaService');

function textoValido(valor, maximo) {
  return typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= maximo;
}

function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function erroInterno(res, codigo) {
  return res.status(500).json({ erro: 'Falha ao consultar dados da logística.', codigo });
}

// Primeira etapa: endpoints somente GET, reutilizando os serviços já existentes.
// A autenticação administrativa existente é aplicada no server.js ao montar o router.
// Não há acesso direto a SQL, novas credenciais ou operações de gravação.
router.get('/status', (_req, res) => {
  res.json({ ok: true, modulo: 'logistica', versao: 'v1', permissoes: ['consulta'] });
});

router.get('/transportadoras', async (req, res) => {
  const nome = req.query.nome;
  if (nome !== undefined && (typeof nome !== 'string' || nome.length > 120)) {
    return res.status(400).json({ erro: 'Filtro nome inválido (máximo 120 caracteres).' });
  }

  try {
    const dados = await transportadorasService.listarTransportadoras();
    const filtro = normalizar(String(nome || '').trim());
    const transportadoras = filtro
      ? dados.filter((item) => normalizar(item.nome).includes(filtro))
      : dados;

    return res.json({
      total: transportadoras.length,
      transportadoras: transportadoras.map((item) => ({
        id: item.id,
        nome: item.nome,
        cidade_nome: item.cidade_nome,
        cidade_estado: item.cidade_estado,
        telefone_principal: item.telefone_principal || item.telefone || null,
      })),
    });
  } catch (error) {
    console.error('[integracao/v1] consultar transportadoras:', error);
    return erroInterno(res, 'TRANSPORTADORAS_CONSULTA');
  }
});

router.get('/transportadoras/:id/cidades', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[1-9]\d{0,14}$/.test(id)) {
    return res.status(400).json({ erro: 'ID de transportadora inválido.' });
  }

  try {
    const cidades = await logisticaService.listarCidades(id);
    return res.json({ transportadora_id: id, total: cidades.length, cidades });
  } catch (error) {
    console.error('[integracao/v1] consultar cidades da transportadora:', error);
    return erroInterno(res, 'CIDADES_TRANSPORTADORA_CONSULTA');
  }
});

router.get('/cidades', async (req, res) => {
  if (!textoValido(req.query.nome, 120)) {
    return res.status(400).json({ erro: 'Informe o nome da cidade (até 120 caracteres).' });
  }

  try {
    const cidades = await logisticaService.buscarCidadesPorNome(req.query.nome.trim());
    return res.json({ total: cidades.length, cidades });
  } catch (error) {
    console.error('[integracao/v1] consultar cidades:', error);
    return erroInterno(res, 'CIDADES_CONSULTA');
  }
});

module.exports = router;
