const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 36;
const MARGIN_RIGHT = 36;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 42;

function texto(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor)
    .normalize('NFC')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
    .trim();
}

function moeda(valor) {
  const numero = Number(valor || 0);
  return numero.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function numero(valor, casas = 3) {
  const n = Number(valor || 0);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas
  });
}

function formatarData(valor) {
  if (!valor) return '-';

  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    const dia = String(valor.getUTCDate()).padStart(2, '0');
    const mes = String(valor.getUTCMonth() + 1).padStart(2, '0');
    return `${dia}/${mes}/${valor.getUTCFullYear()}`;
  }

  const valorTexto = String(valor);
  const match = valorTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return texto(valor).slice(0, 10) || '-';
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' });
}

function escaparPdfString(value) {
  return texto(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function larguraAproximada(value, fontSize) {
  return texto(value).length * fontSize * 0.52;
}

function quebrarTexto(value, maxWidth, fontSize) {
  const conteudo = texto(value);
  if (!conteudo) return [''];

  const palavras = conteudo.split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';

  palavras.forEach((palavra) => {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (larguraAproximada(tentativa, fontSize) <= maxWidth || !atual) {
      atual = tentativa;
      return;
    }
    linhas.push(atual);
    atual = palavra;
  });

  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [''];
}

class PdfSimples {
  constructor() {
    this.pages = [];
    this.page = null;
    this.y = PAGE_HEIGHT - MARGIN_TOP;
    this.addPage();
  }

  addPage() {
    this.page = { commands: [] };
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN_TOP;
  }

  cmd(command) {
    this.page.commands.push(command);
  }

  line(x1, y1, x2, y2) {
    this.cmd(`0 G 0.7 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rect(x, y, width, height, fill = false) {
    this.cmd(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re ${fill ? 'f' : 'S'}`);
  }

  fillGray(gray) {
    this.cmd(`${gray.toFixed(3)} g`);
  }

  strokeGray(gray) {
    this.cmd(`${gray.toFixed(3)} G`);
  }

  text(value, x, y, options = {}) {
    const fontSize = Number(options.fontSize || 10);
    const font = options.bold ? 'F2' : 'F1';
    const escaped = escaparPdfString(value);
    this.cmd(`BT /${font} ${fontSize.toFixed(2)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escaped}) Tj ET`);
  }

  textRight(value, rightX, y, options = {}) {
    const fontSize = Number(options.fontSize || 10);
    const x = rightX - larguraAproximada(value, fontSize);
    this.text(value, x, y, options);
  }

  ensureSpace(height) {
    if (this.y - height < MARGIN_BOTTOM) {
      this.addPage();
      return true;
    }
    return false;
  }

  toBuffer() {
    const objects = [];
    const addObject = (body) => {
      objects.push(body);
      return objects.length;
    };

    const catalogId = addObject('');
    const pagesId = addObject('');
    const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds = [];

    this.pages.forEach((page) => {
      const stream = page.commands.join('\n');
      const streamBuffer = Buffer.from(stream, 'latin1');
      const contentId = addObject(Buffer.concat([
        Buffer.from(`<< /Length ${streamBuffer.length} >>\nstream\n`, 'latin1'),
        streamBuffer,
        Buffer.from('\nendstream', 'latin1')
      ]));

      const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
    const offsets = [0];

    objects.forEach((body, index) => {
      offsets.push(Buffer.concat(chunks).length);
      chunks.push(Buffer.from(`${index + 1} 0 obj\n`, 'latin1'));
      chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
      chunks.push(Buffer.from('\nendobj\n', 'latin1'));
    });

    const startXref = Buffer.concat(chunks).length;
    chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, 'latin1'));
    offsets.slice(1).forEach((offset) => {
      chunks.push(Buffer.from(`${String(offset).padStart(10, '0')} 00000 n \n`, 'latin1'));
    });
    chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`, 'latin1'));

    return Buffer.concat(chunks);
  }
}

function desenharCabecalho(doc, cabecalho) {
  doc.text('ALUMÍNIO JR', MARGIN_LEFT, doc.y, { fontSize: 18, bold: true });
  doc.textRight(`Prestação #${cabecalho?.id || '-'}`, PAGE_WIDTH - MARGIN_RIGHT, doc.y + 3, { fontSize: 12, bold: true });
  doc.y -= 18;
  doc.text('Relatório de prestação de contas', MARGIN_LEFT, doc.y, { fontSize: 10 });
  doc.line(MARGIN_LEFT, doc.y - 9, PAGE_WIDTH - MARGIN_RIGHT, doc.y - 9);
  doc.y -= 28;
}

function desenharRodape(doc, paginaAtual, totalPaginas) {
  doc.text(`Página ${paginaAtual} de ${totalPaginas}`, MARGIN_LEFT, 22, { fontSize: 8 });
  doc.textRight(`Gerado em ${formatarData(new Date())}`, PAGE_WIDTH - MARGIN_RIGHT, 22, { fontSize: 8 });
}

function desenharDadosPrestacao(doc, cabecalho) {
  const x = MARGIN_LEFT;
  const width = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const coluna = width / 2;
  const yTop = doc.y;
  const altura = 76;

  doc.strokeGray(0.72);
  doc.rect(x, yTop - altura, width, altura, false);
  doc.line(x + coluna, yTop, x + coluna, yTop - altura);
  doc.strokeGray(0);

  const campos = [
    ['Fornecedor', cabecalho?.fornecedor_nome || '-'],
    ['Prestação', cabecalho?.titulo || '-'],
    ['Data de referência', formatarData(cabecalho?.data_referencia)],
    ['Status', cabecalho?.status || 'ABERTA']
  ];

  campos.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const px = x + (col * coluna) + 10;
    const py = yTop - 15 - (row * 34);
    doc.text(label, px, py, { fontSize: 8, bold: true });
    const linhas = quebrarTexto(value, coluna - 20, 10).slice(0, 2);
    linhas.forEach((linha, linhaIndex) => {
      doc.text(linha, px, py - 13 - (linhaIndex * 10), { fontSize: 10 });
    });
  });

  doc.y -= altura + 20;
}

function desenharTituloSecao(doc, tituloSecao) {
  doc.text(tituloSecao, MARGIN_LEFT, doc.y, { fontSize: 12, bold: true });
  doc.y -= 16;
}

function desenharCabecalhoMateriais(doc) {
  const x = MARGIN_LEFT;
  const w = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const y = doc.y;
  doc.fillGray(0.90);
  doc.rect(x, y - 20, w, 22, true);
  doc.fillGray(0);
  doc.text('Material', x + 5, y - 13, { fontSize: 8, bold: true });
  doc.textRight('Peso (kg)', x + 330, y - 13, { fontSize: 8, bold: true });
  doc.textRight('Preço/kg', x + 420, y - 13, { fontSize: 8, bold: true });
  doc.textRight('Total', x + w - 5, y - 13, { fontSize: 8, bold: true });
  doc.y -= 22;
}

function desenharMaterial(doc, cabecalho, item) {
  const x = MARGIN_LEFT;
  const w = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const descW = 240;
  const linhas = quebrarTexto(item?.descricao_material || '-', descW, 9).slice(0, 4);
  const rowH = Math.max(24, 10 + linhas.length * 10);

  if (doc.y - rowH < MARGIN_BOTTOM + 20) {
    doc.addPage();
    desenharCabecalho(doc, cabecalho);
    desenharTituloSecao(doc, 'Materiais lançados - continuação');
    desenharCabecalhoMateriais(doc);
  }

  const yTop = doc.y;
  doc.strokeGray(0.82);
  doc.rect(x, yTop - rowH + 2, w, rowH, false);
  doc.strokeGray(0);
  linhas.forEach((linha, index) => doc.text(linha, x + 5, yTop - 11 - (index * 10), { fontSize: 9 }));
  doc.textRight(numero(item?.peso_kg, 3), x + 330, yTop - 11, { fontSize: 9 });
  doc.textRight(moeda(item?.preco_por_kg), x + 420, yTop - 11, { fontSize: 9 });
  doc.textRight(moeda(item?.total_item), x + w - 5, yTop - 11, { fontSize: 9 });
  doc.y -= rowH;
}

function desenharTotalMateriais(doc, cabecalho, totais) {
  if (doc.y - 34 < MARGIN_BOTTOM + 20) {
    doc.addPage();
    desenharCabecalho(doc, cabecalho);
  }
  const x = MARGIN_LEFT;
  const w = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  doc.fillGray(0.94);
  doc.rect(x, doc.y - 26, w, 28, true);
  doc.fillGray(0);
  doc.text(`Peso total: ${numero(totais?.peso_total, 3)} kg`, x + 8, doc.y - 17, { fontSize: 9, bold: true });
  doc.textRight(`Valor da compra: ${moeda(totais?.total_material)}`, x + w - 8, doc.y - 17, { fontSize: 10, bold: true });
  doc.y -= 42;
}

function desenharCabecalhoPagamentos(doc) {
  const x = MARGIN_LEFT;
  const w = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const y = doc.y;
  doc.fillGray(0.90);
  doc.rect(x, y - 20, w, 22, true);
  doc.fillGray(0);
  doc.text('Data', x + 5, y - 13, { fontSize: 8, bold: true });
  doc.text('Observação', x + 92, y - 13, { fontSize: 8, bold: true });
  doc.textRight('Valor', x + w - 5, y - 13, { fontSize: 8, bold: true });
  doc.y -= 22;
}

function desenharPagamento(doc, cabecalho, pagamento) {
  const x = MARGIN_LEFT;
  const w = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const observacaoW = 310;
  const linhas = quebrarTexto(pagamento?.observacao || '-', observacaoW, 9).slice(0, 4);
  const rowH = Math.max(24, 10 + linhas.length * 10);

  if (doc.y - rowH < MARGIN_BOTTOM + 20) {
    doc.addPage();
    desenharCabecalho(doc, cabecalho);
    desenharTituloSecao(doc, 'Pagamentos lançados - continuação');
    desenharCabecalhoPagamentos(doc);
  }

  const yTop = doc.y;
  doc.strokeGray(0.82);
  doc.rect(x, yTop - rowH + 2, w, rowH, false);
  doc.strokeGray(0);
  doc.text(formatarData(pagamento?.data_pagamento), x + 5, yTop - 11, { fontSize: 9 });
  linhas.forEach((linha, index) => doc.text(linha, x + 92, yTop - 11 - (index * 10), { fontSize: 9 }));
  doc.textRight(moeda(pagamento?.valor), x + w - 5, yTop - 11, { fontSize: 9 });
  doc.y -= rowH;
}

function desenharResumoFinal(doc, cabecalho, totais) {
  const altura = 90;
  if (doc.y - altura < MARGIN_BOTTOM + 10) {
    doc.addPage();
    desenharCabecalho(doc, cabecalho);
  }

  const x = PAGE_WIDTH - MARGIN_RIGHT - 300;
  const w = 300;
  const yTop = doc.y - 4;
  const linhas = [
    ['Valor da compra', moeda(totais?.total_material)],
    ['Total já pago', moeda(totais?.total_pago)],
    ['Saldo restante', moeda(totais?.saldo_restante)]
  ];

  linhas.forEach(([label, value], index) => {
    const y = yTop - (index * 28);
    doc.fillGray(index === 2 ? 0.88 : 0.96);
    doc.rect(x, y - 24, w, 26, true);
    doc.fillGray(0);
    doc.text(label, x + 10, y - 15, { fontSize: index === 2 ? 10 : 9, bold: true });
    doc.textRight(value, x + w - 10, y - 15, { fontSize: index === 2 ? 11 : 10, bold: true });
  });
  doc.y -= altura;
}

function desenharAssinaturas(doc, cabecalho) {
  const altura = 58;
  if (doc.y - altura < MARGIN_BOTTOM + 5) {
    doc.addPage();
    desenharCabecalho(doc, cabecalho);
  }
  const x = MARGIN_LEFT;
  const w = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const col = (w - 40) / 2;
  const y = doc.y - 30;
  doc.line(x, y, x + col, y);
  doc.line(x + col + 40, y, x + w, y);
  doc.textRight('Alumínio JR', x + (col / 2) + 35, y - 14, { fontSize: 8 });
  doc.textRight('Fornecedor', x + col + 40 + (col / 2) + 25, y - 14, { fontSize: 8 });
  doc.y -= altura;
}

function gerarPdfPrestacao(resumo) {
  const cabecalho = resumo?.cabecalho;
  if (!cabecalho?.id) {
    throw new Error('Prestação inválida para gerar PDF.');
  }

  const materiais = Array.isArray(resumo?.materiais) ? resumo.materiais : [];
  const pagamentos = Array.isArray(resumo?.pagamentos) ? resumo.pagamentos : [];
  const totais = resumo?.totais || {};
  const doc = new PdfSimples();

  desenharCabecalho(doc, cabecalho);
  desenharDadosPrestacao(doc, cabecalho);

  desenharTituloSecao(doc, 'Materiais lançados');
  desenharCabecalhoMateriais(doc);
  if (!materiais.length) {
    doc.text('Nenhum material lançado.', MARGIN_LEFT + 5, doc.y - 13, { fontSize: 9 });
    doc.y -= 24;
  } else {
    materiais.forEach((item) => desenharMaterial(doc, cabecalho, item));
  }
  desenharTotalMateriais(doc, cabecalho, totais);

  desenharTituloSecao(doc, 'Pagamentos lançados');
  desenharCabecalhoPagamentos(doc);
  if (!pagamentos.length) {
    doc.text('Nenhum pagamento lançado.', MARGIN_LEFT + 5, doc.y - 13, { fontSize: 9 });
    doc.y -= 24;
  } else {
    pagamentos.forEach((pagamento) => desenharPagamento(doc, cabecalho, pagamento));
  }

  doc.y -= 12;
  desenharResumoFinal(doc, cabecalho, totais);
  desenharAssinaturas(doc, cabecalho);

  const totalPaginas = doc.pages.length;
  doc.pages.forEach((page, index) => {
    const antiga = doc.page;
    doc.page = page;
    desenharRodape(doc, index + 1, totalPaginas);
    doc.page = antiga;
  });

  return doc.toBuffer();
}

module.exports = {
  gerarPdfPrestacao,
  formatarData,
  moeda
};
