const pool = require('../../../db/connection');

function normalizarTexto(texto) {
    return (texto || '').replace(/\uFFFD/g, '').replace(/•/g, '\n').replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[\u{2600}-\u{27BF}]/gu, '').replace(/[*_~]/g, '').replace(/[ \t]+/g, ' ').split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
}

function extrairItens(texto) {
    const itens = [];
    const normalizado = normalizarTexto(texto);
    const linhas = normalizado.split('\n');

    for (const linha of linhas) {
        const l = (linha || '').toLowerCase();

        if (l.includes('orçamento') || l.includes('orcamento') || l.includes('valor total')) continue;

        if (linha.includes('×') || /\sx\s/i.test(linha)) {
            const partes = linha.includes('×') ? linha.split('×') : linha.split(/\sx\s/i);
            const esquerda = partes[0] || '';
            const direita = partes[1] || '';
            const qtyMatch = direita.match(/(\d+)/);
            if (!qtyMatch) continue;
            const quantidade = parseInt(qtyMatch[1]);
            const nome = esquerda.split('R$')[0].replace(/[,;:•]+$/, '').trim();
            if (nome) itens.push({ nome, quantidade });
            continue;
        }

        const kitMatch = linha.match(/\(x(\d+)\)/);
        if (kitMatch) {
            const quantidade = parseInt(kitMatch[1]);
            const nome = linha.replace(/\(x\d+\)/g, '').replace(/^-/ , '').trim();
            if (nome) itens.push({ nome, quantidade });
            continue;
        }

        if (linha.includes('+')) {
            const produtos = linha.split('+');
            for (const produto of produtos) {
                const nome = produto.trim();
                if (nome) itens.push({ nome, quantidade: 1 });
            }
        }
    }

    return itens;
}

async function buscarProduto(nome) {
    const result = await pool.query('SELECT nome, capacidade_caixa FROM produtos WHERE nome ILIKE $1 LIMIT 1', [`%${nome}%`]);
    return result.rows[0] || null;
}

async function calcular(texto, multiplicador = 1) {
    const itens = extrairItens(texto);
    if (itens.length === 0) throw new Error('Nenhum produto encontrado no texto');

    const naoEncontrados = [];
    const resultado = [];
    let somaVolumes = 0;

    for (const item of itens) {
        const produto = await buscarProduto(item.nome);
        if (!produto) {
            naoEncontrados.push(item.nome);
            continue;
        }
        if (produto.capacidade_caixa === 0) continue;

        const quantidadeFinal = item.quantidade * multiplicador;
        const volumes = quantidadeFinal / produto.capacidade_caixa;
        somaVolumes += volumes;

        resultado.push({
            produto: produto.nome,
            quantidade: item.quantidade,
            multiplicador: multiplicador,
            quantidade_final: quantidadeFinal,
            capacidade_caixa: produto.capacidade_caixa,
            volumes
        });
    }

    if (naoEncontrados.length > 0) {
        throw new Error(`Produtos não encontrados: ${naoEncontrados.join(', ')}`);
    }

    const total_volumes = Math.ceil(somaVolumes);
    return { itens: resultado, total_volumes, multiplicador };
}

module.exports = { normalizarTexto, extrairItens, buscarProduto, calcular };