const express = require('express');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const { google } = require('googleapis');
const cookieParser = require('cookie-parser');
const path = require('path');
const { router: portalRouter, getOrdersFromSheet } = require('./portal');
const app = express();

app.use(cookieParser());
app.use('/portal', portalRouter);
app.get('/mayor-logo.png', (req, res) => res.sendFile(path.join(__dirname, 'Mayor_Logo_transparent.png')));
app.get('/orders', (req, res) => res.sendFile(path.join(__dirname, 'portal.html')));

// Google Sheets setup
const SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
const SHEET_CREDS = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');

async function appendOrderToSheet(data) {
  try {
    if (!SHEET_CREDS.client_email) return; // skip if no creds configured
    const auth = new google.auth.GoogleAuth({
      credentials: SHEET_CREDS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    // Check for duplicates before writing to Order Info
    const existingRows = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Order Info!A:A',
    });
    const existingOrders = (existingRows.data.values || []).map(r => r[0]);
    if (!existingOrders.includes(data.order_number)) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Order Info!A:H',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            data.order_number || '',
            data.customer_email || '',
            data.club || '',
            data.ship_date || '',
            'Pending',
            '', '', '',
          ]]
        }
      });
    }

    // Write full invoice data to Invoices sheet
    const items = data.line_items || [];
    const get = (i, key) => items[i] ? (items[i][key] || '') : '';
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Invoices!A:AK',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          data.order_number || '',
          data.customer_email || '',
          data.club || '',
          data.address || '',
          data.ship_date || '',
          data.payment_link || '',
          get(0,'url'), get(0,'description'), get(0,'quantity'), get(0,'price'), get(0,'orig_price') || '',
          get(1,'url'), get(1,'description'), get(1,'quantity'), get(1,'price'), get(1,'orig_price') || '',
          get(2,'url'), get(2,'description'), get(2,'quantity'), get(2,'price'), get(2,'orig_price') || '',
          data.shipping || '', data.subtotal || '', data.embroidery || '', data.art_setup || '', data.total || '',
          get(3,'url'), get(3,'description'), get(3,'quantity'), get(3,'price'), get(3,'orig_price') || '',
          get(4,'url'), get(4,'description'), get(4,'quantity'), get(4,'price'), get(4,'orig_price') || '',
        ]]
      }
    });

    console.log('Order logged to both sheets:', data.order_number);
  } catch(e) {
    console.error('Sheet write failed:', e.message);
  }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const LOGO_PATH = __dirname + '/Mayor_Logo_transparent.png';

