// portal.js — Mayor customer portal routes
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const path = require('path');
const { trackPackage } = require('./ups');
const router = express.Router();
router.use(express.json());
const escHtml = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// Neutralize spreadsheet formula injection on any user value we write.
function sheetSafe(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

// Order numbers are the lookup key everywhere below. A stray leading/trailing space
// on one sheet row (e.g. a copy-paste error) makes it fail every === comparison
// silently instead of erroring — normalize on every read/compare so that class of
// bug can't hide a duplicate/orphaned row again.
function normalizeOrderNumber(v) {
  return String(v || '').trim().replace(/\s+/g, ' ');
}

// Minimal in-memory rate limiter (per client IP + route). Fail-open on restart is fine.
const _rlBuckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip || 'x'}:${req.path}`;
    const now = Date.now();
    const rec = _rlBuckets.get(key);
    if (!rec || now > rec.reset) { _rlBuckets.set(key, { count: 1, reset: now + windowMs }); return next(); }
    if (++rec.count > max) return res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.' });
    next();
  };
}

const SHEET_ID = process.env.MO_SHEET_ID || '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
// JWT_SECRET must be set in the environment. The fallback exists only for local dev;
// if it is ever used while NODE_ENV=production, log a loud warning so it gets caught.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Refusing to start the portal with an insecure default — set JWT_SECRET in the environment.');
}
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BASE_URL = process.env.BASE_URL || 'https://orders.mayorclothing.com';

// Admin users see EVERY order (Matt's all-orders view), not just their own.
// Admin = email listed in PORTAL_ADMIN_EMAILS, or a Users-row whose club is "ADMIN".
const ADMIN_EMAILS = (process.env.PORTAL_ADMIN_EMAILS || 'mayor@mayorclothing.com')
  .toLowerCase().split(/[,;]+/).map((sV) => sV.trim()).filter(Boolean);
function isAdminUser(user) {
  if (!user) return false;
  if (ADMIN_EMAILS.includes(String(user.email || '').toLowerCase())) return true;
  if (String(user.club || '').trim().toLowerCase() === 'admin') return true;
  return false;
}

// ── GOOGLE SHEETS ──
async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Order Info column D can contain multiple emails separated by commas/semicolons —
// each registered customer should see the order if their email is anywhere in that list.
function emailInList(cellValue, email) {
  if (!cellValue) return false;
  return cellValue.toLowerCase().split(/[,;]+/).map(s => s.trim()).includes(email.toLowerCase());
}

async function getOrdersFromSheet(email) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Info!A:H',
  });
  const rows = res.data.values || [];
  return rows.slice(1)
    .filter(r => emailInList(r[3], email))
    .map(r => ({
      order_number:    normalizeOrderNumber(r[0]),
      club:            r[1] || '',
      ship_date:       r[2] || '',
      email:           r[3] || '',
      status:          r[4] || 'Awaiting Approval',
      tracking_number: r[5] || '',
      date_delivered:  r[6] || '',
    }));
}

// Every order in the sheet — used for the admin (all-orders) view. Also flags
// data-integrity issues an admin should know about: duplicate order numbers
// (see the "Oklahoma City Golf & Country Club I" incident), missing tracking
// on shipped orders, and missing customer email (blocks that order from ever
// showing up for a customer login).
async function getAllOrdersFromSheet() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Info!A:H',
  });
  const rows = res.data.values || [];
  const orders = rows.slice(1)
    .filter(r => r[0])
    .map(r => ({
      order_number:    normalizeOrderNumber(r[0]),
      club:            r[1] || '',
      ship_date:       r[2] || '',
      email:           r[3] || '',
      status:          r[4] || 'Awaiting Approval',
      tracking_number: r[5] || '',
      date_delivered:  r[6] || '',
    }));

  const counts = new Map();
  orders.forEach(o => counts.set(o.order_number, (counts.get(o.order_number) || 0) + 1));
  const shippedStatuses = ['shipped', 'delivered'];
  orders.forEach(o => {
    o.duplicate = counts.get(o.order_number) > 1;
    o.missing_tracking = shippedStatuses.includes(String(o.status).toLowerCase()) && !o.tracking_number;
    o.missing_email = !o.email;
  });
  return orders;
}

async function getUserFromSheet(email) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Users!A:C',
  });
  const rows = res.data.values || [];
  const row = rows.find(r => r[0] && r[0].toLowerCase() === email.toLowerCase());
  if (!row) return null;
  return { email: row[0], passwordHash: row[1], club: row[2] };
}

async function upsertUser(email, passwordHash, club) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Users!A:C',
  });
  const rows = res.data.values || [];
  const rowIdx = rows.findIndex(r => r[0] && r[0].toLowerCase() === email.toLowerCase());
  if (rowIdx === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Users!A:C',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[email, passwordHash, club].map(sheetSafe)] }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Users!A${rowIdx + 1}:C${rowIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[email, passwordHash, club].map(sheetSafe)] }
    });
  }
}

// Check if email has orders in Order Info, Order Confirmations, or Invoices
async function emailHasOrders(email) {
  const sheets = await getSheets();
  // Check Order Info first (fastest)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Info!A:D',
  });
  const rows = res.data.values || [];
  return rows.some(r => emailInList(r[3], email));
}

// Parse row data (columns A-BA) into structured invoice/confirmation object
// Parse a cell value that may be stored as "$1,776.00", "1776", "$NaN", etc.
function parseCurrency(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseSheetRow(row) {
  if (!row) return null;
  // Column mapping (0-indexed) — HubSpot-mirrored layout, 4 blocks (A..BA).
  // Block 1 — HubSpot single-value (A–I):
  //   0 A  order_number      1 B  club              2 C  address
  //   3 D  shipping_address  4 E  ship_date         5 F  payment_link
  //   6 G  payment_link_2    7 H  customer_email    8 I  product_page
  // Block 2 — line items, field-type grouped (J–AH):
  //   9–13  J–N   product_1..5 (item url)   14–18  O–S   description_1..5
  //  19–23  T–X   sizes_1..5                24–28  Y–AC  quantity_1..5
  //  29–33  AD–AH price_1..5
  // Block 3 — remaining HubSpot single-value (AI–AN):
  //  34 AI embroidery  35 AJ art_setup  36 AK sample_reimbursement
  //  37 AL custom_label 38 AM shipping  39 AN payment_terms
  // Block 4 — portal/computed-only (AO–BA):
  //  40 AO subtotal 41 AP total 42 AQ date_label
  //  43 AR strike_embroidery 44 AS strike_art 45 AT strike_shipping
  //  46–50 AU–AY orig_price_1..5  51 AZ in_hand_date  52 BA drive_pdf_link
  const PRODUCT_IDX = [9, 10, 11, 12, 13];
  const DESC_IDX    = [14, 15, 16, 17, 18];
  const SIZES_IDX   = [19, 20, 21, 22, 23];
  const QTY_IDX     = [24, 25, 26, 27, 28];
  const PRICE_IDX   = [29, 30, 31, 32, 33];
  const ORIG_IDX    = [46, 47, 48, 49, 50];
  const items = [];
  for (let i = 0; i < 5; i++) {
    const qty   = parseCurrency(row[QTY_IDX[i]]);
    const price = parseCurrency(row[PRICE_IDX[i]]);
    if (qty > 0) {
      items.push({
        product:    'Custom Print Polo',
        url:        row[PRODUCT_IDX[i]] || '',
        description: row[DESC_IDX[i]] || '',
        sizes:      row[SIZES_IDX[i]] || '',
        quantity:   qty,
        price:      price,
        orig_price: row[ORIG_IDX[i]] ? parseCurrency(row[ORIG_IDX[i]]) : null,
        amount:     qty * price
      });
    }
  }

  const artRaw = row[35] || null;
  const artNum = artRaw ? parseCurrency(artRaw) : null;

  return {
    order_number:      normalizeOrderNumber(row[0]),
    club:              row[1]  || '',
    address:           row[2]  || '',
    shipping_address:  row[3]  || '',
    ship_date:         row[4]  || '',
    payment_link:      row[5]  || '',
    payment_link_2:    row[6]  || '',
    customer_email:    row[7]  || '',
    product_page:      row[8]  || '',
    line_items:        items,
    embroidery:        parseCurrency(row[34]),
    art_setup:         artNum,
    sample_reimbursement: row[36] || null,
    custom_label:      row[37] ? parseCurrency(row[37]) : null,
    shipping:          parseCurrency(row[38]),
    payment_terms:     row[39] || '',
    subtotal:          parseCurrency(row[40]),
    total:             parseCurrency(row[41]),
    date_label:        row[42] || 'Ship Date',
    strike_embroidery: row[43] !== undefined && row[43] !== '' ? row[43] === '1' : true,
    strike_art:        row[44] !== undefined && row[44] !== '' ? row[44] === '1' : true,
    strike_shipping:   row[45] !== undefined && row[45] !== '' ? row[45] === '1' : false,
    in_hand_date:      row[51] || '',
  };
}

// Get invoice data — checks Invoices first, then Order Confirmations
async function getOrderDetailData(order_number) {
  const sheets = await getSheets();

  // Try Invoices sheet first
  const invRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Invoices!A:BA',
  });
  const invRows = invRes.data.values || [];
  const target = normalizeOrderNumber(order_number);
  const invRow = invRows.find(r => r[0] && normalizeOrderNumber(r[0]) === target);
  if (invRow) return { ...parseSheetRow(invRow), source: 'invoice' };

  // Fall back to Order Confirmations
  const confRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Confirmations!A:BA',
  });
  const confRows = confRes.data.values || [];
  const confRow = confRows.find(r => r[0] && normalizeOrderNumber(r[0]) === target);
  if (confRow) return { ...parseSheetRow(confRow), source: 'confirmation' };

  return null;
}

// ── EMAIL ──
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) { console.log('No Resend key — skipping email to', to); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: 'Mayor Clothing <noreply@mayorclothing.com>', to, subject, html })
  });
  if (!res.ok) console.error('Resend error:', await res.text());
}

async function sendResetEmail(email, token) {
  const link = `${BASE_URL}/orders?action=reset-password&token=${token}`;
  await sendEmail(email, 'Reset your Mayor portal password',
    `<p>Click the link below to reset your password. This link expires in 1 hour.</p>
     <p><a href="${link}" style="background:#1a1a18;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset password</a></p>
     <p style="color:#888;font-size:12px;">If you didn't request this, ignore this email.</p>
     <p>— Mayor Clothing</p>`
  );
}

async function sendReorderEmail(data) {
  await sendEmail('mayor@mayorclothing.com', `Reorder Request — ${data.club}`,
    `<p><strong>Club:</strong> ${escHtml(data.club)}</p>
     <p><strong>Original order:</strong> ${escHtml(data.order_number)}</p>
     <p><strong>Contact:</strong> ${escHtml(data.email)}</p>
     <p><strong>Notes:</strong></p>
     <p style="white-space:pre-wrap;">${escHtml(data.notes || 'No notes provided')}</p>`
  );
}

// ── AUTH MIDDLEWARE ──
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.mayor_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}

// ── ROUTES ──

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal.html'));
});

router.post('/login', rateLimit(10, 60000), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await getUserFromSheet(email);
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const admin = isAdminUser(user);
    const token = jwt.sign({ email: user.email, club: user.club, admin }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('mayor_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7*24*60*60*1000 });
    res.json({ email: user.email, club: user.club, admin });
  } catch(e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('mayor_token');
  res.json({ ok: true });
});

router.post('/forgot-password', rateLimit(5, 60000), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await getUserFromSheet(email);
    if (user) {
      const token = jwt.sign({ email, action: 'reset' }, JWT_SECRET, { expiresIn: '1h' });
      await sendResetEmail(email, token);
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('Forgot password error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/set-password', rateLimit(10, 60000), async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.action !== 'reset') return res.status(400).json({ error: 'Invalid or expired link' });
    const hash = await bcrypt.hash(password, 10);
    const orders = await getOrdersFromSheet(payload.email);
    const club = orders.length ? orders[0].club : '';
    await upsertUser(payload.email, hash, club);
    res.json({ ok: true });
  } catch(e) {
    console.error('Set password error:', e);
    res.status(400).json({ error: 'Invalid or expired link' });
  }
});

// Create account — allowed if email has any order in Order Info
router.post('/create-account', rateLimit(5, 60000), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hasOrders = await emailHasOrders(email);
    const existing = await getUserFromSheet(email);
    if (!hasOrders || (existing && existing.passwordHash)) {
      return res.status(400).json({ error: 'We couldn\u2019t create an account with those details. If you already have one, use Forgot password; otherwise contact Mayor Clothing.' });
    }
    const orders = await getOrdersFromSheet(email);
    const hash = await bcrypt.hash(password, 10);
    await upsertUser(email, hash, orders[0]?.club || '');
    res.json({ ok: true });
  } catch(e) {
    console.error('Create account error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get orders list
router.get('/orders', requireAuth, async (req, res) => {
  try {
    const orders = req.user.admin ? await getAllOrdersFromSheet() : await getOrdersFromSheet(req.user.email);
    res.json({ orders, admin: !!req.user.admin });
  } catch(e) {
    console.error('Orders error:', e);
    res.status(500).json({ error: 'Could not load orders' });
  }
});

// Get full order detail (confirmation or invoice data)
router.get('/order-detail/:order_number', requireAuth, async (req, res) => {
  try {
    if (!req.user.admin) {
      const orders = await getOrdersFromSheet(req.user.email);
      if (!orders.find(o => o.order_number === normalizeOrderNumber(req.params.order_number))) return res.status(403).json({ error: 'Not authorized' });
    }
    const detail = await getOrderDetailData(req.params.order_number);
    if (!detail) return res.status(404).json({ error: 'Order details not available yet' });
    res.json(detail);
  } catch(e) {
    console.error('Order detail error:', e);
    res.status(500).json({ error: 'Could not load order details' });
  }
});

// Live UPS tracking status for an order's package
router.get('/tracking/:order_number', requireAuth, async (req, res) => {
  try {
    const orders = req.user.admin ? await getAllOrdersFromSheet() : await getOrdersFromSheet(req.user.email);
    const order = orders.find(o => o.order_number === normalizeOrderNumber(req.params.order_number));
    if (!order) return res.status(403).json({ error: 'Not authorized' });
    if (!order.tracking_number) return res.status(404).json({ error: 'No tracking number yet' });

    const info = await trackPackage(order.tracking_number);
    if (!info) return res.status(404).json({ error: 'No tracking data yet' });
    res.json(info);
  } catch (e) {
    console.error('UPS tracking error:', e);
    res.status(502).json({ error: 'Could not reach UPS' });
  }
});

// Download order confirmation PDF
router.get('/confirmation/:order_number', requireAuth, async (req, res) => {
  try {
    if (!req.user.admin) {
      const orders = await getOrdersFromSheet(req.user.email);
      if (!orders.find(o => o.order_number === normalizeOrderNumber(req.params.order_number))) return res.status(403).json({ error: 'Not authorized' });
    }

    const sheets = await getSheets();
    const confRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      // Full range through BA — parseSheetRow reads Block 3/4 fields (embroidery,
      // payment_terms, sizes, orig_price, in_hand_date, drive_pdf_link, etc.) from
      // columns AI onward; a narrower range silently dropped them from the PDF.
      range: 'Order Confirmations!A:BA',
    });
    const confRow = (confRes.data.values || []).find(r => r[0] && normalizeOrderNumber(r[0]) === normalizeOrderNumber(req.params.order_number));
    if (!confRow) return res.status(404).json({ error: 'Order confirmation not available.' });

    const confData = parseSheetRow(confRow);
    const generateRes = await fetch('https://mayor-invoice.onrender.com/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...confData, type: 'confirmation', skip_logging: true })
    });
    if (!generateRes.ok) throw new Error('PDF generation failed: ' + await generateRes.text());
    const buffer = Buffer.from(await generateRes.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Mayor-Order-Confirmation-${req.params.order_number}.pdf"`);
    res.send(buffer);
  } catch(e) {
    console.error('Confirmation download error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Download invoice PDF — only works if invoice exists
router.get('/invoice/:order_number', requireAuth, async (req, res) => {
  try {
    if (!req.user.admin) {
      const orders = await getOrdersFromSheet(req.user.email);
      if (!orders.find(o => o.order_number === req.params.order_number)) return res.status(403).json({ error: 'Not authorized' });
    }

    // Only generate PDF from Invoices sheet (not confirmations)
    const sheets = await getSheets();
    const invRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Invoices!A:BA', // see comment on the Order Confirmations read above
    });
    const invRow = (invRes.data.values || []).find(r => r[0] && normalizeOrderNumber(r[0]) === normalizeOrderNumber(req.params.order_number));
    if (!invRow) return res.status(404).json({ error: 'Invoice not available yet. Your order confirmation is still being reviewed.' });

    const invoiceData = parseSheetRow(invRow);
    const generateRes = await fetch('https://mayor-invoice.onrender.com/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...invoiceData, skip_logging: true })
    });
    if (!generateRes.ok) throw new Error('PDF generation failed: ' + await generateRes.text());
    const buffer = Buffer.from(await generateRes.arrayBuffer());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Mayor-Invoice-${req.params.order_number}.pdf"`);
    res.send(buffer);
  } catch(e) {
    console.error('Invoice download error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Reorder
router.post('/reorder', requireAuth, async (req, res) => {
  try {
    const { order_number, club, notes } = req.body;
    await sendReorderEmail({ email: req.user.email, order_number, club, notes });
    res.json({ ok: true });
  } catch(e) {
    console.error('Reorder error:', e);
    res.status(500).json({ error: 'Could not submit reorder' });
  }
});

module.exports = { router, getOrdersFromSheet };
