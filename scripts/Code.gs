/**
 * Chromebook Loaner System - Google Apps Script
 * -----------------------------------------------
 * Deploy as a Web App (Execute as: Me, Access: Anyone)
 * Paste the Web App URL into index.html -> SHEET_URL
 *
 * Sheet tabs:
 *   "Checkouts"  - one row per loaner transaction
 *   "Inventory"  - loaner device pool (synced from the app)
 *   "Log"        - raw request log
 */

const SPREADSHEET_ID  = '1jgE9Qt7-lsntIIxjake_Plh2eUwj2P3TkHaORgSzxvA';
const CHECKOUT_SHEET  = 'Checkouts';
const INVENTORY_SHEET = 'Inventory';
const LOG_SHEET       = 'Log';

const CHECKOUT_HEADERS = [
  'ID', 'Student Name', 'Grade', 'Building',
  'Asset Tag', 'Serial Number', 'Incident Type', 'Damaged Part', 'Original Asset Tag',
  'Date Checked Out', 'Due Back', 'Status', 'Return Date', 'Notes'
];

const INVENTORY_HEADERS = [
  'Asset Tag', 'Serial Number', 'Model', 'Building', 'Status', 'Last Updated'
];

// --- Shared response helper --------------------------------------------------

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Entry points ------------------------------------------------------------

function doPost(e) {
  try {
    let data;
    if (e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      throw new Error('No data received');
    }

    logRequest(data);

    if (data.action === 'checkout') {
      appendCheckout(data);
    } else if (data.action === 'return') {
      markReturned(data.id, data.returnDate);
    } else if (data.action === 'syncInventory') {
      syncInventory(JSON.parse(data.devices));
    } else {
      throw new Error('Unknown action: ' + data.action);
    }

    return jsonResponse({ status: 'ok', action: data.action });

  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function doGet(e) {
  const action = e.parameter && e.parameter.action;

  if (action === 'checkout') {
    try {
      appendCheckout(e.parameter);
      logRequest(e.parameter);
      return jsonResponse({ status: 'ok', action: 'checkout' });
    } catch(err) {
      Logger.log('doGet checkout error: ' + err.message);
      return jsonResponse({ status: 'error', message: err.message });
    }
  }

  if (action === 'return') {
    try {
      markReturned(e.parameter.id, e.parameter.returnDate);
      logRequest(e.parameter);
      return jsonResponse({ status: 'ok', action: 'return', id: e.parameter.id });
    } catch(err) {
      Logger.log('doGet return error: ' + err.message);
      return jsonResponse({ status: 'error', message: err.message });
    }
  }

  if (action === 'syncInventory') {
    try {
      const devices = JSON.parse(e.parameter.devices || '[]');
      syncInventory(devices);
      logRequest({ action: 'syncInventory', count: devices.length });
      return jsonResponse({ status: 'ok', action: 'syncInventory', count: devices.length });
    } catch(err) {
      Logger.log('doGet syncInventory error: ' + err.message);
      return jsonResponse({ status: 'error', message: err.message });
    }
  }

  // Default: return all checkouts for reporting
  try {
    const ss     = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet  = getOrCreateSheet(ss, CHECKOUT_SHEET);
    const values = sheet.getDataRange().getValues();
    return jsonResponse(values);
  } catch(err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

// --- Sheet helpers -----------------------------------------------------------

function appendCheckout(d) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, CHECKOUT_SHEET);

  ensureHeaders(sheet, CHECKOUT_HEADERS);

  sheet.appendRow([
    d.id,
    d.studentName      || '',
    d.grade            || '',
    d.building         || '',
    d.assetTag         || '',
    d.serial           || '',
    d.type             || '',
    d.damagedPart      || '',
    d.originalAssetTag || '',
    d.date             || '',
    d.due              || '',
    'Active',
    '',
    d.notes            || ''
  ]);

  formatLastRow(sheet);
  conditionalFormat(sheet);
}

function markReturned(id, returnDate) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, CHECKOUT_SHEET);
  const data  = sheet.getDataRange().getValues();

  const headers   = data[0];
  const statusCol = headers.indexOf('Status') + 1;
  const returnCol = headers.indexOf('Return Date') + 1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      if (statusCol) sheet.getRange(i + 1, statusCol).setValue('Returned');
      if (returnCol) sheet.getRange(i + 1, returnCol).setValue(returnDate);
      break;
    }
  }
}

