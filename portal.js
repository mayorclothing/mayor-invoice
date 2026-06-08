// portal.js — Mayor customer portal routes
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const path = require('path');
const router = express.Router();
router.use(express.json());

const SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
const JWT_SECRET = process.env.JWT_SECRET || 'mayor-portal-secret-change-in-prod';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const BASE_URL = process.env.BASE_URL || 'https://mayor-invoice.onrender.com';

// ── GOOGLE SHEETS ──
async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getOrdersFromSheet(email) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Order Info!A:H',
  });
  const rows = res.data.values || [];
  return rows.slice(1)
    .filter(r => r[1] && r[1].toLowerCase() === email.toLowerCase())
    .map(r => ({
      order_number:    r[0] || '',
      email:           r[1] || '',
      club:            r[2] || '',
      ship_date:       r[3] || '',
      status:          r[4] || 'Pending',
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

async function getInvoiceData(order_number) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Invoices!A:AK',
  });
  const rows = res.data.values || [];
  const row = rows.find(r => r[0] && r[0] === order_number);
  if (!row) return null;

  // Column mapping (0-indexed):
  // A=0 Order#, B=1 Email, C=2 Club, D=3 Address, E=4 ShipDate, F=5 PaymentLink
  // G=6 URL1, H=7 Desc1, I=8 Qty1, J=9 Price1, K=10 OrigPrice1
  // L=11 URL2, M=12 Desc2, N=13 Qty2, O=14 Price2, P=15 OrigPrice2
  // Q=16 URL3, R=17 Desc3, S=18 Qty3, T=19 Price3, U=20 OrigPrice3
  // V=21 Shipping, W=22 Subtotal, X=23 Embroidery, Y=24 ArtFee, Z=25 Total
  // AA=26 URL4, AB=27 Desc4, AC=28 Qty4, AD=29 Price4, AE=30 OrigPrice4
  // AF=31 URL5, AG=32 Desc5, AH=33 Qty5, AI=34 Price5, AJ=35 OrigPrice5

  const itemOffsets = [
    [6,7,8,9,10], [11,12,13,14,15], [16,17,18,19,20],
    [26,27,28,29,30], [31,32,33,34,35]
  ];
  const items = [];
  itemOffsets.forEach(([ui, di, qi, pi, oi]) => {
    if (row[qi] && Number(row[qi]) > 0) {
      const qty   = Number(row[qi]) || 0;
      const price = Number(row[pi]) || 0;
      items.push({
        product:     'Custom Print Polo',
        url:         row[ui] || '',
        description: row[di] || '',
        quantity:    qty,
        price:       price,
        orig_price:  row[oi] ? Number(row[oi]) : null,
        amount:      qty * price
      });
    }
  });

  return {
    order_number:   row[0] || '',
    customer_email: row[1] || '',
    club:           row[2] || '',
    address:        row[3] || '',
    ship_date:      row[4] || '',
    payment_link:   row[5] || '',
    line_items:     items,
    shipping:       Number(row[21]) || 0,
    subtotal:       Number(row[22]) || 0,
    embroidery:     Number(row[23]) || null,
    art_setup:      Number(row[24]) || null,
    total:          Number(row[25]) || 0,
  };
}

// ── EMAIL via RESEND ──
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
  const sizeStr = data.sizes ? Object.entries(data.sizes).map(([k,v]) => `${v} ${k}`).join(', ') : data.qty;
  await sendEmail('mayor@mayorclothing.com', `Reorder Request — ${data.club}`,
    `<p><strong>Club:</strong> ${data.club}</p>
     <p><strong>Original order:</strong> ${data.order_number}</p>
     <p><strong>Print:</strong> ${data.print}</p>
     <p><strong>Colors:</strong> ${data.colors}</p>
     <p><strong>Total quantity:</strong> ${data.qty}</p>
     <p><strong>Size breakdown:</strong> ${sizeStr}</p>
     <p><strong>Notes:</strong> ${data.notes || 'None'}</p>
     <p><strong>Contact:</strong> ${data.email}</p>`
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
    const token = jwt.sign({ email: user.email, club: user.club }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('mayor_token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 7*24*60*60*1000 });
    res.json({ email: user.email, club: user.club });
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

router.post('/create-account', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const orders = await getOrdersFromSheet(email);
    if (!orders.length) return res.status(403).json({ error: 'No orders found for this email. Please contact Mayor Clothing.' });
    const existing = await getUserFromSheet(email);
    if (existing && existing.passwordHash) return res.status(400).json({ error: 'An account already exists for this email. Use Forgot password to reset it.' });
    const hash = await bcrypt.hash(password, 10);
    await upsertUser(email, hash, orders[0].club || '');
    res.json({ ok: true });
  } catch(e) {
    console.error('Create account error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/orders', requireAuth, async (req, res) => {
  try {
    const orders = await getOrdersFromSheet(req.user.email);
    res.json({ orders });
  } catch(e) {
    console.error('Orders error:', e);
    res.status(500).json({ error: 'Could not load orders' });
  }
});

router.get('/invoice/:order_number', requireAuth, async (req, res) => {
  try {
    const invoiceData = await getInvoiceData(req.params.order_number);
    if (!invoiceData) return res.status(404).json({ error: 'Invoice not available' });
    const orders = await getOrdersFromSheet(req.user.email);
    const owned = orders.find(o => o.order_number === req.params.order_number);
    if (!owned) return res.status(403).json({ error: 'Not authorized' });
    const generateRes = await fetch(`${BASE_URL}/generate`, {
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

router.post('/reorder', requireAuth, async (req, res) => {
  try {
    const { order_number, club, print, colors, qty, sizes, notes } = req.body;
    await sendReorderEmail({ email: req.user.email, order_number, club, print, colors, qty, sizes, notes });
    res.json({ ok: true });
  } catch(e) {
    console.error('Reorder error:', e);
    res.status(500).json({ error: 'Could not submit reorder' });
  }
});

// TEMP: remove after testing
router.get('/create-test-account', async (req, res) => {
  try {
    const email = req.query.email;
    const password = req.query.password;
    const club = req.query.club || 'Test Club';
    if (!email || !password) return res.send('Add ?email=x&password=y to the URL');
    const hash = await bcrypt.hash(password, 10);
    await upsertUser(email, hash, club);
    res.send(`Account created for ${email}. You can now log in at /orders`);
  } catch(e) {
    res.status(500).send('Error: ' + e.message);
  }
});

module.exports = { router, getOrdersFromSheet };
