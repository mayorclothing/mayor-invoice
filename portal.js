// portal.js — Mayor customer portal routes
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const path = require('path');
const router = express.Router();
router.use(express.json());

const SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
// JWT_SECRET must be set in the environment. The fallback exists only for local dev;
// if it is ever used while NODE_ENV=production, log a loud warning so it gets caught.
const JWT_SECRET = process.env.JWT_SECRET || 'mayor-portal-secret-change-in-prod';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('SECURITY WARNING: JWT_SECRET is not set in production — sessions are signed with a public default. Set the JWT_SECRET env var on Render.');
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

// Order Info column B can contain multiple emails separated by commas/semicolons —
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
    .filter(r => emailInList(r[1], email))
    .map(r => ({
      order_number:    r[0] || '',
      email:           r[1] || '',
      club:            r[2] || '',
      ship_date:       r[3] || '',
      status:          r[4] || 'Awaiting Approval',
      tracking_number: r[5] || '',
      date_delivered:  r[6] || '',
    }));
}

// Every order in the sheet — used for the admin (all-orders) view.
async function getAllOrdersFromSheet() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Info!A:H',
  });
  const rows = res.data.values || [];
  return rows.slice(1)
    .filter(r => r[0])
    .map(r => ({
      order_number:    r[0] || '',
      email:           r[1] || '',
      club:            r[2] || '',
      ship_date:       r[3] || '',
      status:          r[4] || 'Awaiting Approval',
      tracking_number: r[5] || '',
      date_delivered:  r[6] || '',
    }));
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
      resource: { values: [[email, passwordHash, club]] }
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Users!A${rowIdx + 1}:C${rowIdx + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[email, passwordHash, club]] }
    });
  }
}

// Check if email has orders in Order Info, Order Confirmations, or Invoices
async function emailHasOrders(email) {
  const sheets = await getSheets();
  // Check Order Info first (fastest)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Info!A:B',
  });
  const rows = res.data.values || [];
  return rows.some(r => emailInList(r[1], email));
}

