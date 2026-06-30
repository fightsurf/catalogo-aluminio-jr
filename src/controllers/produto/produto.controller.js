const produtoService = require('../../services/produto/produto.service');
const cloudflareR2Service = require('../../services/cloudflare/cloudflareR2.service');

async function listar(req, res) {
    try {
        const { busca, ativos } = req.query;

        const dados = await produtoService.listar({
            busca,
            apenasAtivos: ativos === 'true'
        });

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

async function uploadFoto(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Selecione uma imagem para enviar.' });
        }

        const produto = await produtoService.buscar(req.params.id);
        const posicao = Number.parseInt(req.params.posicao, 10);

        const upload = await cloudflareR2Service.uploadImagem(req.file, {
            produto_id: produto.id,
            produto_nome: produto.nome,
            posicao,
        });

        const produtoAtualizado = await produtoService.atualizarFoto(req.params.id, posicao, upload.url);

        res.json({
            success: true,
            data: {
                produto: produtoAtualizado,
                posicao,
                url: upload.url,
                r2_key: upload.key || upload.id,
            },
        });
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
    uploadFoto,
    excluir
};
