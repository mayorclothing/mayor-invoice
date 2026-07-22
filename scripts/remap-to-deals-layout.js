// Remap Order Confirmations/Invoices from the HubSpot-mirrored 53-col layout
// (the current live schema) to the Deals-tab-mirrored 58-col layout — see
// portal.js parseSheetRow for the target column map. Also backfills
// Deal ID/Deal Name/Deal Stage/Tracking Number for existing rows by joining
// against the sheet's own "Deals" tab (a live HubSpot import) on Order Number.
//
// Cutover model: make a full copy of the spreadsheet first (Sheets "Make a
// copy") — this script rewrites ONLY Order Confirmations/Invoices in that COPY.
//
// Usage:
//   node scripts/remap-to-deals-layout.js --self-test                 (no creds)
//   GOOGLE_SERVICE_ACCOUNT='<json>' NEW_SHEET_ID='<copy id>' node scripts/remap-to-deals-layout.js            (dry run)
//   GOOGLE_SERVICE_ACCOUNT='<json>' NEW_SHEET_ID='<copy id>' node scripts/remap-to-deals-layout.js --confirm  (writes the COPY)

const { google } = require('googleapis');

const LIVE_SHEET_ID = '1FTVqNw9voQ6Bkk1US_nv_PVx50Uc1TWIGyxGUJNknnU'; // current live MO sheet — must NOT be the target
const argSheet = (process.argv.find((a) => a.startsWith('--sheet=')) || '').split('=')[1];
const NEW_SHEET_ID = process.env.NEW_SHEET_ID || argSheet || '';
const CONFIRM = process.argv.includes('--confirm');
const SELF_TEST = process.argv.includes('--self-test');

function normalizeOrderNumber(v) { return String(v || '').trim().replace(/\s+/g, ' '); }

function orderTabHeader() {
  const h = ['Deal ID', 'Deal Name', 'Deal Stage', 'Tracking Number', 'Customer Email', 'Order Number', 'Product Page', 'Print Background',
    'Customer', 'Shipping Address', 'Billing Address', 'Ship Date', 'In Hand Date', 'Payment Terms'];
  for (let slot = 1; slot <= 5; slot++) {
    h.push('Product ' + slot, 'Description ' + slot, 'Sizes ' + slot);
    if (slot <= 3) h.push('Quantity ' + slot, 'Price ' + slot);
  }
  h.push('Quantity 4', 'Price 4', 'Quantity 5', 'Price 5');
  h.push('Subtotal Quantity', 'Subtotal Price', 'Embroidery', 'Art Setup', 'Sample Reimbursement', 'Custom Main Label', 'Shipping Cost', 'Total');
  h.push('Payment Link', 'Payment Link 2', 'Strike Embroidery', 'Strike Art', 'Strike Shipping');
  for (let slot = 1; slot <= 5; slot++) h.push('Orig Price ' + slot);
  h.push('Drive PDF Link');
  return h; // 58
}

// Build Order Number -> {dealId, dealName, dealStage, trackingNumber} from the
// Deals tab (row 0 = banner, row 1 = header, row 2+ = data; Order Number at col 5).
function buildDealsLookup(dealsRows) {
  const map = new Map();
  for (let i = 2; i < dealsRows.length; i++) {
    const r = dealsRows[i];
    const orderNumber = normalizeOrderNumber(r[5]);
    if (!orderNumber) continue;
    map.set(orderNumber, { dealId: r[0] || '', dealName: r[1] || '', dealStage: r[2] || '', trackingNumber: r[3] || '' });
  }
  return map;
}

// old = one row from the current live 53-col layout (A..BA). dealsLookup = Map from buildDealsLookup.
function remapOrderRow(old, dealsLookup) {
  const orderNumber = normalizeOrderNumber(old[0]);
  const deal = dealsLookup.get(orderNumber) || {};
  const qty = (i) => old[24 + i] || '';
  const price = (i) => old[29 + i] || '';
  const subtotalQty = [0, 1, 2, 3, 4].reduce((s, i) => s + (parseFloat(String(old[24 + i]).replace(/[$,\s]/g, '')) || 0), 0);
  const row = [
    deal.dealId || '', deal.dealName || '', deal.dealStage || '', deal.trackingNumber || '',
    old[7] || '', orderNumber, old[8] || '', '', // print_background: no source yet
    old[1] || '', old[3] || '', old[2] || '', old[4] || '', old[51] || '', old[39] || '',
    old[9] || '', old[14] || '', old[19] || '', qty(0), price(0),
    old[10] || '', old[15] || '', old[20] || '', qty(1), price(1),
    old[11] || '', old[16] || '', old[21] || '', qty(2), price(2),
    old[12] || '', old[17] || '', old[22] || '',
    old[13] || '', old[18] || '', old[23] || '',
    qty(3), price(3), qty(4), price(4),
    subtotalQty || '', old[40] || '',
    old[34] || '', old[35] || '', old[36] || '', old[37] || '', old[38] || '', old[41] || '',
    old[5] || '', old[6] || '',
    old[43] || '', old[44] || '', old[45] || '',
    old[46] || '', old[47] || '', old[48] || '', old[49] || '', old[50] || '',
    old[52] || '',
  ];
  return { row };
}

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
async function writeMatrix(sheets, title, matrix) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: NEW_SHEET_ID, range: `${title}!A1`, valueInputOption: 'RAW', resource: { values: matrix },
  });
}

