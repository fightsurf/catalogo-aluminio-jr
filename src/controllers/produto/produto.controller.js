const produtoService = require('../../services/produto/produto.service');

async function listar(req, res) {
    try {
        const dados = await produtoService.listar();
        res.json({ success: true, data: dados });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function buscar(req, res) {
    try {
        const dados = await produtoService.buscar(req.params.id);
        res.json({ success: true, data: dados });
    } catch (error) {
        res.status(404).json({ success: false, message: error.message });
    }
}

async function criar(req, res) {
    try {
        const dados = await produtoService.criar(req.body);
        res.status(201).json({ success: true, data: dados });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

async function atualizar(req, res) {
    try {
        const dados = await produtoService.atualizar(req.params.id, req.body);
        res.json({ success: true, data: dados });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

async function excluir(req, res) {
    try {
        await produtoService.excluir(req.params.id);
        res.json({ success: true, message: 'Produto removido' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

module.exports = {
    listar,
    buscar,
    criar,
    atualizar,
    excluir
};
