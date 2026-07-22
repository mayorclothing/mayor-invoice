// Build the new HubSpot-mirrored MO sheet from a COPY of the live one.
//
// Cutover model (see HANDOFF-sheet-reorg.md): make a full copy of the spreadsheet
// first (Sheets "Make a copy" / Drive files.copy) — that carries Users and every
// other tab over untouched. This script then rewrites ONLY the 3 order tabs in that
// COPY from the old layout to the new HubSpot-mirrored layout, splitting the merged
// `sizes` back out of each line-item description into its own column. Nothing live
// reads the copy, so the rewrite is safe and re-runnable.
//
// Usage:
//   node scripts/build-new-sheet.js --self-test                 (no creds — verifies the transform)
//   GOOGLE_SERVICE_ACCOUNT='<json>' NEW_SHEET_ID='<copy id>' node scripts/build-new-sheet.js            (dry run)
//   GOOGLE_SERVICE_ACCOUNT='<json>' NEW_SHEET_ID='<copy id>' node scripts/build-new-sheet.js --confirm  (writes the COPY)
//
// NEW_SHEET_ID must be the COPY, never the live sheet — the script refuses to run
// against the live ID as a guard.

const { google } = require('googleapis');

const LIVE_SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo'; // OLD/live — must NOT be the target
const argSheet = (process.argv.find((a) => a.startsWith('--sheet=')) || '').split('=')[1];
const NEW_SHEET_ID = process.env.NEW_SHEET_ID || argSheet || '';
const CONFIRM = process.argv.includes('--confirm');
const SELF_TEST = process.argv.includes('--self-test');

// ── sizes detection ─────────────────────────────────────────────────────────
// Broadened inverse of mayor-email-backend/hubspotFormat.js cleanDescription(): a
// line is "sizes" if it is made up entirely of SIZE:qty / SIZE-qty tokens. Handles
// colon form ("S: 24 - M: 16 - L: 8") AND hyphen form ("S-24 M-16 L-8"), because the
// merge appended the raw sizes_N field, whose format varies. cleanDescription's own
// regexes are colon-only, so reusing them verbatim would miss hyphen-form sizes.
const SIZE = '(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL)';
const SIZE_LINE_RE = new RegExp(
  `^\\s*${SIZE}\\s*[:\\-]\\s*\\d+(\\s*[-,\\s]\\s*${SIZE}\\s*[:\\-]\\s*\\d+)*\\s*$`, 'i');
function isSizeLine(line) { return SIZE_LINE_RE.test(String(line == null ? '' : line).trim()); }

// Split a merged description ("<desc>\n<sizes>") back into parts by peeling the
// contiguous trailing size lines. Returns { description, sizes, flagged }. Flagged =
// something to eyeball in dry-run: a non-empty item description that yielded no sizes
// (unrecognized format or genuinely none), or one whose whole text was sizes.
function splitSizes(merged) {
  const text = String(merged == null ? '' : merged);
  const lines = text.split('\n');
  let cut = lines.length;
  while (cut > 0 && isSizeLine(lines[cut - 1])) cut--;
  const description = lines.slice(0, cut).join('\n');
  const sizes = lines.slice(cut).join('\n').trim();
  const nonEmpty = text.trim() !== '';
  const flagged = nonEmpty && (sizes === '' || description.trim() === '');
  return { description, sizes, flagged };
}

// ── old → new row remap ─────────────────────────────────────────────────────
// Old order-tab layout is interleaved: items 1-3 (cols 6-20), then totals (21-25),
// then items 4-5 (26-35). New layout groups by field type (see portal.js parseSheetRow).
const OLD_ITEM = [[6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20], [26, 27, 28, 29, 30], [31, 32, 33, 34, 35]]; // url,desc,qty,price,orig
const num = (v) => parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')) || 0;

function remapOrderRow(old) {
  const g = (i) => (old[i] == null ? '' : old[i]);
  const n = new Array(53).fill('');
  let flagged = false;
  // Block 1 (A–I)
  n[0] = g(0); n[1] = g(2); n[2] = g(3); n[3] = g(37); n[4] = g(4);
  n[5] = g(5); n[6] = g(39); n[7] = g(1); n[8] = g(36);
  // Block 2 (J–AH) — split sizes out of each item description
  OLD_ITEM.forEach(([u, d, q, pr, o], i) => {
    n[9 + i] = g(u);
    const parts = splitSizes(g(d));
    n[14 + i] = parts.description;
    n[19 + i] = parts.sizes;
    n[24 + i] = g(q);
    n[29 + i] = g(pr);
    n[46 + i] = g(o);
    if (num(g(q)) > 0 && parts.flagged) flagged = true; // only flag slots that hold a real line item
  });
  // Block 3 (AI–AN)
  n[34] = g(23); n[35] = g(24); n[36] = g(45); n[37] = g(44); n[38] = g(21); n[39] = g(40);
  // Block 4 (AO–BA) — orig_price_1..5 (46-50) filled in the loop above
  n[40] = g(22); n[41] = g(25); n[42] = g(38); n[43] = g(41); n[44] = g(42); n[45] = g(43);
  n[51] = g(47); n[52] = g(46);
  return { row: n, flagged };
}

