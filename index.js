const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const LOGO_PATH = __dirname + '/Mayor_Logo_transparent.png';

app.post('/generate', (req, res) => {
  try {
    const data = req.body;
    const {
      order_number = '', club = '', address = '', ship_date = '',
      payment_link = '', w9_link = 'https://www.mayorclothing.com/w9',
      line_items = [], subtotal = 0, embroidery, art_setup,
      shipping = 0, total = 0
    } = data;

    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="mayor-invoice.pdf"');
    doc.pipe(res);

    const pageW = 612;
    const pageH = 792;
    const margin = 45;
    const contentW = pageW - margin * 2;

    // ── HEADER ──
    doc.fontSize(16).font('Times-Roman')
       .text('Invoice', margin, margin, { align: 'center', width: contentW, characterSpacing: 3 });

    // Logo - no background box, just image on white page
    try {
      doc.image(LOGO_PATH, pageW - margin - 98, margin - 8, { width: 90 });
    } catch(e) {}

    // Horizontal rule
    doc.moveTo(margin, margin + 30).lineTo(pageW - margin, margin + 30).lineWidth(0.75).stroke('black');

    // ── LAYOUT ──
    const bodyY = margin + 42;
    const leftW = 190;
    const rightX = margin + leftW + 22;
    const rightW = pageW - margin - rightX;

    // ── LEFT COLUMN ──
    let ly = bodyY;

    doc.fontSize(9.5).font('Times-Bold').text('Order Number', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + order_number, { width: leftW });
    ly += doc.heightOfString('Order Number: ' + order_number, { width: leftW }) + 5;

    doc.font('Times-Bold').text('Club', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + club, { width: leftW });
    ly += doc.heightOfString('Club: ' + club, { width: leftW }) + 10;

    doc.font('Times-Bold').text('Shipping / Billing Address:', margin, ly, { width: leftW });
    ly += 13;

    const addrLines = address.split(',').map(s => s.trim()).filter(Boolean);
    addrLines.forEach(line => {
      doc.font('Times-Roman').fontSize(9).text(line, margin, ly, { width: leftW });
      ly += 12;
    });
    ly += 8;

    doc.fontSize(9.5).font('Times-Bold').text('Ship Date', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + ship_date, { width: leftW });
    ly += doc.heightOfString('Ship Date: ' + ship_date, { width: leftW }) + 10;

    doc.font('Times-Bold').text('Payment Terms:', margin, ly, { width: leftW });
    ly += 13;

    const terms = 'Due on receipt. Based on our custom model, garments are produced specially for each club. Once clubs approve their order, they are responsible for payment of its full value. There are no returns or exchanges. All sales are final. ';
    doc.fontSize(8.5).font('Times-Roman').text(terms, margin, ly, { width: leftW, continued: true })
       .text('Here', { continued: true, underline: true, link: w9_link })
       .text(' is our W-9.', { underline: false });
    ly += doc.heightOfString(terms + 'Here is our W-9.', { width: leftW }) + 14;

    doc.fontSize(9.5).font('Times-Bold').text('Payment Link:', margin, ly, { width: leftW });
    ly += 13;
    doc.fontSize(9).font('Times-Roman')
       .text('Click Here', margin, ly, { link: payment_link || '#', underline: true, width: leftW });

    // ── RIGHT COLUMN — TABLE ──
    let ry = bodyY;

    // Column setup - give description more room
    const pW = 78;
    const qW = 44;
    const prW = 42;
    const aW = 52;
    const dW = rightW - pW - qW - prW - aW;

    const cP  = rightX;
    const cD  = rightX + pW;
    const cQ  = cD + dW;
    const cPr = cQ + qW;
    const cA  = cPr + prW;

    // Header
    const hH = 18;
    doc.rect(rightX, ry, rightW, hH).fill('#1a1a18');
    doc.fillColor('white').fontSize(8.5).font('Times-Bold');
    doc.text('Product',     cP + 3,  ry + 5, { width: pW - 3 });
    doc.text('Description', cD + 3,  ry + 5, { width: dW - 3 });
    doc.text('Quantity',    cQ,       ry + 5, { width: qW,  align: 'right' });
    doc.text('Price',       cPr,      ry + 5, { width: prW, align: 'right' });
    doc.text('Amount',      cA,       ry + 5, { width: aW - 2, align: 'right' });
    doc.fillColor('#1a1a18');
    ry += hH;

    // Line items
    line_items.forEach((item, i) => {
      const descText = (item.description || '').replace(/\\n/g, '\n');
      const descH = doc.fontSize(8.5).heightOfString(descText, { width: dW - 8, lineGap: 1.5 });
      const rowH = Math.max(descH + 14, 26);

      if (i % 2 === 1) {
        doc.rect(rightX, ry, rightW, rowH).fill('#f9f9f8').fillColor('#1a1a18');
      }
      doc.rect(rightX, ry, rightW, rowH).lineWidth(0.4).stroke('#cccccc');

      doc.fontSize(8.5).font('Times-Roman').fillColor('#1a1a18')
         .text(item.product || '', cP + 3, ry + 7, { width: pW - 6, underline: true, link: item.url || '#' });
      doc.text(descText, cD + 3, ry + 7, { width: dW - 6, lineGap: 1.5 });
      doc.text(String(item.quantity || ''), cQ, ry + 7, { width: qW, align: 'right' });
      doc.text(item.price ? '$' + Number(item.price).toFixed(2) : '', cPr, ry + 7, { width: prW, align: 'right' });
      doc.text(item.amount ? '$' + Number(item.amount).toFixed(2) : '', cA, ry + 7, { width: aW - 2, align: 'right' });

      ry += rowH;
    });

    // Bottom rows helper
    const drawRow = (label, value, strike = false, bold = false) => {
      doc.rect(rightX, ry, rightW, 17).lineWidth(0.4).stroke('#cccccc');
      doc.fontSize(8.5).font(bold ? 'Times-Bold' : 'Times-Bold').fillColor('#1a1a18')
         .text(label, cPr - 55, ry + 5, { width: 55 + prW, align: 'right' });
      doc.font('Times-Roman').text(value, cA, ry + 5, { width: aW - 2, align: 'right' });
      if (strike) {
        const tw = doc.widthOfString(value);
        const tx = cA + aW - 2 - tw;
        doc.moveTo(tx, ry + 11).lineTo(tx + tw, ry + 11).lineWidth(0.7).stroke('#1a1a18');
      }
      ry += 17;
    };

    // Subtotal
    const qtyTotal = line_items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    doc.rect(rightX, ry, rightW, 17).lineWidth(0.4).stroke('#cccccc');
    doc.fontSize(8.5).font('Times-Bold').fillColor('#1a1a18')
       .text('Subtotal', cQ - 50, ry + 5, { width: 50 + qW, align: 'right' });
    doc.font('Times-Roman')
       .text(String(qtyTotal), cQ, ry + 5, { width: qW, align: 'right' })
       .text('$' + Number(subtotal).toFixed(2), cA, ry + 5, { width: aW - 2, align: 'right' });
    ry += 17;

    if (embroidery) drawRow('Embroidery', '$' + Number(embroidery).toFixed(2), true);
    if (art_setup)  drawRow('Art Setup',  '$' + Number(art_setup).toFixed(2),  true);
    drawRow('Shipping', '$' + Number(shipping).toFixed(0));

    // Total row
    doc.rect(rightX, ry, rightW, 18).lineWidth(0.4).stroke('#cccccc');
    doc.fontSize(9).font('Times-Bold').fillColor('#1a1a18')
       .text('Total', cPr - 55, ry + 5, { width: 55 + prW, align: 'right' })
       .text('$' + Number(total).toFixed(2), cA, ry + 5, { width: aW - 2, align: 'right' });

    // ── FOOTER ──
    doc.moveTo(margin, pageH - 38).lineTo(pageW - margin, pageH - 38).lineWidth(0.75).stroke();
    doc.fontSize(7).font('Times-Bold').fillColor('#1a1a18')
       .text('Mayor | 870 Inman Village Parkway NE, Suite 533, Atlanta, GA 30307 | 339-206-2111 | mayor@mayorclothing.com',
             margin, pageH - 27, { align: 'center', width: contentW, characterSpacing: 0.5 });

    doc.end();
  } catch(e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mayor invoice server running on port', PORT));
