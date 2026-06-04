const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const fs = require('fs');
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

    // Mayor logo top right - white background box then image
    doc.rect(pageW - margin - 105, margin - 8, 105, 36).fill('white');
    try {
      doc.image(LOGO_PATH, pageW - margin - 102, margin - 5, { width: 95 });
    } catch(e) {}

    // Horizontal rule
    doc.moveTo(margin, margin + 30).lineTo(pageW - margin, margin + 30).lineWidth(0.75).fillAndStroke('black', 'black');

    // ── LAYOUT ──
    const bodyY = margin + 42;
    const leftW = 195;
    const rightX = margin + leftW + 20;
    const rightW = pageW - margin - rightX;

    // ── LEFT COLUMN ──
    let ly = bodyY;

    doc.fontSize(9.5).font('Times-Bold')
       .text('Order Number', margin, ly, { continued: true, width: leftW })
       .font('Times-Roman').text(': ' + order_number, { width: leftW });
    ly += 15;

    doc.font('Times-Bold').text('Club', margin, ly, { continued: true, width: leftW })
       .font('Times-Roman').text(': ' + club, { width: leftW });
    ly += 18;

    doc.font('Times-Bold').text('Shipping / Billing Address:', margin, ly, { width: leftW });
    ly += 13;

    const addrLines = address.split(',').map(s => s.trim()).filter(Boolean);
    addrLines.forEach(line => {
      doc.font('Times-Roman').fontSize(9).text(line, margin, ly, { width: leftW });
      ly += 12;
    });
    ly += 8;

    doc.fontSize(9.5).font('Times-Bold')
       .text('Ship Date', margin, ly, { continued: true, width: leftW })
       .font('Times-Roman').text(': ' + ship_date, { width: leftW });
    ly += 18;

    doc.font('Times-Bold').text('Payment Terms:', margin, ly, { width: leftW });
    ly += 13;

    const terms = 'Due on receipt. Based on our custom model, garments are produced specially for each club. Once clubs approve their order, they are responsible for payment of its full value. There are no returns or exchanges. All sales are final. ';
    doc.fontSize(8.5).font('Times-Roman').text(terms, margin, ly, { width: leftW, continued: true })
       .fillColor('black').text('Here', { continued: true, underline: true, link: w9_link })
       .text(' is our W-9.', { underline: false, link: null });
    ly += doc.heightOfString(terms, { width: leftW }) + 18;

    doc.fontSize(9.5).font('Times-Bold').text('Payment Link:', margin, ly, { width: leftW });
    ly += 13;
    doc.fontSize(9).font('Times-Roman')
       .fillColor('black')
       .text('Click Here', margin, ly, { link: payment_link || '#', underline: true, width: leftW });

    // ── RIGHT COLUMN — TABLE ──
    let ry = bodyY;

    // Column widths
    const pW = 85;   // product
    const qW = 45;   // quantity
    const prW = 42;  // price
    const aW = 50;   // amount
    const dW = rightW - pW - qW - prW - aW; // description gets the rest

    const cP = rightX;
    const cD = rightX + pW;
    const cQ = rightX + pW + dW;
    const cPr = cQ + qW;
    const cA = cPr + prW;

    // Header row
    const hH = 18;
    doc.rect(rightX, ry, rightW, hH).fill('#1a1a18');
    doc.fillColor('white').fontSize(8.5).font('Times-Bold');
    doc.text('Product', cP + 4, ry + 5, { width: pW - 4 });
    doc.text('Description', cD + 4, ry + 5, { width: dW - 4 });
    doc.text('Quantity', cQ, ry + 5, { width: qW, align: 'right' });
    doc.text('Price', cPr, ry + 5, { width: prW, align: 'right' });
    doc.text('Amount', cA, ry + 5, { width: aW - 2, align: 'right' });
    doc.fillColor('#1a1a18');
    ry += hH;

    // Line items
    line_items.forEach((item, i) => {
      const descText = (item.description || '').replace(/\\n/g, '\n');
      const descH = doc.fontSize(8.5).heightOfString(descText, { width: dW - 8 });
      const rowH = Math.max(descH + 12, 28);

      // Alternating background
      if (i % 2 === 1) {
        doc.rect(rightX, ry, rightW, rowH).fill('#f9f9f8');
        doc.fillColor('#1a1a18');
      }
      doc.rect(rightX, ry, rightW, rowH).lineWidth(0.4).stroke('#cccccc');

      // Product (underlined link)
      doc.fontSize(8.5).font('Times-Roman').fillColor('#1a1a18')
         .text(item.product || '', cP + 4, ry + 6, {
           width: pW - 8,
           underline: true,
           link: item.url || '#'
         });

      // Description
      doc.text(descText, cD + 4, ry + 6, { width: dW - 8, lineGap: 1 });

      // Qty, Price, Amount
      doc.text(String(item.quantity || ''), cQ, ry + 6, { width: qW, align: 'right' });
      doc.text(item.price ? '$' + Number(item.price).toFixed(2) : '', cPr, ry + 6, { width: prW, align: 'right' });
      doc.text(item.amount ? '$' + Number(item.amount).toFixed(2) : '', cA, ry + 6, { width: aW - 2, align: 'right' });

      ry += rowH;
    });

    // Helper for bottom rows
    const drawRow = (label, value, strike = false) => {
      doc.rect(rightX, ry, rightW, 16).lineWidth(0.4).stroke('#cccccc');
      doc.fontSize(8.5).font('Times-Bold').fillColor('#1a1a18')
         .text(label, cPr - 50, ry + 4, { width: 50 + prW, align: 'right' });
      doc.font('Times-Roman').text(value, cA, ry + 4, { width: aW - 2, align: 'right' });
      if (strike) {
        const tw = doc.widthOfString(value);
        const tx = cA + aW - 2 - tw;
        doc.moveTo(tx, ry + 10).lineTo(tx + tw, ry + 10).lineWidth(0.6).stroke();
      }
      ry += 16;
    };

    // Subtotal
    const qtyTotal = line_items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    doc.rect(rightX, ry, rightW, 16).lineWidth(0.4).stroke('#cccccc');
    doc.fontSize(8.5).font('Times-Bold').fillColor('#1a1a18')
       .text('Subtotal', cQ - 50, ry + 4, { width: 50 + qW, align: 'right' });
    doc.font('Times-Roman').text(String(qtyTotal), cQ, ry + 4, { width: qW, align: 'right' });
    doc.text('$' + Number(subtotal).toFixed(2), cA, ry + 4, { width: aW - 2, align: 'right' });
    ry += 16;

    if (embroidery) drawRow('Embroidery', '$' + Number(embroidery).toFixed(2), true);
    if (art_setup) drawRow('Art Setup', '$' + Number(art_setup).toFixed(2), true);
    drawRow('Shipping', '$' + Number(shipping).toFixed(0));

    // Total
    doc.rect(rightX, ry, rightW, 18).lineWidth(0.4).stroke('#cccccc');
    doc.fontSize(9).font('Times-Bold').fillColor('#1a1a18')
       .text('Total', cPr - 50, ry + 5, { width: 50 + prW, align: 'right' });
    doc.text('$' + Number(total).toFixed(2), cA, ry + 5, { width: aW - 2, align: 'right' });

    // ── FOOTER ──
    doc.moveTo(margin, pageH - 38).lineTo(pageW - margin, pageH - 38).lineWidth(0.75).stroke();
    doc.fontSize(7).font('Times-Bold').fillColor('#1a1a18')
       .text('Mayor | 870 Inman Village Parkway NE, Suite 533, Atlanta, GA 30307 | 339-206-2111 | mayor@mayorclothing.com',
             margin, pageH - 28, { align: 'center', width: contentW, characterSpacing: 0.4 });

    doc.end();
  } catch(e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mayor invoice server running on port', PORT));