// Parse row data (columns A-AU) into structured invoice/confirmation object
// Parse a cell value that may be stored as "$1,776.00", "1776", "$NaN", etc.
function parseCurrency(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseSheetRow(row) {
  if (!row) return null;
  // Column mapping (0-indexed):
  // A=0 Order#, B=1 Email, C=2 Club, D=3 Address, E=4 ShipDate, F=5 PaymentLink
  // G=6 URL1, H=7 Desc1, I=8 Qty1, J=9 Price1, K=10 OrigPrice1
  // L=11 URL2, M=12 Desc2, N=13 Qty2, O=14 Price2, P=15 OrigPrice2
  // Q=16 URL3, R=17 Desc3, S=18 Qty3, T=19 Price3, U=20 OrigPrice3
  // V=21 Shipping, W=22 Subtotal, X=23 Embroidery, Y=24 ArtFee, Z=25 Total
  // AA=26 URL4, AB=27 Desc4, AC=28 Qty4, AD=29 Price4, AE=30 OrigPrice4
  // AF=31 URL5, AG=32 Desc5, AH=33 Qty5, AI=34 Price5, AJ=35 OrigPrice5
  // AK=36 ProductPage
  // AL=37 ShippingAddress, AM=38 DateLabel, AN=39 PaymentLink2
  // AO=40 PaymentTerms, AP=41 StrikeEmb, AQ=42 StrikeArt, AR=43 StrikeShip
  // AS=44 CustomLabel, AT=45 SampleReimbursement
  const itemOffsets = [
    [6,7,8,9,10], [11,12,13,14,15], [16,17,18,19,20],
    [26,27,28,29,30], [31,32,33,34,35]
  ];
  const items = [];
  itemOffsets.forEach(([ui, di, qi, pi, oi]) => {
    const qty   = parseCurrency(row[qi]);
    const price = parseCurrency(row[pi]);
    if (qty > 0) {
      items.push({
        product:    'Custom Print Polo',
        url:        row[ui] || '',
        description: row[di] || '',
        quantity:   qty,
        price:      price,
        orig_price: row[oi] ? parseCurrency(row[oi]) : null,
        amount:     qty * price
      });
    }
  });

  const artRaw = row[24] || null;
  const artNum = artRaw ? parseCurrency(artRaw) : null;

  return {
    order_number:      row[0]  || '',
    customer_email:    row[1]  || '',
    club:              row[2]  || '',
    address:           row[3]  || '',
    ship_date:         row[4]  || '',
    payment_link:      row[5]  || '',
    line_items:        items,
    shipping:          parseCurrency(row[21]),
    subtotal:          parseCurrency(row[22]),
    embroidery:        parseCurrency(row[23]),
    art_setup:         artNum,
    total:             parseCurrency(row[25]),
    product_page:      row[36] || '',
    shipping_address:  row[37] || '',
    date_label:        row[38] || 'Ship Date',
    payment_link_2:    row[39] || '',
    payment_terms:     row[40] || '',
    strike_embroidery: row[41] !== undefined && row[41] !== '' ? row[41] === '1' : true,
    strike_art:        row[42] !== undefined && row[42] !== '' ? row[42] === '1' : true,
    strike_shipping:   row[43] !== undefined && row[43] !== '' ? row[43] === '1' : false,
    custom_label:      row[44] ? parseCurrency(row[44]) : null,
    sample_reimbursement: row[45] || null,
  };
}

// Get invoice data — checks Invoices first, then Order Confirmations
async function getOrderDetailData(order_number) {
  const sheets = await getSheets();

  // Try Invoices sheet first
  const invRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Invoices!A:AU',
  });
  const invRows = invRes.data.values || [];
  const invRow = invRows.find(r => r[0] && r[0] === order_number);
  if (invRow) return { ...parseSheetRow(invRow), source: 'invoice' };

  // Fall back to Order Confirmations
  const confRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Confirmations!A:AU',
  });
  const confRows = confRes.data.values || [];
  const confRow = confRows.find(r => r[0] && r[0] === order_number);
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
    `<p><strong>Club:</strong> ${data.club}</p>
     <p><strong>Original order:</strong> ${data.order_number}</p>
     <p><strong>Contact:</strong> ${data.email}</p>
     <p><strong>Notes:</strong></p>
     <p style="white-space:pre-wrap;">${data.notes || 'No notes provided'}</p>`
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

router.post('/login', async (req, res) => {
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

router.post('/forgot-password', async (req, res) => {
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

router.post('/set-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const payload = jwt.verify(token, JWT_SECRET);
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
router.post('/create-account', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hasOrders = await emailHasOrders(email);
    if (!hasOrders) return res.status(403).json({ error: 'No orders found for this email. Please contact Mayor Clothing.' });
    const existing = await getUserFromSheet(email);
    if (existing && existing.passwordHash) return res.status(400).json({ error: 'An account already exists for this email. Use Forgot password to reset it.' });
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
      if (!orders.find(o => o.order_number === req.params.order_number)) return res.status(403).json({ error: 'Not authorized' });
    }
    const detail = await getOrderDetailData(req.params.order_number);
    if (!detail) return res.status(404).json({ error: 'Order details not available yet' });
    res.json(detail);
  } catch(e) {
    console.error('Order detail error:', e);
    res.status(500).json({ error: 'Could not load order details' });
  }
});

// Download order confirmation PDF
router.get('/confirmation/:order_number', requireAuth, async (req, res) => {
  try {
    if (!req.user.admin) {
      const orders = await getOrdersFromSheet(req.user.email);
      if (!orders.find(o => o.order_number === req.params.order_number)) return res.status(403).json({ error: 'Not authorized' });
    }

    const sheets = await getSheets();
    const confRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Order Confirmations!A:AK',
    });
    const confRow = (confRes.data.values || []).find(r => r[0] && r[0] === req.params.order_number);
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
      range: 'Invoices!A:AK',
    });
    const invRow = (invRes.data.values || []).find(r => r[0] && r[0] === req.params.order_number);
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
