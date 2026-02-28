const pool = require('../../../db/connection');

async function listar() {
    const result = await pool.query(
        'SELECT * FROM produtos ORDER BY id ASC'
    );
    return result.rows;
}

async function buscar(id) {
    const result = await pool.query(
        'SELECT * FROM produtos WHERE id = $1',
        [id]
    );

    if (result.rows.length === 0) {
        throw new Error('Produto não encontrado');
    }

    return result.rows[0];
}

async function criar(data) {
    const { nome, preco, categoria, foto, capacidade_caixa } = data;

    const result = await pool.query(
        `INSERT INTO produtos
        (nome, preco, categoria, foto, capacidade_caixa)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *`,
        [
            nome,
            preco,
            categoria || null,
            foto || null,
            capacidade_caixa || 1
        ]
    );

    return result.rows[0];
}

async function atualizar(id, data) {
    const { nome, preco, categoria, foto, capacidade_caixa } = data;

    const result = await pool.query(
        `UPDATE produtos SET
            nome = $1,
            preco = $2,
            categoria = $3,
            foto = $4,
            capacidade_caixa = $5,
            updated_at = NOW()
        WHERE id = $6
        RETURNING *`,
        [
            nome,
            preco,
            categoria || null,
            foto || null,
            capacidade_caixa || 1,
            id
        ]
    );

    if (result.rows.length === 0) {
        throw new Error('Produto não encontrado');
    }

    return result.rows[0];
}

async function excluir(id) {
    await pool.query(
        'DELETE FROM produtos WHERE id = $1',
        [id]
    );
}

module.exports = {
    listar,
    buscar,
    criar,
    atualizar,
    excluir
};
