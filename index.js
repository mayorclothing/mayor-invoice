const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { renderInvoicePdf } = require('./doc-render');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { router: portalRouter, getOrdersFromSheet } = require('./portal');
const app = express();
app.set('trust proxy', 1);

// Restrict cross-origin requests to Mayor's own front-ends. The invoice generator
// (GitHub Pages) and the orders portal POST here from the browser; everything else
// is blocked. Add new front-end origins to this list if they're introduced.
const ALLOWED_ORIGINS = [
  'https://mayorclothing.github.io',
  'https://orders.mayorclothing.com',
  'https://mayor-invoice.onrender.com',
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / non-browser requests (no Origin header) and allowlisted origins.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use('/portal', portalRouter);
app.get('/', (req, res) => res.redirect('/orders'));
app.get('/mayor-logo.png', (req, res) => res.sendFile(path.join(__dirname, 'Mayor_Logo_transparent.png')));
app.get('/auth-bg-1.png', (req, res) => res.sendFile(path.join(__dirname, 'auth-bg-1.png')));
app.get('/auth-bg-2.png', (req, res) => res.sendFile(path.join(__dirname, 'auth-bg-2.png')));
app.get('/auth-bg-3.png', (req, res) => res.sendFile(path.join(__dirname, 'auth-bg-3.png')));

// Per-order print swatch, used as the order-detail page background when one exists.
// Filename = the order number exactly (path.basename strips any traversal attempt),
// tried against a fixed extension list rather than trusting a client-supplied one.
const SWATCH_DIR = path.join(__dirname, 'swatches');
const SWATCH_EXTENSIONS = ['.png', '.jpg', '.jpeg'];
app.get('/swatches/:orderNumber', (req, res) => {
  const base = path.basename(req.params.orderNumber).replace(/\.[^.]+$/, '');
  for (const ext of SWATCH_EXTENSIONS) {
    const file = path.join(SWATCH_DIR, base + ext);
    if (fs.existsSync(file)) return res.sendFile(file);
  }
  res.status(404).end();
});
app.get('/orders', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'portal.html'));
});

const SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
const SHEET_CREDS = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
const LOGO_PATH = __dirname + '/Mayor_Logo_transparent.png';

// ---- /generate hardening (this endpoint is browser-reachable and writes to the sheet) ----
function sheetSafe(v) { if (typeof v !== 'string') return v; return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; }
// See matching comment in portal.js — order numbers are the lookup key for every
// sheet write below; normalize so a stray space can't create a duplicate row.
function normalizeOrderNumber(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
// Payment links must be on a trusted host (blocks payment-link fraud). Extend as needed.
const TRUSTED_PAYMENT_HOSTS = (process.env.TRUSTED_PAYMENT_HOSTS || 'nickelpayments.com,mayorclothing.com')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
function trustedPaymentLink(u) {
  try { const url = new URL(String(u)); if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    return TRUSTED_PAYMENT_HOSTS.some((h) => host === h || host.endsWith('.' + h)) ? url.toString() : '';
  } catch (e) { return ''; }
}
function httpsUrlOrEmpty(u) { try { const url = new URL(String(u)); return url.protocol === 'https:' ? url.toString() : ''; } catch (e) { return ''; } }
function sanitizeGeneratePayload(data) {
  const d = { ...(data || {}) };
  d.payment_link = trustedPaymentLink(d.payment_link);
  d.payment_link_2 = trustedPaymentLink(d.payment_link_2);
  d.product_page = httpsUrlOrEmpty(d.product_page);
  d.line_items = (Array.isArray(d.line_items) ? d.line_items : []).slice(0, 10).map((it) => ({ ...(it || {}), url: httpsUrlOrEmpty(it && it.url) }));
  return d;
}

// Ensure a customer's email exists in the Users sheet (A=email, B=passwordHash, C=club)
// so they're pre-registered and can later log in / set a password via the portal.
async function upsertUserEmail(sheets, email, club) {
  if (!email) return;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Users!A:C' });
    const rows = res.data.values || [];
    const idx = rows.findIndex(r => r[0] && r[0].toLowerCase() === email.toLowerCase());
    if (idx === -1) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: 'Users!A:C', valueInputOption: 'USER_ENTERED',
        resource: { values: [[email, '', club || ''].map(v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v))] }
      });
      console.log('Customer email added to Users sheet:', email);
    } else if (!rows[idx][2] && club) {
      // Existing user row but missing club — fill it in
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `Users!C${idx + 1}`, valueInputOption: 'USER_ENTERED',
        resource: { values: [[club]] }
      });
    }
  } catch(e) {
    console.error('upsertUserEmail failed:', e.message);
  }
}

