// Downloads every order's print-background image (currently a Shopify CDN URL
// read from the sheet's Print Background column) into swatches/<order number>.<ext>,
// so the portal can paint it instantly from the same-origin /swatches/ route
// instead of waiting on the order-detail fetch + a cross-origin CDN request
// (see portal.html's showOrder() and portal.js's swatchUrlFor()).
//
// Reads both Invoices and Order Confirmations tabs (an order's background may
// only be filled in on one of them — same fallback logic as getOrderDetailData
// in portal.js) and skips any order that already has a local file.
//
// Run:
//   GOOGLE_SERVICE_ACCOUNT='<json>' node scripts/backfill-swatches.js            (dry run — lists what it would download)
//   GOOGLE_SERVICE_ACCOUNT='<json>' node scripts/backfill-swatches.js --confirm  (downloads)

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SHEET_ID = process.env.MO_SHEET_ID || '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
const SWATCH_DIR = path.join(__dirname, '..', 'swatches');
const CONFIRM = process.argv.includes('--confirm');

function normalize(v) { return String(v || '').trim().replace(/\s+/g, ' '); }

async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  if (!creds.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT env var not set (or missing client_email)');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

// order_number (col F / index 5) -> print_background URL (col H / index 7),
// same column mapping as parseSheetRow in portal.js. Later tab in the list wins
// only if earlier one was blank, mirroring getOrderDetailData's fallback.
async function collectBackgrounds(sheets) {
  const map = new Map(); // order_number -> url
  for (const tab of ['Invoices', 'Order Confirmations']) {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${tab}!A:H` });
    const rows = (res.data.values || []).slice(1);
    for (const row of rows) {
      const orderNumber = normalize(row[5]);
      const bg = (row[7] || '').trim();
      if (!orderNumber || !bg) continue;
      if (!map.has(orderNumber)) map.set(orderNumber, bg);
    }
  }
  return map;
}

function extFromUrl(url, contentType) {
  const fromUrl = (url.split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i) || [])[1];
  if (fromUrl) return '.' + fromUrl.toLowerCase().replace('jpeg', 'jpg');
  if (contentType && contentType.includes('png')) return '.png';
  if (contentType && contentType.includes('webp')) return '.webp';
  return '.jpg';
}

function hasLocalSwatch(orderNumber) {
  const base = path.basename(orderNumber).replace(/\.[^.]+$/, '');
  return ['.png', '.jpg', '.jpeg'].some(ext => fs.existsSync(path.join(SWATCH_DIR, base + ext)));
}

async function main() {
  const sheets = await getSheets();
  const backgrounds = await collectBackgrounds(sheets);
  console.log(`Found ${backgrounds.size} orders with a Print Background URL.`);
  console.log(CONFIRM ? '=== LIVE RUN (will download) ===' : '=== DRY RUN (pass --confirm to download) ===\n');

  let downloaded = 0, skipped = 0, failed = 0;
  for (const [orderNumber, url] of backgrounds) {
    if (hasLocalSwatch(orderNumber)) { skipped++; continue; }
    if (!/^https:/.test(url)) { console.warn(`  ! skipping ${orderNumber}: not an https URL (${url})`); failed++; continue; }

    console.log(`  -> ${orderNumber}  (${url})`);
    if (!CONFIRM) continue;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = extFromUrl(url, res.headers.get('content-type'));
      const dest = path.join(SWATCH_DIR, `${path.basename(orderNumber)}${ext}`);
      fs.writeFileSync(dest, buf);
      downloaded++;
    } catch (e) {
      console.warn(`  ! failed ${orderNumber}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${CONFIRM ? 'Downloaded' : 'Would download'}: ${backgrounds.size - skipped - failed}, already local: ${skipped}, failed: ${failed}`);
  if (!CONFIRM) console.log('Dry run only — re-run with --confirm to actually download.');
  else console.log('\nNow: git add swatches/ && git commit && git push to deploy them.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
