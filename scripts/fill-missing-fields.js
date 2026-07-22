// Fills in the two known data gaps found in the 2026-07 audit that need real-world
// values only Marcus/Matt have: 5 orders missing a customer email (which blocks that
// order from ever appearing for a customer login), and 4 orders with placeholder
// ship-date text instead of a real date.
//
// ⚠️ PRE-CUTOVER ONLY (sheet-reorg). This writes Order Info by the OLD column letters
// (B=email, D=ship_date). Run it BEFORE build-new-sheet.js and against the OLD sheet;
// build-new-sheet.js then carries these filled values into the new HubSpot-mirrored
// sheet. After cutover those letters are wrong (new: B=club, C=ship_date, D=email) —
// do NOT run this against the new sheet without updating the columns first. Kept
// hardcoded to the old SHEET_ID (not MO_SHEET_ID) so it can't accidentally hit the new one.
//
// Fill in the two maps below with real values, then run:
//   GOOGLE_SERVICE_ACCOUNT='<json>' node scripts/fill-missing-fields.js            (dry run)
//   GOOGLE_SERVICE_ACCOUNT='<json>' node scripts/fill-missing-fields.js --confirm  (writes)

const { google } = require('googleapis');

const SHEET_ID = '152hyxQz87IwPYl2lgBCm6pKKSjYl1hoL-AuZu-wODbo';
const CONFIRM = process.argv.includes('--confirm');

// order_number (exact, as it appears in the sheet) -> customer email to write into
// Order Info column B.
const MISSING_EMAILS = {
  'Forest Lake Country Club I': '',
  'MYRWHPOLOF26': '',
  'MGT Nashville I': '',
  'Bromeliad I': '',
  'MGT II': '',
};

// order_number -> real ship date (any format formatShipDate()/isRealDate() in
// portal.html accepts, e.g. "8/15/2026") to write into Order Info column D and,
// if the order has an Invoices/Order Confirmations row, column E there too.
const MISSING_SHIP_DATES = {
  // 'Some Order Name': '8/15/2026',
};

function normalize(v) { return String(v || '').trim().replace(/\s+/g, ' '); }

async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
  if (!creds.client_email) throw new Error('GOOGLE_SERVICE_ACCOUNT env var not set (or missing client_email)');
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  return google.sheets({ version: 'v4', auth });
}

async function getTab(sheets, title, range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${title}!${range}` });
  return res.data.values || [];
}

async function writeCell(sheets, tab, rowNum, colLetter, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tab}!${colLetter}${rowNum}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[value]] },
  });
}

async function main() {
  const emailEntries = Object.entries(MISSING_EMAILS).filter(([, v]) => v);
  const dateEntries = Object.entries(MISSING_SHIP_DATES).filter(([, v]) => v);
  if (!emailEntries.length && !dateEntries.length) {
    console.log('No values filled in yet — edit MISSING_EMAILS / MISSING_SHIP_DATES at the top of this script, then re-run.');
    return;
  }

  const sheets = await getSheets();
  console.log(CONFIRM ? '=== LIVE RUN (will write) ===' : '=== DRY RUN (pass --confirm to write) ===');

  if (emailEntries.length) {
    const rows = await getTab(sheets, 'Order Info', 'A:H');
    for (const [orderNumber, email] of emailEntries) {
      const idx = rows.findIndex((r, i) => i > 0 && normalize(r[0]) === normalize(orderNumber));
      if (idx === -1) { console.warn(`[Order Info] order not found, skipping: ${orderNumber}`); continue; }
      const rowNum = idx + 1;
      console.log(`[Order Info] row ${rowNum} (${orderNumber}): set column B (email) = ${email}`);
      if (CONFIRM) await writeCell(sheets, 'Order Info', rowNum, 'B', email);
    }
  }

  if (dateEntries.length) {
    const oiRows = await getTab(sheets, 'Order Info', 'A:H');
    for (const [orderNumber, shipDate] of dateEntries) {
      const idx = oiRows.findIndex((r, i) => i > 0 && normalize(r[0]) === normalize(orderNumber));
      if (idx === -1) { console.warn(`[Order Info] order not found, skipping: ${orderNumber}`); continue; }
      const rowNum = idx + 1;
      console.log(`[Order Info] row ${rowNum} (${orderNumber}): set column D (ship_date) = ${shipDate}`);
      if (CONFIRM) await writeCell(sheets, 'Order Info', rowNum, 'D', shipDate);
    }
    for (const tab of ['Invoices', 'Order Confirmations']) {
      const rows = await getTab(sheets, tab, 'A:AV');
      for (const [orderNumber, shipDate] of dateEntries) {
        const idx = rows.findIndex((r, i) => i > 0 && normalize(r[0]) === normalize(orderNumber));
        if (idx === -1) continue; // order may not have a row in this tab yet — fine
        const rowNum = idx + 1;
        console.log(`[${tab}] row ${rowNum} (${orderNumber}): set column E (ship_date) = ${shipDate}`);
        if (CONFIRM) await writeCell(sheets, tab, rowNum, 'E', shipDate);
      }
    }
  }

  console.log(CONFIRM ? '\nDone.' : '\nDry run only — re-run with --confirm to write the values above.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