async function appendOrderToSheet(data) {
  try {
    if (!SHEET_CREDS.client_email) return;
    const auth = new google.auth.GoogleAuth({
      credentials: SHEET_CREDS,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const isConfirmation = data.type === 'confirmation';

    const items = data.line_items || [];
    const get = (i, key) => items[i] ? (items[i][key] || '') : '';
    const rowData = [
      data.order_number || '', data.customer_email || '', data.club || '',
      data.address || '', data.ship_date || '', data.payment_link || '',
      get(0,'url'), get(0,'description'), get(0,'quantity'), get(0,'price'), get(0,'orig_price') || '',
      get(1,'url'), get(1,'description'), get(1,'quantity'), get(1,'price'), get(1,'orig_price') || '',
      get(2,'url'), get(2,'description'), get(2,'quantity'), get(2,'price'), get(2,'orig_price') || '',
      data.shipping || '', data.subtotal || '', data.embroidery || '', (data.art_setup != null ? parseFloat(String(data.art_setup).replace(/[$,\s]/g,'')) || '' : ''), data.total || '',
      get(3,'url'), get(3,'description'), get(3,'quantity'), get(3,'price'), get(3,'orig_price') || '',
      get(4,'url'), get(4,'description'), get(4,'quantity'), get(4,'price'), get(4,'orig_price') || '',
      data.product_page || '',
      // AL=37 onward — new fields
      data.shipping_address || '',
      data.date_label || 'Ship Date',
      data.payment_link_2 || '',
      data.payment_terms || '',
      data.strike_embroidery ? '1' : '',
      data.strike_art ? '1' : '',
      data.strike_shipping ? '1' : '',
      data.custom_label || '',
      data.sample_reimbursement || '',
      '', // AU=46 (unused)
      data.in_hand_date || '', // AV=47
    ];

    // Helper: find next empty row in column A (after header), then write rowData there
    async function writeToSheet(tabName, orderNumber, rowData) {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tabName}!A:A` });
      const col = res.data.values || [];
      // Check if order already exists (skip row 0 which is header)
      const existingIdx = col.findIndex((r, i) => i > 0 && normalizeOrderNumber(r[0]) === normalizeOrderNumber(orderNumber));
      let targetRow;
      if (existingIdx > 0) {
        targetRow = existingIdx + 1; // 1-based
        console.log(`${tabName} updating row ${targetRow} for:`, orderNumber);
      } else {
        // Find first row where column A is empty (after header row 1)
        let firstEmpty = col.length + 1; // default: one past last row
        for (let i = 1; i < col.length; i++) {
          if (!col[i] || !col[i][0] || col[i][0].trim() === '') {
            firstEmpty = i + 1; // 1-based
            break;
          }
        }
        targetRow = firstEmpty;
        console.log(`${tabName} inserting row ${targetRow} for:`, orderNumber);
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [rowData.map(sheetSafe)] }
      });
      return targetRow;
    }

    if (isConfirmation) {
      // Write to Order Info if new order
      const existingRows = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Order Info!A:A' });
      const existingOrders = (existingRows.data.values || []).map(r => normalizeOrderNumber(r[0]));
      if (!existingOrders.includes(normalizeOrderNumber(data.order_number))) {
        await writeToSheet('Order Info',  data.order_number,
          [data.order_number || '', data.customer_email || '', data.club || '',
           data.ship_date || '', 'Awaiting Approval', '', '', ''].map(sheetSafe));
      }

      // Make sure each customer's email is registered in the Users sheet
      const emails = (data.customer_emails && data.customer_emails.length)
        ? data.customer_emails
        : (data.customer_email || '').split(/[\n;,]+/).map(e => e.trim()).filter(Boolean);
      for (const e of emails) {
        await upsertUserEmail(sheets, e, data.club);
      }

      await writeToSheet('Order Confirmations', data.order_number, rowData);

    } else {
      await writeToSheet('Invoices', data.order_number, rowData);

      // Update Order Info status to Awaiting Payment
      const orderRows = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: 'Order Info!A:A' });
      const orderData = orderRows.data.values || [];
      const orderIdx = orderData.findIndex((r, i) => i > 0 && normalizeOrderNumber(r[0]) === normalizeOrderNumber(data.order_number));
      if (orderIdx > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID, range: `Order Info!E${orderIdx + 1}`,
          valueInputOption: 'USER_ENTERED', resource: { values: [['Awaiting Payment']] }
        });
      }
      console.log('Invoice logged, status updated to Awaiting Payment:', data.order_number);
    }
  } catch(e) {
    console.error('Sheet write failed:', e.message);
  }
}

app.post('/generate', async (req, res) => {
  try {
    const data = sanitizeGeneratePayload(req.body);

    const pdf = await renderInvoicePdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="mayor-invoice.pdf"');
    res.send(pdf);

    // Log order to Google Sheet (non-blocking) — setup email sent manually
    if (!data.skip_logging) appendOrderToSheet(data);

  } catch(e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});


app.get('/health', (req, res) => res.json({ status: 'ok' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Mayor invoice server running on port', PORT));
