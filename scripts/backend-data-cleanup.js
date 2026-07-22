// One-off cleanup for two known-bad classes of sheet rows, found in the 2026-07 audit:
//   1) the "Oklahoma City Golf & Country Club I" duplicate — one correct row, one with
//      a leading-space order number and $0 subtotal/total despite matching line items.
//   2) four test/debug rows visible in the live admin order list: "TEST Order 1",
//      "TEST Order 2", "TEST Order 3", "Linville Test".
//
// Dry-run by default (prints what it would delete). Pass --confirm to actually delete.
//
// Usage:
//   GOOGLE_SERVICE_ACCOUNT='<json>' node scripts/backend-data-cleanup.js
//   GOOGLE_SERVICE_ACCOUNT='<json>' node scripts/backend-data-cleanup.js --confirm

const { google } = require('googleapis');

const SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
const CONFIRM = process.argv.includes('--confirm');
const TEST_ROW_NAMES = new Set(['TEST Order 1', 'TEST Order 2', 'TEST Order 3', 'Linville Test']);
const OKC_NAME = 'Oklahoma City Golf & Country Club I';

function normalize(v) { return String(v || '').trim().replace(/\s+/g, ' '); }

async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  if (!creds.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT env var not set (or missing client_email)');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

async function getSheetIdByTitle(sheets, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === title);
  if (!sheet) throw new Error(`Tab not found: ${title}`);
  return sheet.properties.sheetId;
}

async function getTab(sheets, title, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${title}!${range}` });
  return res.data.values || [];
}

// Deletes 1-based row numbers (descending order doesn't matter — batchUpdate resolves
// indices against the sheet state at request time within a single batch when sorted
// descending, so callers must pass rows sorted high-to-low).
async function deleteRows(sheets, tabTitle, rowNumbers1Based) {
  if (!rowNumbers1Based.length) return;
  const sheetId = await getSheetIdByTitle(sheets, tabTitle);
  const sorted = [...rowNumbers1Based].sort((a, b) => b - a);
  const requests = sorted.map(rowNum => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: rowNum - 1, endIndex: rowNum }
    }
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests } });
}

function parseCurrency(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

async function findOkcDuplicateBadRow(sheets, tabTitle) {
  const rows = await getTab(sheets, tabTitle, 'A:AV');
  const matches = [];
  rows.forEach((r, i) => {
    if (i === 0) return; // header
    if (normalize(r[0]) === OKC_NAME) matches.push({ rowNum: i + 1, order_number_raw: r[0], subtotal: parseCurrency(r[22]), total: parseCurrency(r[25]), items: [r[8], r[13], r[18]].filter(Boolean).length });
  });
  return matches;
}

async function findTestRows(sheets, tabTitle, range) {
  const rows = await getTab(sheets, tabTitle, range);
  const matches = [];
  rows.forEach((r, i) => {
    if (i === 0) return;
    if (TEST_ROW_NAMES.has(normalize(r[0]))) matches.push({ rowNum: i + 1, order_number_raw: r[0] });
  });
  return matches;
}

async function main() {
  const sheets = await getSheets();
  console.log(CONFIRM ? '=== LIVE RUN (will delete) ===' : '=== DRY RUN (pass --confirm to delete) ===');

  // ── 1. OKC duplicate ──
  const toDeleteByTab = {};
  for (const tab of ['Order Confirmations', 'Invoices']) {
    const matches = await findOkcDuplicateBadRow(sheets, tab);
    if (matches.length < 2) continue; // no duplicate in this tab
    console.log(`\n[${tab}] OKC rows found:`, matches);
    const bad = matches.filter(m => m.subtotal === 0 && m.total === 0 && /^\s/.test(m.order_number_raw || ''));
    const good = matches.filter(m => !bad.includes(m));
    if (bad.length !== 1 || good.length < 1) {
      console.warn(`  Could not confidently identify the bad row in ${tab} (expected exactly one $0/leading-space row) — skipping this tab, needs manual review.`);
      continue;
    }
    console.log(`  Will delete row ${bad[0].rowNum} (order_number=${JSON.stringify(bad[0].order_number_raw)}, subtotal=$0, total=$0), keeping row ${good[0].rowNum} (subtotal=$${good[0].subtotal}, total=$${good[0].total}).`);
    (toDeleteByTab[tab] = toDeleteByTab[tab] || []).push(bad[0].rowNum);
  }
  // Order Info doesn't carry totals — delete the leading-space duplicate there too, if present.
  {
    const rows = await getTab(sheets, 'Order Info', 'A:H');
    const oiMatches = [];
    rows.forEach((r, i) => { if (i > 0 && normalize(r[0]) === OKC_NAME) oiMatches.push({ rowNum: i + 1, raw: r[0] }); });
    if (oiMatches.length >= 2) {
      const bad = oiMatches.filter(m => /^\s/.test(m.raw || ''));
      if (bad.length === 1) {
        console.log(`\n[Order Info] Will delete row ${bad[0].rowNum} (order_number=${JSON.stringify(bad[0].raw)}), keeping the rest.`);
        (toDeleteByTab['Order Info'] = toDeleteByTab['Order Info'] || []).push(bad[0].rowNum);
      } else {
        console.warn('\n[Order Info] OKC duplicate present but could not identify the bad row by leading-space alone — skipping, needs manual review.');
      }
    }
  }

  // ── 2. Test rows ──
  for (const [tab, range] of [['Order Info', 'A:H'], ['Order Confirmations', 'A:AV'], ['Invoices', 'A:AV']]) {
    const matches = await findTestRows(sheets, tab, range);
    if (!matches.length) continue;
    console.log(`\n[${tab}] Test rows found:`, matches);
    (toDeleteByTab[tab] = toDeleteByTab[tab] || []).push(...matches.map(m => m.rowNum));
  }

  console.log('\n--- Summary ---');
  for (const [tab, rowNums] of Object.entries(toDeleteByTab)) {
    console.log(`${tab}: rows ${rowNums.sort((a, b) => a - b).join(', ')}`);
  }
  if (!Object.keys(toDeleteByTab).length) {
    console.log('Nothing to delete.');
    return;
  }

  if (!CONFIRM) {
    console.log('\nDry run only — re-run with --confirm to actually delete the rows above.');
    return;
  }

  for (const [tab, rowNums] of Object.entries(toDeleteByTab)) {
    await deleteRows(sheets, tab, rowNums);
    console.log(`Deleted from ${tab}: rows ${rowNums.join(', ')}`);
  }
  console.log('\nDone.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
