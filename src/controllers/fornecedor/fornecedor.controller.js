const fornecedorService = require('../../services/fornecedor/fornecedor.service');

class FornecedorController {

  async listar(req, res) {
    try {
      const { nome } = req.query;
      const fornecedores = await fornecedorService.listar(nome);
      return res.json(fornecedores);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao listar fornecedores' });
    }
  }

  async buscarPorId(req, res) {
    try {
      const { id } = req.params;

      const fornecedor = await fornecedorService.buscarPorId(id);

      if (!fornecedor) {
        return res.status(404).json({ error: 'Fornecedor não encontrado' });
      }

      return res.json(fornecedor);

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao buscar fornecedor' });
    }
  }

  async criar(req, res) {
    try {
      const { nome, contato_principal, telefone, cidade_id } = req.body;

      if (!nome || !contato_principal || !telefone || !cidade_id) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
      }

      const novoFornecedor = await fornecedorService.criar({
        nome,
        contato_principal,
        telefone,
        cidade_id
      });

      return res.status(201).json(novoFornecedor);

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao criar fornecedor' });
    }
  }

  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const { nome, contato_principal, telefone, cidade_id } = req.body;

      if (!nome || !contato_principal || !telefone || !cidade_id) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
      }

      const atualizado = await fornecedorService.atualizar(id, {
        nome,
        contato_principal,
        telefone,
        cidade_id
      });

      if (!atualizado) {
        return res.status(404).json({ error: 'Fornecedor não encontrado' });
      }

      return res.json(atualizado);

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao atualizar fornecedor' });
    }
  }

  async deletar(req, res) {
    try {
      const { id } = req.params;

      await fornecedorService.deletar(id);

      return res.json({ message: 'Fornecedor removido com sucesso' });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao deletar fornecedor' });
    }
  }

}

module.exports = new FornecedorController();