async function processOrderTab(sheets, title, dealsLookup) {
  const rows = await getTab(sheets, title, 'A:BA');
  if (!rows.length) { console.log(`\n[${title}] empty — skipping`); return; }
  const out = [orderTabHeader()];
  let matched = 0, unmatched = 0;
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const { row } = remapOrderRow(rows[i], dealsLookup);
    if (row[0]) matched++; else unmatched++;
    out.push(row);
    console.log(`  [${title}] row ${i + 1} (${rows[i][0]}): deal_id=${row[0] || '(none)'} tracking=${row[3] || ''}`);
  }
  console.log(`\n[${title}] ${matched} row(s) matched to a Deals-tab entry, ${unmatched} unmatched (deal_id left blank).`);
  if (CONFIRM) { await writeMatrix(sheets, title, out); console.log(`[${title}] wrote ${out.length} rows (incl. header).`); }
}

async function main() {
  if (SELF_TEST) return selfTest();
  if (!NEW_SHEET_ID) throw new Error('NEW_SHEET_ID not set — pass the COPY spreadsheet id via NEW_SHEET_ID env or --sheet=<id>.');
  if (NEW_SHEET_ID === LIVE_SHEET_ID) throw new Error('Refusing to run against the LIVE sheet. Make a copy first and target the copy.');
  const sheets = await getSheets();
  console.log(CONFIRM ? '=== LIVE RUN (writes the COPY) ===' : '=== DRY RUN (pass --confirm to write) ===');
  console.log('Target (must be the COPY):', NEW_SHEET_ID);
  const dealsRows = await getTab(sheets, 'Deals', 'A:AZ');
  const dealsLookup = buildDealsLookup(dealsRows);
  console.log(`Deals tab: ${dealsLookup.size} order(s) indexed for lookup.`);
  await processOrderTab(sheets, 'Order Confirmations', dealsLookup);
  await processOrderTab(sheets, 'Invoices', dealsLookup);
  console.log(CONFIRM ? '\nDone.' : '\nDry run only — review the diffs above, then re-run with --confirm.');
}

function selfTest() {
  const assert = require('assert');
  const old = new Array(53).fill('');
  Object.assign(old, {
    0: 'ORD1', 1: 'Club X', 2: '123 St', 3: 'ship addr', 4: '2026-07-06', 5: 'pay1', 6: 'pay2', 7: 'e@x.com', 8: 'prodpage',
    9: 'url1', 14: 'desc1', 19: 'sizes1', 24: '48', 29: '42',
    10: 'url2', 15: 'desc2', 20: 'sizes2', 25: '12', 30: '0',
    34: '150', 35: '-40', 36: '(40.00)', 37: '0', 38: '25', 39: 'Due', 40: '2016', 41: '2276', 42: 'Ship Date',
    43: '1', 44: '', 45: '1', 46: '10', 47: '', 48: '', 49: '', 50: '', 51: 'in hand', 52: 'drivelink',
  });
  const lookup = new Map([['ORD1', { dealId: 'D1', dealName: 'PO#1', dealStage: 'Delivered', trackingNumber: 'TRK1' }]]);
  const { row } = remapOrderRow(old, lookup);
  const exp = {
    0: 'D1', 1: 'PO#1', 2: 'Delivered', 3: 'TRK1', 4: 'e@x.com', 5: 'ORD1', 6: 'prodpage', 7: '',
    8: 'Club X', 9: 'ship addr', 10: '123 St', 11: '2026-07-06', 12: 'in hand', 13: 'Due',
    14: 'url1', 15: 'desc1', 16: 'sizes1', 17: '48', 18: '42',
    19: 'url2', 20: 'desc2', 21: 'sizes2', 22: '12', 23: '0',
    39: 60, 40: '2016',
    41: '150', 42: '-40', 43: '(40.00)', 44: '0', 45: '25', 46: '2276',
    47: 'pay1', 48: 'pay2', 49: '1', 50: '', 51: '1',
    52: '10', 57: 'drivelink',
  };
  for (const [k, v] of Object.entries(exp)) assert.strictEqual(row[k], v, `row idx ${k}: got ${JSON.stringify(row[k])}, want ${JSON.stringify(v)}`);
  assert.strictEqual(row.length, 58);
  // unmatched order (no Deals entry) => deal fields blank, no throw
  const { row: row2 } = remapOrderRow(old, new Map());
  assert.strictEqual(row2[0], '');
  assert.strictEqual(row2[5], 'ORD1');
  assert.strictEqual(orderTabHeader().length, 58);
  console.log('remap-to-deals-layout.js: all self-test assertions passed');
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
