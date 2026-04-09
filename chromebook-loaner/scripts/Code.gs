/**
 * Chromebook Loaner System — Google Apps Script
 * -----------------------------------------------
 * Deploy as a Web App (Execute as: Me, Access: Anyone)
 * Paste the Web App URL into index.html → SHEET_URL
 *
 * Sheet tabs created automatically:
 *   "Checkouts"  — one row per loaner transaction
 *   "Inventory"  — loaner device pool
 *   "Log"        — raw request log
 */

const SPREADSHEET_ID = '1jgE9Qt7-lsntIIxjake_Plh2eUwj2P3TkHaORgSzxvA'; // ← paste your Sheet ID
const CHECKOUT_SHEET  = 'Checkouts';
const INVENTORY_SHEET = 'Inventory';
const LOG_SHEET       = 'Log';

// ─── Entry points ────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    logRequest(data);

    if (data.action === 'checkout') {
      appendCheckout(data);
    } else if (data.action === 'return') {
      markReturned(data.id, data.returnDate);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // Allow fetching all checkouts for reporting
  const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet  = getOrCreateSheet(ss, CHECKOUT_SHEET);
  const values = sheet.getDataRange().getValues();
  return ContentService
    .createTextOutput(JSON.stringify(values))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

function appendCheckout(d) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, CHECKOUT_SHEET);

  ensureHeaders(sheet, [
    'ID', 'Student Name', 'Student ID', 'Grade', 'Building',
    'Asset Tag', 'Serial Number', 'Incident Type',
    'Date Checked Out', 'Due Back', 'Status', 'Return Date', 'Notes'
  ]);

  sheet.appendRow([
    d.id,
    d.studentName  || '',
    d.studentId    || '',
    d.grade        || '',
    d.building     || '',
    d.assetTag     || '',
    d.serial       || '',
    d.type         || '',
    d.date         || '',
    d.due          || '',
    'Active',
    '',
    d.notes        || ''
  ]);

  formatLastRow(sheet);
  conditionalFormat(sheet);
}

function markReturned(id, returnDate) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, CHECKOUT_SHEET);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 11).setValue('Returned');     // Status col
      sheet.getRange(i + 1, 12).setValue(returnDate);     // Return Date col
      break;
    }
  }
}

function logRequest(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, LOG_SHEET);
  ensureHeaders(sheet, ['Timestamp', 'Action', 'Payload']);
  sheet.appendRow([new Date().toISOString(), data.action || 'unknown', JSON.stringify(data)]);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#1a56a0');
    headerRange.setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
}

function formatLastRow(sheet) {
  const row   = sheet.getLastRow();
  const range = sheet.getRange(row, 1, 1, sheet.getLastColumn());
  range.setVerticalAlignment('middle');
  if (row % 2 === 0) range.setBackground('#f8f7f4');
}

function conditionalFormat(sheet) {
  // Color-code the Status column (col 11) — only set once
  const rules = sheet.getConditionalFormatRules();
  if (rules.length > 0) return; // already applied

  const range = sheet.getRange('K2:K1000');

  const activeRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Active')
    .setBackground('#e1f5ee')
    .setFontColor('#085041')
    .setRanges([range])
    .build();

  const returnedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Returned')
    .setBackground('#f1efe8')
    .setFontColor('#5f5e5a')
    .setRanges([range])
    .build();

  sheet.setConditionalFormatRules([activeRule, returnedRule]);
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ─── One-time setup (run manually once) ──────────────────────────────────────

function setupSpreadsheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Checkouts sheet
  const cs = getOrCreateSheet(ss, CHECKOUT_SHEET);
  ensureHeaders(cs, [
    'ID', 'Student Name', 'Student ID', 'Grade', 'Building',
    'Asset Tag', 'Serial Number', 'Incident Type',
    'Date Checked Out', 'Due Back', 'Status', 'Return Date', 'Notes'
  ]);
  cs.setColumnWidths(1, 13, 120);
  cs.setColumnWidth(2, 160);
  cs.setColumnWidth(5, 200);

  // Inventory sheet
  const inv = getOrCreateSheet(ss, INVENTORY_SHEET);
  ensureHeaders(inv, ['Asset Tag', 'Serial Number', 'Model', 'Status', 'Notes']);
  inv.setColumnWidths(1, 5, 150);

  SpreadsheetApp.flush();
  Logger.log('Setup complete.');
}
