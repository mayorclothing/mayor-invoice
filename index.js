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

    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="mayor-invoice.pdf"');
    doc.pipe(res);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 50;
    const contentW = pageW - margin * 2;

    // ── HEADER ──
    doc.fontSize(18).font('Times-Roman')
       .text('Invoice', margin, margin, { align: 'center', width: contentW, characterSpacing: 2 });

    // Mayor logo top right
    try {
      doc.image(LOGO_PATH, pageW - margin - 100, margin - 10, { width: 90 });
    } catch(e) {}

    // Horizontal rule
    doc.moveTo(margin, margin + 28).lineTo(pageW - margin, margin + 28).lineWidth(0.75).stroke();

    // ── BODY ──
    const bodyY = margin + 40;
    const leftW = contentW * 0.37;
    const rightX = margin + leftW + 16;
    const rightW = contentW - leftW - 16;

    // LEFT COLUMN
    let ly = bodyY;
    doc.fontSize(10).font('Times-Bold').text('Order Number', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + order_number);
    ly += 16;
    doc.font('Times-Bold').text('Club', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + club);
    ly += 20;
    doc.font('Times-Bold').text('Shipping / Billing Address:', margin, ly);
    ly += 14;
    const addrLines = address.split(',').map(s => s.trim());
    addrLines.forEach(line => {
      doc.font('Times-Roman').fontSize(9.5).text(line, margin, ly, { width: leftW });
      ly += 13;
    });
    ly += 6;
    doc.fontSize(10).font('Times-Bold').text('Ship Date', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + ship_date);
    ly += 20;
    doc.font('Times-Bold').text('Payment Terms:', margin, ly);
    ly += 13;
    const terms = 'Due on receipt. Based on our custom model, garments are produced specially for each club. Once clubs approve their order, they are responsible for payment of its full value. There are no returns or exchanges. All sales are final. Here is our W-9.';
    doc.fontSize(9).font('Times-Roman').text(terms, margin, ly, { width: leftW, lineGap: 1.5 });
    ly += doc.heightOfString(terms, { width: leftW }) + 12;
    doc.fontSize(10).font('Times-Bold').text('Payment Link:', margin, ly);
    ly += 14;
    doc.fontSize(9.5).font('Times-Roman')
       .fillColor('black').text('Click Here', margin, ly, {
         link: payment_link || '#',
         underline: true,
         width: leftW
       });

    // RIGHT COLUMN — TABLE
    let ry = bodyY;
    const colW = { product: 80, desc: rightW - 80 - 48 - 44 - 50, qty: 48, price: 44, amount: 50 };
    const colX = {
      product: rightX,
      desc: rightX + colW.product,
      qty: rightX + colW.product + colW.desc,
      price: rightX + colW.product + colW.desc + colW.qty,
      amount: rightX + colW.product + colW.desc + colW.qty + colW.price
    };

    // Table header
    doc.rect(rightX, ry, rightW, 18).fill('#1a1a18');
    doc.fillColor('white').fontSize(9).font('Times-Bold');
    doc.text('Product', colX.product + 3, ry + 5);
    doc.text('Description', colX.desc + 3, ry + 5);
    doc.text('Quantity', colX.qty, ry + 5, { width: colW.qty, align: 'right' });
    doc.text('Price', colX.price, ry + 5, { width: colW.price, align: 'right' });
    doc.text('Amount', colX.amount, ry + 5, { width: colW.amount, align: 'right' });
    doc.fillColor('#1a1a18');
    ry += 18;

    // Line items
    line_items.forEach((item, i) => {
      const descLines = (item.description || '').split('\n');
      const descHeight = descLines.length * 12 + 8;
      const rowH = Math.max(descHeight, 30);

      if (i % 2 === 1) doc.rect(rightX, ry, rightW, rowH).fill('#fafaf9');
      doc.rect(rightX, ry, rightW, rowH).stroke('#dddddd');

      doc.fillColor('#1a1a18').fontSize(9).font('Times-Roman');
      doc.text(item.product || '', colX.product + 3, ry + 6, {
        width: colW.product - 6,
        underline: true,
        link: item.url || '#'
      });
      descLines.forEach((line, j) => {
        doc.text(line, colX.desc + 3, ry + 6 + j * 12, { width: colW.desc - 6 });
      });
      doc.text(String(item.quantity || ''), colX.qty, ry + 6, { width: colW.qty, align: 'right' });
      doc.text(item.price ? '$' + Number(item.price).toFixed(2) : '', colX.price, ry + 6, { width: colW.price, align: 'right' });
      doc.text(item.amount ? '$' + Number(item.amount).toFixed(2) : '', colX.amount, ry + 6, { width: colW.amount, align: 'right' });
      ry += rowH;
    });

    // Subtotal row
    const qty_total = line_items.reduce((s, i) => s + (i.quantity || 0), 0);
    doc.rect(rightX, ry, rightW, 18).stroke('#dddddd');
    doc.fontSize(9).font('Times-Bold');
    doc.text('Subtotal', colX.qty - 40, ry + 5, { width: 40 + colW.qty, align: 'right' });
    doc.font('Times-Roman').text(String(qty_total), colX.qty, ry + 5, { width: colW.qty, align: 'right' });
    doc.text('$' + Number(subtotal).toFixed(2), colX.amount, ry + 5, { width: colW.amount, align: 'right' });
    ry += 18;

    // Embroidery (struck through)
    if (embroidery) {
      doc.rect(rightX, ry, rightW, 16).stroke('#dddddd');
      doc.fontSize(9).font('Times-Bold').text('Embroidery', colX.price - 40, ry + 4, { width: 40 + colW.price, align: 'right' });
      const strikeX = colX.amount;
      const strikeText = '$' + Number(embroidery).toFixed(2);
      doc.font('Times-Roman').text(strikeText, strikeX, ry + 4, { width: colW.amount, align: 'right' });
      const tw = doc.widthOfString(strikeText);
      const tx = colX.amount + colW.amount - tw;
      doc.moveTo(tx, ry + 10).lineTo(tx + tw, ry + 10).lineWidth(0.75).stroke();
      ry += 16;
    }

    // Art Setup (struck through)
    if (art_setup) {
      doc.rect(rightX, ry, rightW, 16).stroke('#dddddd');
      doc.fontSize(9).font('Times-Bold').text('Art Setup', colX.price - 40, ry + 4, { width: 40 + colW.price, align: 'right' });
      const strikeX = colX.amount;
      const strikeText = '$' + Number(art_setup).toFixed(2);
      doc.font('Times-Roman').text(strikeText, strikeX, ry + 4, { width: colW.amount, align: 'right' });
      const tw = doc.widthOfString(strikeText);
      const tx = colX.amount + colW.amount - tw;
      doc.moveTo(tx, ry + 10).lineTo(tx + tw, ry + 10).lineWidth(0.75).stroke();
      ry += 16;
    }

    // Shipping
    doc.rect(rightX, ry, rightW, 16).stroke('#dddddd');
    doc.fontSize(9).font('Times-Bold').text('Shipping', colX.price - 40, ry + 4, { width: 40 + colW.price, align: 'right' });
    doc.font('Times-Roman').text('$' + Number(shipping).toFixed(0), colX.amount, ry + 4, { width: colW.amount, align: 'right' });
    ry += 16;

    // Total
    doc.rect(rightX, ry, rightW, 18).stroke('#dddddd');
    doc.fontSize(9.5).font('Times-Bold').text('Total', colX.price - 40, ry + 5, { width: 40 + colW.price, align: 'right' });
    doc.text('$' + Number(total).toFixed(2), colX.amount, ry + 5, { width: colW.amount, align: 'right' });

    // ── FOOTER ──
    doc.moveTo(margin, pageH - 40).lineTo(pageW - margin, pageH - 40).lineWidth(0.75).stroke();
    doc.fontSize(7.5).font('Times-Bold')
       .text('Mayor | 870 Inman Village Parkway NE, Suite 533, Atlanta, GA 30307 | 339-206-2111 | mayor@mayorclothing.com',
             margin, pageH - 30, { align: 'center', width: contentW, characterSpacing: 0.5 });

    doc.end();
  } catch(e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mayor invoice server running on port', PORT));