// Order Info: [order#, email, club, ship_date, ...] -> [order#, club, ship_date, email, ...]
function remapOrderInfoRow(old) {
  const g = (i) => (old[i] == null ? '' : old[i]);
  return [g(0), g(2), g(3), g(1), g(4), g(5), g(6), g(7)];
}

// ── new header rows ─────────────────────────────────────────────────────────
const ORDER_INFO_HEADER = ['Order Number', 'Club', 'Ship Date', 'Email', 'Status', 'Tracking Number', 'Date Delivered', ''];
function orderTabHeader() {
  const h = ['Order Number', 'Club', 'Address', 'Shipping Address', 'Ship Date', 'Payment Link', 'Payment Link 2', 'Customer Email', 'Product Page'];
  for (let i = 1; i <= 5; i++) h.push('Product ' + i);
  for (let i = 1; i <= 5; i++) h.push('Description ' + i);
  for (let i = 1; i <= 5; i++) h.push('Sizes ' + i);
  for (let i = 1; i <= 5; i++) h.push('Quantity ' + i);
  for (let i = 1; i <= 5; i++) h.push('Price ' + i);
  h.push('Embroidery', 'Art Setup', 'Sample Reimbursement', 'Custom Label', 'Shipping', 'Payment Terms');
  h.push('Subtotal', 'Total', 'Date Label', 'Strike Embroidery', 'Strike Art', 'Strike Shipping');
  for (let i = 1; i <= 5; i++) h.push('Orig Price ' + i);
  h.push('In Hand Date', 'Drive PDF Link');
  return h; // 53
}

// ── Sheets I/O ──────────────────────────────────────────────────────────────
async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  if (!creds.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT env var not set (or missing client_email)');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}
async function getTab(sheets, title, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: NEW_SHEET_ID, range: `${title}!${range}` });
  return res.data.values || [];
}
// Faithful text copy: read formatted values, write RAW so a leading '=' can't become a
// formula and displayed strings (ship dates, currency) carry over exactly as the portal reads them.
async function writeMatrix(sheets, title, matrix) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW_SHEET_ID, range: `${title}!A1`, valueInputOption: 'RAW', resource: { values: matrix },
  });
}

async function processOrderTab(sheets, title) {
  const rows = await getTab(sheets, title, 'A:AV');
  if (!rows.length) { console.log(`\n[${title}] empty — skipping`); return; }
  const out = [orderTabHeader()];
  const flags = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i] || !rows[i][0]) { out.push(new Array(53).fill('')); continue; } // preserve blank spacer rows
    const { row, flagged } = remapOrderRow(rows[i]);
    out.push(row);
    // Per-item before/after for review
    OLD_ITEM.forEach(([, d,,,], k) => {
      const oldDesc = rows[i][d];
      if (oldDesc && String(oldDesc).trim()) {
        console.log(`  [${title}] row ${i + 1} (${rows[i][0]}) item ${k + 1}: ${JSON.stringify(String(oldDesc))} -> desc=${JSON.stringify(row[14 + k])} sizes=${JSON.stringify(row[19 + k])}`);
      }
    });
    if (flagged) flags.push({ rowNum: i + 1, order: rows[i][0] });
  }
  if (flags.length) {
    console.log(`\n  ⚠️ [${title}] ${flags.length} row(s) FLAGGED (a line item had a description but no sizes were split — review the format):`);
    flags.forEach((f) => console.log(`     row ${f.rowNum}: ${f.order}`));
  }
  if (CONFIRM) { await writeMatrix(sheets, title, out); console.log(`  [${title}] wrote ${out.length} rows (incl. header).`); }
}

async function processOrderInfo(sheets) {
  const rows = await getTab(sheets, 'Order Info', 'A:H');
  if (!rows.length) { console.log('\n[Order Info] empty — skipping'); return; }
  const out = [ORDER_INFO_HEADER];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i] || !rows[i][0]) { out.push(new Array(8).fill('')); continue; }
    const n = remapOrderInfoRow(rows[i]);
    out.push(n);
    console.log(`  [Order Info] row ${i + 1} (${n[0]}): club=${JSON.stringify(n[1])} ship_date=${JSON.stringify(n[2])} email=${JSON.stringify(n[3])}`);
  }
  if (CONFIRM) { await writeMatrix(sheets, 'Order Info', out); console.log(`  [Order Info] wrote ${out.length} rows (incl. header).`); }
}

