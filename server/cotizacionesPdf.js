'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const fmtCOP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

function findBrandLogo() {
  const dir = path.join(__dirname, 'data', 'brand');
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg', 'tecnoxpert.png']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {object} quote - normalized quote from OpenAI
 * @param {{ subtotal, iva, total }} totals
 * @param {{ full_name, email, phone }} advisor
 */
function buildCotizacionPdfBuffer(quote, totals, advisor) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Cotización Bruja TecnoXpert' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const margin = 48;
    const contentW = pageW - margin * 2;
    let y = margin;

    const logoPath = findBrandLogo();
    if (logoPath) {
      try {
        doc.image(logoPath, margin, y, { width: 140 });
        y += 52;
      } catch {
        y = drawTextLogo(doc, margin, y, contentW);
      }
    } else {
      y = drawTextLogo(doc, margin, y, contentW);
    }

    doc.fillColor('#0d1b14').fontSize(20).font('Helvetica-Bold');
    doc.text('COTIZACIÓN', margin, y, { width: contentW, align: 'right' });
    y += 28;

    const now = new Date();
    const validUntil = new Date(now.getTime() + quote.validez_dias * 86400000);
    doc.fontSize(9).font('Helvetica').fillColor('#555555');
    doc.text(`Fecha: ${now.toLocaleDateString('es-CO', { dateStyle: 'long' })}`, margin, y, {
      width: contentW,
      align: 'right'
    });
    y += 12;
    doc.text(
      `Válida hasta: ${validUntil.toLocaleDateString('es-CO', { dateStyle: 'long' })}`,
      margin,
      y,
      { width: contentW, align: 'right' }
    );
    y += 22;

    doc.fillColor('#111111').fontSize(11).font('Helvetica-Bold');
    doc.text('Cliente', margin, y);
    y += 16;
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(quote.cliente_nombre || '—', margin, y, { width: contentW });
    y += quote.cliente_nombre ? 14 : 10;
    if (quote.cliente_contacto) {
      doc.text(quote.cliente_contacto, margin, y, { width: contentW });
      y += 18;
    } else {
      y += 6;
    }

    y += 8;
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 14;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
    doc.text('Ítems', margin, y);
    y += 18;

    const colDesc = margin;
    const colCant = margin + contentW * 0.58;
    const colUnit = margin + contentW * 0.68;
    const colSub = margin + contentW * 0.82;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666666');
    doc.text('Descripción', colDesc, y, { width: colCant - colDesc - 8 });
    doc.text('Cant.', colCant, y, { width: colUnit - colCant - 4, align: 'right' });
    doc.text('V. unit.', colUnit, y, { width: colSub - colUnit - 4, align: 'right' });
    doc.text('Subtotal', colSub, y, { width: contentW - (colSub - margin), align: 'right' });
    y += 14;
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#eeeeee').stroke();
    y += 8;

    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    if (quote.items.length === 0) {
      doc.text('(Sin ítems detallados — revisá la conversación o regenerá el PDF)', colDesc, y);
      y += 22;
    } else {
      for (const it of quote.items) {
        const lineSub = it.cantidad * it.precio_unitario;
        const h = Math.max(
          28,
          doc.heightOfString(it.descripcion, { width: colCant - colDesc - 8 }) + 6
        );
        if (y + h > doc.page.height - 120) {
          doc.addPage();
          y = margin;
        }
        doc.text(it.descripcion, colDesc, y, { width: colCant - colDesc - 8 });
        doc.text(String(it.cantidad), colCant, y, { width: colUnit - colCant - 4, align: 'right' });
        doc.text(fmtCOP.format(it.precio_unitario), colUnit, y, {
          width: colSub - colUnit - 4,
          align: 'right'
        });
        doc.text(fmtCOP.format(lineSub), colSub, y, {
          width: contentW - (colSub - margin),
          align: 'right'
        });
        y += h;
      }
    }

    y += 16;
    doc.moveTo(margin + contentW * 0.55, y).lineTo(margin + contentW, y).strokeColor('#dddddd').stroke();
    y += 10;

    const rx = margin + contentW * 0.55;
    const rw = contentW * 0.45;
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.text('Subtotal', rx, y, { width: rw * 0.5 });
    doc.text(fmtCOP.format(totals.subtotal), rx, y, { width: rw, align: 'right' });
    y += 14;
    if (quote.incluir_iva && quote.iva_porcentaje > 0) {
      doc.text(`IVA (${quote.iva_porcentaje}%)`, rx, y, { width: rw * 0.5 });
      doc.text(fmtCOP.format(totals.iva), rx, y, { width: rw, align: 'right' });
      y += 14;
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0d1b14');
    doc.text('TOTAL', rx, y, { width: rw * 0.5 });
    doc.text(fmtCOP.format(totals.total), rx, y, { width: rw, align: 'right' });
    y += 28;

    if (quote.notas) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333');
      doc.text('Notas', margin, y);
      y += 12;
      doc.font('Helvetica').fontSize(8).fillColor('#555555');
      doc.text(quote.notas, margin, y, { width: contentW, align: 'left' });
      y += doc.heightOfString(quote.notas, { width: contentW }) + 16;
    }

    y = Math.max(y, doc.page.height - 140);
    doc.moveTo(margin, y).lineTo(margin + contentW, y).strokeColor('#3dd6c6').stroke();
    y += 16;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
    doc.text('Asesor', margin, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    const advName = String(advisor?.full_name || 'Bruja TecnoXpert').trim();
    doc.text(advName, margin, y);
    y += 12;
    const contact = [advisor?.email, advisor?.phone].filter(Boolean).join(' · ');
    if (contact) {
      doc.text(contact, margin, y);
      y += 14;
    }
    y += 18;
    doc.moveTo(margin, y).lineTo(margin + 160, y).strokeColor('#999999').stroke();
    y += 6;
    doc.fontSize(7).fillColor('#888888');
    doc.text('Firma', margin, y);

    doc.end();
  });
}

function drawTextLogo(doc, margin, y, contentW) {
  doc.fillColor('#1a6b62').fontSize(22).font('Helvetica-Bold');
  doc.text('Bruja TecnoXpert', margin, y);
  doc.fillColor('#3dd6c6').fontSize(9).font('Helvetica');
  doc.text('Tecnología · Colombia', margin, y + 24, { width: contentW * 0.6 });
  return y + 42;
}

module.exports = { buildCotizacionPdfBuffer, findBrandLogo };
