const prestacaoContasService = require('../../services/prestacao_contas/prestacao_contas.service');

class PrestacaoContasController {

  // ─── PRESTAÇÕES ───────────────────────────────────────────────

  async listar(req, res) {
    try {
      const data = await prestacaoContasService.listar();
      return res.json({ success: true, data });
    } catch (error) {
      console.error('ERRO listar prestações:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async buscarPorId(req, res) {
    try {
      const { id } = req.params;
      const data = await prestacaoContasService.buscarPorId(id);
      if (!data) return res.status(404).json({ success: false, message: 'Prestação não encontrada' });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('ERRO buscar prestação:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async criar(req, res) {
    try {
      const { titulo, data_referencia, fornecedor_id } = req.body;
      if (!titulo || !data_referencia) {
        return res.status(400).json({ success: false, message: 'titulo e data_referencia são obrigatórios' });
      }
      const data = await prestacaoContasService.criar({ titulo, data_referencia, fornecedor_id });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      console.error('ERRO criar prestação:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const { titulo, data_referencia, fornecedor_id } = req.body;
      if (!titulo || !data_referencia) {
        return res.status(400).json({ success: false, message: 'titulo e data_referencia são obrigatórios' });
      }
      const data = await prestacaoContasService.atualizar(id, { titulo, data_referencia, fornecedor_id });
      if (!data) return res.status(404).json({ success: false, message: 'Prestação não encontrada' });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('ERRO atualizar prestação:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async deletar(req, res) {
    try {
      const { id } = req.params;
      await prestacaoContasService.deletar(id);
      return res.json({ success: true, data: null });
    } catch (error) {
      console.error('ERRO deletar prestação:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // ─── ITENS ────────────────────────────────────────────────────

  async criarItem(req, res) {
    try {
      const { id } = req.params;
      const { material, peso_kg, preco_por_kg } = req.body;
      if (!material || peso_kg == null || preco_por_kg == null) {
        return res.status(400).json({ success: false, message: 'material, peso_kg e preco_por_kg são obrigatórios' });
      }
      const data = await prestacaoContasService.criarItem(id, { material, peso_kg, preco_por_kg });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      console.error('ERRO criar item:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async atualizarItem(req, res) {
    try {
      const { id, itemId } = req.params;
      const { material, peso_kg, preco_por_kg } = req.body;
      if (!material || peso_kg == null || preco_por_kg == null) {
        return res.status(400).json({ success: false, message: 'material, peso_kg e preco_por_kg são obrigatórios' });
      }
      const data = await prestacaoContasService.atualizarItem(id, itemId, { material, peso_kg, preco_por_kg });
      if (!data) return res.status(404).json({ success: false, message: 'Item não encontrado' });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('ERRO atualizar item:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async deletarItem(req, res) {
    try {
      const { id, itemId } = req.params;
      await prestacaoContasService.deletarItem(id, itemId);
      return res.json({ success: true, data: null });
    } catch (error) {
      console.error('ERRO deletar item:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // ─── PAGAMENTOS ───────────────────────────────────────────────

  async criarPagamento(req, res) {
    try {
      const { id } = req.params;
      const { data: dataPag, valor, observacao } = req.body;
      if (!dataPag || valor == null) {
        return res.status(400).json({ success: false, message: 'data e valor são obrigatórios' });
      }
      const data = await prestacaoContasService.criarPagamento(id, { data: dataPag, valor, observacao });
      return res.status(201).json({ success: true, data });
    } catch (error) {
      console.error('ERRO criar pagamento:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  async deletarPagamento(req, res) {
    try {
      const { id, pagamentoId } = req.params;
      await prestacaoContasService.deletarPagamento(id, pagamentoId);
      return res.json({ success: true, data: null });
    } catch (error) {
      console.error('ERRO deletar pagamento:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  // ─── RESUMO ───────────────────────────────────────────────────

  async resumo(req, res) {
    try {
      const { id } = req.params;
      const data = await prestacaoContasService.gerarResumoPrestacao(id);
      return res.json({ success: true, data });
    } catch (error) {
      console.error('ERRO gerar resumo:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }

}

module.exports = new PrestacaoContasController();