async function main() {
  if (SELF_TEST) return selfTest();
  if (!NEW_SHEET_ID) throw new Error('NEW_SHEET_ID not set — pass the COPY spreadsheet id via NEW_SHEET_ID env or --sheet=<id>.');
  if (NEW_SHEET_ID === LIVE_SHEET_ID) throw new Error('Refusing to run against the LIVE sheet. Make a copy first and target the copy.');
  const sheets = await getSheets();
  console.log(CONFIRM ? '=== LIVE RUN (writes the COPY) ===' : '=== DRY RUN (pass --confirm to write) ===');
  console.log('Target (must be the COPY):', NEW_SHEET_ID);
  await processOrderInfo(sheets);
  await processOrderTab(sheets, 'Order Confirmations');
  await processOrderTab(sheets, 'Invoices');
  console.log(CONFIRM ? '\nDone.' : '\nDry run only — review the diffs/flags above, then re-run with --confirm.');
}

// ── self-test (no creds) ────────────────────────────────────────────────────
function selfTest() {
  const assert = require('assert');
  // sizes detection
  assert.ok(isSizeLine('S: 24 - M: 16 - L: 8'));
  assert.ok(isSizeLine('S-24 M-16 L-8'));
  assert.ok(isSizeLine('S:2 - M:8'));
  assert.ok(isSizeLine('XL-4 2XL-2'));
  assert.ok(!isSizeLine('Navy piqué'));
  assert.ok(!isSizeLine('S: 3 designs'));
  assert.ok(!isSizeLine(''));
  // split
  assert.deepStrictEqual(splitSizes('Navy piqué\nS-24 M-16 L-8'), { description: 'Navy piqué', sizes: 'S-24 M-16 L-8', flagged: false });
  assert.deepStrictEqual(splitSizes('Navy piqué\nS: 24 - M: 16'), { description: 'Navy piqué', sizes: 'S: 24 - M: 16', flagged: false });
  const white = splitSizes('White');
  assert.strictEqual(white.description, 'White'); assert.strictEqual(white.sizes, ''); assert.strictEqual(white.flagged, true);
  assert.deepStrictEqual(splitSizes(''), { description: '', sizes: '', flagged: false });
  // order-tab remap: place known values at old indices, assert new positions
  const old = new Array(48).fill('');
  Object.assign(old, { 0: 'ORD', 1: 'e@x.com', 2: 'Club X', 3: '123 St', 4: '2026-07-06', 5: 'pay1',
    6: 'url1', 7: 'Polo\nS-24 M-16', 8: '40', 9: '42', 10: '50',
    21: '25', 22: '1000', 23: '150', 24: '-40', 25: '1975',
    36: 'prodpage', 37: 'ship addr', 38: 'Ship Date', 39: 'pay2', 40: 'Due',
    41: '1', 42: '1', 43: '', 44: '0', 45: '(40.00)', 46: 'drivelink', 47: 'in hand' });
  const { row } = remapOrderRow(old);
  const exp = { 0: 'ORD', 1: 'Club X', 2: '123 St', 3: 'ship addr', 4: '2026-07-06', 5: 'pay1', 6: 'pay2', 7: 'e@x.com', 8: 'prodpage',
    9: 'url1', 14: 'Polo', 19: 'S-24 M-16', 24: '40', 29: '42', 46: '50',
    34: '150', 35: '-40', 36: '(40.00)', 37: '0', 38: '25', 39: 'Due',
    40: '1000', 41: '1975', 42: 'Ship Date', 43: '1', 44: '1', 45: '', 51: 'in hand', 52: 'drivelink' };
  for (const [k, v] of Object.entries(exp)) assert.strictEqual(row[k], v, `order row idx ${k}: got ${JSON.stringify(row[k])}, want ${JSON.stringify(v)}`);
  assert.strictEqual(row.length, 53);
  // order info remap
  assert.deepStrictEqual(remapOrderInfoRow(['ORD', 'e@x.com', 'Club X', '2026-07-06', 'Shipped', 'TRK', 'deliv', '']),
    ['ORD', 'Club X', '2026-07-06', 'e@x.com', 'Shipped', 'TRK', 'deliv', '']);
  // header lengths
  assert.strictEqual(orderTabHeader().length, 53);
  assert.strictEqual(ORDER_INFO_HEADER.length, 8);
  console.log('build-new-sheet.js: all self-test assertions passed');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