// Replaces the entire Inventory sheet with the current device pool from the app.
// Called whenever a device is added, removed, edited, or status changes.
function syncInventory(devices) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, INVENTORY_SHEET);
  const now   = new Date().toLocaleString('en-US');

  // Clear everything below the header
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, INVENTORY_HEADERS.length).clearContent();
  }

  ensureHeaders(sheet, INVENTORY_HEADERS);

  if (!devices || !devices.length) return;

  const rows = devices.map(d => [
    d.assetTag  || '',
    d.serial    || '',
    d.model     || '',
    d.building  || '',
    d.status    || '',
    now
  ]);

  sheet.getRange(2, 1, rows.length, INVENTORY_HEADERS.length).setValues(rows);

  // Color-code the Status column (E) based on value
  const statusRange = sheet.getRange(2, 5, rows.length, 1);
  const backgrounds = rows.map(r => {
    switch(r[4]) {
      case 'Available':    return ['#e1f5ee'];
      case 'On Loan':      return ['#e6f1fb'];
      case 'Loaner':       return ['#e6f1fb'];
      case 'Daily Loaner': return ['#e6f1fb'];
      case 'Needs Repair': return ['#fcebeb'];
      default:             return ['#f1efe8'];
    }
  });
  statusRange.setBackgrounds(backgrounds);

  // Alternate row shading on the rest
  for (let i = 0; i < rows.length; i++) {
    if (i % 2 === 0) {
      sheet.getRange(i + 2, 1, 1, 4).setBackground('#f8f7f4');
    } else {
      sheet.getRange(i + 2, 1, 1, 4).setBackground(null);
    }
  }

  sheet.setColumnWidths(1, INVENTORY_HEADERS.length, 140);
  SpreadsheetApp.flush();
}

function logRequest(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, LOG_SHEET);
  ensureHeaders(sheet, ['Timestamp', 'Action', 'Payload']);
  sheet.appendRow([new Date().toISOString(), data.action || 'unknown', JSON.stringify(data)]);
}

// --- Formatting helpers ------------------------------------------------------

// Always verifies headers match - restores them if deleted or shifted
function ensureHeaders(sheet, headers) {
  const hasRows  = sheet.getLastRow() > 0;
  const firstRow = hasRows ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  const headersMatch = headers.every((h, i) => firstRow[i] === h);
  if (!headersMatch) {
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

// Always re-applies Active/Returned rules, preserving any other rules on the sheet
function conditionalFormat(sheet) {
  const range = sheet.getRange('L2:L1000');

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

  const existing = sheet.getConditionalFormatRules().filter(r => {
    const boolCond = r.getBooleanCondition();
    if (!boolCond) return true;
    const val = boolCond.getCriteriaValues()[0];
    return val !== 'Active' && val !== 'Returned';
  });

  sheet.setConditionalFormatRules([...existing, activeRule, returnedRule]);
}

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// --- One-time setup (run manually once) -------------------------------------

function setupSpreadsheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const cs = getOrCreateSheet(ss, CHECKOUT_SHEET);
  ensureHeaders(cs, CHECKOUT_HEADERS);
  cs.setColumnWidths(1, CHECKOUT_HEADERS.length, 130);
  cs.setColumnWidth(2, 160);
  cs.setColumnWidth(4, 220);

  const inv = getOrCreateSheet(ss, INVENTORY_SHEET);
  ensureHeaders(inv, INVENTORY_HEADERS);
  inv.setColumnWidths(1, INVENTORY_HEADERS.length, 140);

  SpreadsheetApp.flush();
  Logger.log('Setup complete.');
}

// --- Fix existing sheet headers (run once if you already have data) ----------

function updateCheckoutHeaders() {
  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet   = getOrCreateSheet(ss, CHECKOUT_SHEET);
  const lastCol = CHECKOUT_HEADERS.length;

  const headerRange = sheet.getRange(1, 1, 1, lastCol);
  headerRange.setValues([CHECKOUT_HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#1a56a0');
  headerRange.setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.setColumnWidths(1, lastCol, 130);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(4, 220);

  SpreadsheetApp.flush();
  Logger.log('Headers updated.');
}