const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 36;
const MARGIN_RIGHT = 36;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 42;

function texto(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
    minimumFractionDigits: 2
  });
}

function numero(valor, casas = 2) {
  const n = Number(valor || 0);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: casas
  });
}

function formatarData(valor) {
  if (!valor) return '-';

  if (typeof valor === 'string') {
    const match = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[3]}/${match[2]}/${match[1]}`;
    }
  }

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

function desenharCabecalho(doc, pedido) {
  doc.text('ALUMINIO JR', MARGIN_LEFT, doc.y, { fontSize: 18, bold: true });
  doc.textRight(`Pedido ${pedido?.numero || '-'}`, PAGE_WIDTH - MARGIN_RIGHT, doc.y + 3, { fontSize: 13, bold: true });
  doc.y -= 18;
  doc.text('Resumo do pedido para o cliente', MARGIN_LEFT, doc.y, { fontSize: 10 });
  doc.line(MARGIN_LEFT, doc.y - 9, PAGE_WIDTH - MARGIN_RIGHT, doc.y - 9);
  doc.y -= 28;
}

function desenharRodape(doc, paginaAtual, totalPaginas) {
  doc.text(`Pagina ${paginaAtual} de ${totalPaginas}`, MARGIN_LEFT, 22, { fontSize: 8 });
  doc.textRight(`Gerado em ${formatarData(new Date().toISOString())}`, PAGE_WIDTH - MARGIN_RIGHT, 22, { fontSize: 8 });
}

function linhaInfo(doc, label, value, x, y, width) {
  doc.text(label, x, y, { fontSize: 8, bold: true });
  const linhas = quebrarTexto(value || '-', width, 10);
  linhas.slice(0, 2).forEach((linha, index) => {
    doc.text(linha, x, y - 12 - (index * 11), { fontSize: 10 });
  });
}

function desenharDadosPedido(doc, pedido) {
  const boxX = MARGIN_LEFT;
  const boxY = doc.y - 82;
  const boxW = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const boxH = 92;

  doc.strokeGray(0.75);
  doc.rect(boxX, boxY, boxW, boxH, false);
  doc.strokeGray(0);

  const colW = (boxW - 24) / 3;
  const x1 = boxX + 10;
  const x2 = x1 + colW + 8;
  const x3 = x2 + colW + 8;
  const y1 = doc.y - 16;
  const y2 = doc.y - 55;

  linhaInfo(doc, 'CLIENTE', pedido?.cliente?.nome || '-', x1, y1, colW);
  linhaInfo(doc, 'VENDEDOR', pedido?.vendedor?.nome || '-', x2, y1, colW);
  linhaInfo(doc, 'DATA DO PEDIDO', formatarData(pedido?.data), x3, y1, colW);

  const cidadeUf = [pedido?.cliente?.cidade, pedido?.cliente?.uf].filter(Boolean).join(' / ') || '-';
  linhaInfo(doc, 'CIDADE / UF', cidadeUf, x1, y2, colW);
  linhaInfo(doc, 'TELEFONE', pedido?.cliente?.telefonePrincipal || pedido?.cliente?.telefone1 || '-', x2, y2, colW);
  linhaInfo(doc, 'CARRADA', pedido?.carradaAtual?.codigo ? `${pedido.carradaAtual.codigo} - ${formatarData(pedido.carradaAtual.data)} ${pedido.carradaAtual.descricao || ''}` : '-', x3, y2, colW);

  doc.y = boxY - 22;
}

function desenharCabecalhoItens(doc) {
  const x = MARGIN_LEFT;
  const tableW = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const y = doc.y;

  doc.fillGray(0.90);
  doc.rect(x, y - 18, tableW, 22, true);
  doc.fillGray(0);
  doc.text('Codigo', x + 4, y - 12, { fontSize: 9, bold: true });
  doc.text('Descricao', x + 58, y - 12, { fontSize: 9, bold: true });
  doc.textRight('Qtd', x + 360, y - 12, { fontSize: 9, bold: true });
  doc.textRight('Unitario', x + 440, y - 12, { fontSize: 9, bold: true });
  doc.textRight('Subtotal', x + tableW - 4, y - 12, { fontSize: 9, bold: true });
  doc.strokeGray(0.65);
  doc.rect(x, y - 18, tableW, 22, false);
  doc.strokeGray(0);
  doc.y -= 24;
}

function desenharItem(doc, pedido, item) {
  const x = MARGIN_LEFT;
  const tableW = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const descX = x + 58;
  const descW = 238;
  const linhasDesc = quebrarTexto(item?.descricao || '-', descW, 9).slice(0, 4);
  const rowH = Math.max(24, 10 + linhasDesc.length * 10);

  if (doc.y - rowH < MARGIN_BOTTOM + 60) {
    doc.addPage();
    desenharCabecalho(doc, pedido);
    desenharCabecalhoItens(doc);
  }

  const yTop = doc.y;
  doc.strokeGray(0.82);
  doc.rect(x, yTop - rowH + 4, tableW, rowH, false);
  doc.strokeGray(0);
  doc.text(item?.item || '-', x + 4, yTop - 10, { fontSize: 9 });

  linhasDesc.forEach((linha, index) => {
    doc.text(linha, descX, yTop - 10 - (index * 10), { fontSize: 9 });
  });

  const subtotal = Number(item?.subtotal ?? (Number(item?.quantidade || 0) * Number(item?.preco || 0)));
  doc.textRight(numero(item?.quantidade || 0, 3), x + 360, yTop - 10, { fontSize: 9 });
  doc.textRight(moeda(item?.preco || 0), x + 440, yTop - 10, { fontSize: 9 });
  doc.textRight(moeda(subtotal), x + tableW - 4, yTop - 10, { fontSize: 9 });
  doc.y -= rowH;
}

function desenharTotais(doc, pedido, itens) {
  doc.ensureSpace(95);
  const x = MARGIN_LEFT;
  const tableW = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const totalItens = itens.reduce((acc, item) => acc + Number(item?.subtotal ?? (Number(item?.quantidade || 0) * Number(item?.preco || 0))), 0);
  const totalQuantidade = itens.reduce((acc, item) => acc + Number(item?.quantidade || 0), 0);
  const totalPedido = Number(pedido?.total || totalItens || 0);

  doc.y -= 8;
  doc.fillGray(0.08);
  doc.rect(x, doc.y - 28, tableW, 34, true);
  doc.fillGray(1);
  doc.text(`Quantidade total: ${numero(totalQuantidade, 3)}`, x + 10, doc.y - 14, { fontSize: 11, bold: true });
  doc.textRight(`Total do pedido: ${moeda(totalPedido)}`, x + tableW - 10, doc.y - 14, { fontSize: 13, bold: true });
  doc.fillGray(0);
  doc.y -= 52;

  if (pedido?.obs) {
    const linhasObs = quebrarTexto(pedido.obs, tableW - 20, 9).slice(0, 6);
    const obsH = 24 + linhasObs.length * 11;
    doc.ensureSpace(obsH + 10);
    doc.strokeGray(0.75);
    doc.rect(x, doc.y - obsH + 6, tableW, obsH, false);
    doc.strokeGray(0);
    doc.text('Observacao', x + 10, doc.y - 8, { fontSize: 9, bold: true });
    linhasObs.forEach((linha, index) => {
      doc.text(linha, x + 10, doc.y - 22 - (index * 11), { fontSize: 9 });
    });
    doc.y -= obsH + 8;
  }
}

function gerarPdfPedido(pedido) {
  if (!pedido?.numero) {
    throw new Error('Pedido sem número para gerar PDF.');
  }

  const itens = Array.isArray(pedido?.itens) ? pedido.itens : [];
  const doc = new PdfSimples();

  desenharCabecalho(doc, pedido);
  desenharDadosPedido(doc, pedido);
  doc.text('Itens do pedido', MARGIN_LEFT, doc.y, { fontSize: 12, bold: true });
  doc.y -= 12;
  desenharCabecalhoItens(doc);

  itens.forEach((item) => desenharItem(doc, pedido, item));
  desenharTotais(doc, pedido, itens);

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
  gerarPdfPedido,
  formatarData,
  moeda
};