app.post('/generate', (req, res) => {
  try {
    const data = req.body;
    const {
      order_number = '', club = '', address = '', ship_date = '',
      payment_link = '', w9_link = 'https://drive.google.com/file/d/1iZD_sP2WQbfPrXkHIcPqf7XawDMP2Zi1/view',
      line_items = [], subtotal = 0, embroidery, art_setup, strike_embroidery = true, strike_art = true,
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

    // Logo - no border, just image
    try {
      doc.image(LOGO_PATH, pageW - margin - 95, margin - 6, { width: 88 });
    } catch(e) {}

    // Horizontal rule
    doc.moveTo(margin, margin + 30).lineTo(pageW - margin, margin + 30).lineWidth(0.75).stroke('black');

    // ── LAYOUT ──
    const bodyY = margin + 42;
    const leftW = 205;   // wider left column so order number doesn't clip
    const rightX = margin + leftW + 16;
    const rightW = pageW - margin - rightX;

    // ── LEFT COLUMN ──
    let ly = bodyY;

    doc.fontSize(9.5).font('Times-Bold').text('Order Number', margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + order_number, { width: leftW });
    ly += doc.heightOfString('Order Number: ' + order_number, { width: leftW }) + 6;

    const isClub = /club/i.test(club);
    const clubLabel = isClub ? 'Club' : 'Client';
    doc.font('Times-Bold').text(clubLabel, margin, ly, { continued: true })
       .font('Times-Roman').text(': ' + club, { width: leftW });
    ly += doc.heightOfString('Club: ' + club, { width: leftW }) + 10;

    doc.font('Times-Bold').text('Shipping / Billing Address:', margin, ly, { width: leftW });
    ly += 13;

      // Split on newlines or commas; merge state/zip onto previous line
      // Split address on newlines only — launcher handles the formatting
      const addrLines = address.split(/\n/).map(s => s.trim()).filter(Boolean);
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

    const terms = isClub
      ? 'Due on receipt. Based on our custom model, garments are produced specially for each club. Once clubs approve their order, they are responsible for payment of its full value. There are no returns or exchanges. All sales are final. '
      : 'Due on receipt. Based on our custom model, garments are produced specially for each client. Once clients approve their order, they are responsible for payment of its full value. There are no returns or exchanges. All sales are final. ';
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

    const pW = 78;
    const qW = 44;
    const prW = 44;
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
    doc.text('Quantity',    cQ,       ry + 5, { width: qW,      align: 'right' });
    doc.text('Price',       cPr,      ry + 5, { width: prW,     align: 'right' });
    doc.text('Amount',      cA,       ry + 5, { width: aW - 2,  align: 'right' });
    doc.fillColor('#1a1a18');
    ry += hH;

    // Line items
    line_items.forEach((item, i) => {
      // Normalize description - replace \n with actual newlines, keep spaces intact
      const descText = (item.description || '').replace(/\\n/g, '\n').replace(/ \/ /g, '\n');
      const descH = doc.fontSize(8.5).heightOfString(descText, { width: dW - 8, lineGap: 1.5 });
      const hasDualPrice = item.orig_price && Number(item.orig_price) > 0;
      const rowH = Math.max(descH + 14, hasDualPrice ? 40 : 26);

      if (i % 2 === 1) {
        doc.rect(rightX, ry, rightW, rowH).fill('#f9f9f8').fillColor('#1a1a18');
      }
      doc.rect(rightX, ry, rightW, rowH).lineWidth(0.4).stroke('#cccccc');

      doc.fontSize(8.5).font('Times-Roman').fillColor('#1a1a18')
         .text(item.product || '', cP + 3, ry + 7, { width: pW - 6, underline: true, link: item.url || '#' });
      doc.text(descText, cD + 3, ry + 7, { width: dW - 6, lineGap: 1.5 });
      doc.text(String(item.quantity || ''), cQ,  ry + 7, { width: qW,     align: 'right' });
      // Price column: show orig_price struck through above actual price (stacked)
      if (item.orig_price && Number(item.orig_price) > 0) {
        const origText = '$' + Number(item.orig_price).toFixed(2);
        const actText  = '$' + Number(item.price).toFixed(2);
        // Draw original price
        doc.text(origText, cPr, ry + 5, { width: prW, align: 'right' });
        const origW = doc.widthOfString(origText);
        const origX = cPr + prW - origW;
        // Strikethrough at true midpoint of font (8.5pt ~= 6px cap height, mid at ~8px from top of text)
        const midY = ry + 5 + 8.5 * 0.35;
        doc.moveTo(origX, midY).lineTo(origX + origW, midY).lineWidth(0.8).stroke('#1a1a18');
        // Draw actual price below
        doc.text(actText, cPr, ry + 18, { width: prW, align: 'right' });
      } else {
        doc.text(item.price ? '$' + Number(item.price).toFixed(2) : '', cPr, ry + 7, { width: prW, align: 'right' });
      }
      // Amount column: if orig_price exists, show struck-through orig amount above actual amount
      if (item.orig_price && Number(item.orig_price) > 0) {
        const origAmt = '$' + (Number(item.orig_price) * Number(item.quantity)).toFixed(2);
        const actAmt  = '$' + Number(item.amount).toFixed(2);
        doc.text(origAmt, cA, ry + 5, { width: aW - 2, align: 'right' });
        const origAmtW = doc.widthOfString(origAmt);
        const origAmtX = cA + aW - 2 - origAmtW;
        const midY = ry + 5 + 8.5 * 0.35;
        doc.moveTo(origAmtX, midY).lineTo(origAmtX + origAmtW, midY).lineWidth(0.8).stroke('#1a1a18');
        doc.text(actAmt, cA, ry + 18, { width: aW - 2, align: 'right' });
      } else {
        const amtText = item.amount ? '$' + Number(item.amount).toFixed(2) : (Number(item.price) === 0 ? '$0.00' : '');
        doc.text(amtText, cA, ry + 7, { width: aW - 2, align: 'right' });
        // Strike through if price is $0
        if (Number(item.price) === 0 && amtText) {
          const tw = doc.widthOfString(amtText);
          const tx = cA + aW - 2 - tw;
          const zMid = ry + 7 + 8.5 * 0.35;
          doc.moveTo(tx, zMid).lineTo(tx + tw, zMid).lineWidth(0.8).stroke('#1a1a18');
        }
        if (Number(item.price) === 0) {
          const prText = '$0.00';
          const ptw = doc.widthOfString(prText);
          const ptx = cPr + prW - ptw;
          const zMid = ry + 7 + 8.5 * 0.35;
          doc.moveTo(ptx, zMid).lineTo(ptx + ptw, zMid).lineWidth(0.8).stroke('#1a1a18');
        }
      }

      ry += rowH;
    });

    // Helper: draw a bottom row with optional strikethrough centered on text
    const drawRow = (label, value, strike = false) => {
      const rH = 17;
      doc.rect(rightX, ry, rightW, rH).lineWidth(0.4).stroke('#cccccc');
      doc.fontSize(8.5).font('Times-Bold').fillColor('#1a1a18')
         .text(label, cPr - 55, ry + 5, { width: 55 + prW, align: 'right' });
      doc.font('Times-Roman').text(value, cA, ry + 5, { width: aW - 2, align: 'right' });
      if (strike) {
        const tw = doc.widthOfString(value);
        const tx = cA + aW - 2 - tw;
        const midY = ry + rH / 2;  // true vertical center of row
        doc.moveTo(tx, midY).lineTo(tx + tw, midY).lineWidth(0.8).stroke('#1a1a18');
      }
      ry += rH;
    };

    // Subtotal row — qty total on left side of subtotal label
    const qtyTotal = line_items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    doc.rect(rightX, ry, rightW, 17).lineWidth(0.4).stroke('#cccccc');
    doc.fontSize(8.5).font('Times-Bold').fillColor('#1a1a18')
       // "Subtotal" label moved left to sit under Description col
       .text('Subtotal', cD, ry + 5, { width: dW, align: 'right' });
    doc.font('Times-Roman')
       .text(String(qtyTotal), cQ, ry + 5, { width: qW, align: 'right' })
       .text('$' + Number(subtotal).toFixed(2), cA, ry + 5, { width: aW - 2, align: 'right' });
    ry += 17;

    if (embroidery) drawRow('Embroidery', '$' + Number(embroidery).toFixed(2), strike_embroidery);
    if (art_setup)  drawRow('Art Setup',  '$' + Number(art_setup).toFixed(2),  strike_art);
    drawRow('Shipping', '$' + Number(shipping).toFixed(0));

    // Total
    const totH = 18;
    doc.rect(rightX, ry, rightW, totH).lineWidth(0.4).stroke('#cccccc');
    doc.fontSize(9).font('Times-Bold').fillColor('#1a1a18')
       .text('Total', cPr - 55, ry + 5, { width: 55 + prW, align: 'right' })
       .text('$' + Number(total).toFixed(2), cA, ry + 5, { width: aW - 2, align: 'right' });

    // ── FOOTER ──
    doc.moveTo(margin, pageH - 38).lineTo(pageW - margin, pageH - 38).lineWidth(0.75).stroke();
    doc.fontSize(7).font('Times-Bold').fillColor('#1a1a18')
       .text('Mayor | 870 Inman Village Parkway NE, Suite 533, Atlanta, GA 30307 | 339-206-2111 | mayor@mayorclothing.com',
             margin, pageH - 27, { align: 'center', width: contentW, characterSpacing: 0.5 });

    doc.end();

    // Log order to Google Sheet and send setup email for new customers (non-blocking)
    if (!data.skip_logging) appendOrderToSheet(data).then(async () => {
      try {
        // Setup email removed — sent manually
      } catch(e) {
        console.error('Setup email error:', e.message);
      }
    });

  } catch(e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mayor invoice server running on port', PORT));
