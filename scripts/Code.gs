/**
 * Chromebook Loaner System - Google Apps Script
 * -----------------------------------------------
 * Deploy as a Web App (Execute as: Me, Access: Anyone)
 * Paste the Web App URL into index.html -> SHEET_URL
 *
 * Sheet tabs:
 *   "Checkouts"     - one row per loaner transaction
 *   "Inventory"     - loaner device pool (synced from the app)
 *   "All Inventory" - full device inventory (synced on CSV import + edits)
 *   "Parts"         - parts inventory (synced from the app)
 *   "Log"           - raw request log
 */

const SPREADSHEET_ID      = '1jgE9Qt7-lsntIIxjake_Plh2eUwj2P3TkHaORgSzxvA';
const CHECKOUT_SHEET      = 'Checkouts';
const INVENTORY_SHEET     = 'Inventory';
const ALL_INVENTORY_SHEET = 'All Inventory';
const PARTS_SHEET         = 'Parts';
const LOG_SHEET           = 'Log';

const CHECKOUT_HEADERS = [
  'ID', 'Student Name', 'Grade', 'Building',
  'Asset Tag', 'Serial Number', 'Incident Type', 'Damaged Part', 'Original Asset Tag',
  'Date Checked Out', 'Due Back', 'Status', 'Return Date', 'Notes'
];

const INVENTORY_HEADERS = [
  'Asset Tag', 'Serial Number', 'Model', 'Building', 'Status', 'Last Updated'
];

const ALL_INVENTORY_HEADERS = [
  'Asset Tag', 'Serial Number', 'Model', 'Building', 'Assigned To', 'Status', 'Last Updated'
];

const PARTS_HEADERS = [
  'Part Type', 'Manufacturer', 'Part Name', 'Value ($)', 'Stock',
  'FRU / Model #', 'Compatible Models', 'Previous Vendor', 'Line Total ($)', 'Last Updated'
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
    } else if (data.action === 'syncAllInventory') {
      syncAllInventory(JSON.parse(data.devices));
    } else if (data.action === 'syncParts') {
      syncParts(JSON.parse(data.parts));
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

  if (action === 'syncAllInventory') {
    try {
      const devices = JSON.parse(e.parameter.devices || '[]');
      syncAllInventory(devices);
      logRequest({ action: 'syncAllInventory', count: devices.length });
      return jsonResponse({ status: 'ok', action: 'syncAllInventory', count: devices.length });
    } catch(err) {
      Logger.log('doGet syncAllInventory error: ' + err.message);
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

// Replaces the entire Inventory sheet with the current loaner pool from the app.
// Called whenever a loaner device is added, removed, edited, or status changes.
function syncInventory(devices) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, INVENTORY_SHEET);
  const now   = new Date().toLocaleString('en-US');

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

// Replaces the entire "All Inventory" sheet with the full device inventory from the app.
// Called whenever a TDT CSV is imported, or a device is edited/deleted in Full Inventory.
function syncAllInventory(devices) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, ALL_INVENTORY_SHEET);
  const now   = new Date().toLocaleString('en-US');

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, ALL_INVENTORY_HEADERS.length).clearContent();
    sheet.getRange(2, 1, lastRow - 1, ALL_INVENTORY_HEADERS.length).setBackground(null);
  }

  ensureHeaders(sheet, ALL_INVENTORY_HEADERS);

  if (!devices || !devices.length) return;

  const rows = devices.map(d => [
    d.assetTag  || '',
    d.serial    || '',
    d.model     || '',
    d.building  || '',
    d.owner     || '',
    d.status    || '',
    now
  ]);

  sheet.getRange(2, 1, rows.length, ALL_INVENTORY_HEADERS.length).setValues(rows);

  // Color-code the Status column (F = col 6) based on value
  const statusRange = sheet.getRange(2, 6, rows.length, 1);
  const backgrounds = rows.map(r => {
    switch(r[5]) {
      case 'Assigned':     return ['#e6f1fb'];
      case 'Unassigned':   return ['#e1f5ee'];
      case 'Loaner':       return ['#faeeda'];
      case 'Daily Loaner': return ['#faeeda'];
      case 'Needs Repair': return ['#fcebeb'];
      default:             return ['#f1efe8'];
    }
  });
  statusRange.setBackgrounds(backgrounds);

  // Alternate row shading on non-status columns
  for (let i = 0; i < rows.length; i++) {
    const bg = i % 2 === 0 ? '#f8f7f4' : null;
    // Cols 1-5 (Asset Tag through Assigned To)
    sheet.getRange(i + 2, 1, 1, 5).setBackground(bg);
    // Re-apply status color (col 6)
    const statusBg = backgrounds[i][0];
    sheet.getRange(i + 2, 6, 1, 1).setBackground(statusBg);
    // Last Updated col (7) — clear/alternate
    sheet.getRange(i + 2, 7, 1, 1).setBackground(bg);
  }

  sheet.setColumnWidths(1, ALL_INVENTORY_HEADERS.length, 140);
  sheet.setColumnWidth(3, 200); // Model — wider
  sheet.setColumnWidth(4, 220); // Building — wider
  sheet.setColumnWidth(5, 180); // Assigned To — wider
  SpreadsheetApp.flush();
}

// Replaces the entire Parts sheet with the current parts inventory from the app.
// Called whenever a part is added, removed, or edited.
function syncParts(parts) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, PARTS_SHEET);
  const now   = new Date().toLocaleString('en-US');

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, PARTS_HEADERS.length).clearContent();
    sheet.getRange(2, 1, lastRow - 1, PARTS_HEADERS.length).setBackground(null);
  }

  ensureHeaders(sheet, PARTS_HEADERS);

  if (!parts || !parts.length) return;

  const rows = parts.map(p => {
    const value    = Number(p.value)  || 0;
    const stock    = Number(p.stock)  || 0;
    const lineTotal = (value * stock).toFixed(2);
    return [
      p.type    || '',
      p.mfr     || '',
      p.name    || '',
      value,
      stock,
      p.fru     || '',
      p.models  || '',
      p.vendor  || '',
      Number(lineTotal),
      now
    ];
  });

  sheet.getRange(2, 1, rows.length, PARTS_HEADERS.length).setValues(rows);

  sheet.getRange(2, 4, rows.length, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(2, 9, rows.length, 1).setNumberFormat('$#,##0.00');

  const stockRange   = sheet.getRange(2, 5, rows.length, 1);
  const stockBgColors = rows.map(r => {
    const s = Number(r[4]) || 0;
    if (s === 0)  return ['#fcebeb'];
    if (s <= 2)   return ['#faeeda'];
    return ['#e1f5ee'];
  });
  stockRange.setBackgrounds(stockBgColors);

  for (let i = 0; i < rows.length; i++) {
    const bg = i % 2 === 0 ? '#f8f7f4' : '#ffffff';
    sheet.getRange(i + 2, 1, 1, PARTS_HEADERS.length).setBackground(bg);
    const s = Number(rows[i][4]) || 0;
    const stockBg = s === 0 ? '#fcebeb' : s <= 2 ? '#faeeda' : '#e1f5ee';
    sheet.getRange(i + 2, 5, 1, 1).setBackground(stockBg);
  }

  const totalRow = rows.length + 2;
  sheet.getRange(totalRow, 3, 1, 1).setValue('TOTAL INVENTORY VALUE');
  sheet.getRange(totalRow, 3, 1, 1).setFontWeight('bold');
  const totalValueFormula = `=SUM(I2:I${rows.length + 1})`;
  sheet.getRange(totalRow, 9, 1, 1).setFormula(totalValueFormula);
  sheet.getRange(totalRow, 9, 1, 1).setNumberFormat('$#,##0.00');
  sheet.getRange(totalRow, 9, 1, 1).setFontWeight('bold');
  sheet.getRange(totalRow, 9, 1, 1).setBackground('#1a56a0');
  sheet.getRange(totalRow, 9, 1, 1).setFontColor('#ffffff');

  sheet.setColumnWidths(1, PARTS_HEADERS.length, 140);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(7, 200);
  SpreadsheetApp.flush();
}

function logRequest(data) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = getOrCreateSheet(ss, LOG_SHEET);
  ensureHeaders(sheet, ['Timestamp', 'Action', 'Payload']);
  sheet.appendRow([new Date().toISOString(), data.action || 'unknown', JSON.stringify(data)]);
}

// --- Formatting helpers ------------------------------------------------------

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

  const allInv = getOrCreateSheet(ss, ALL_INVENTORY_SHEET);
  ensureHeaders(allInv, ALL_INVENTORY_HEADERS);
  allInv.setColumnWidths(1, ALL_INVENTORY_HEADERS.length, 140);
  allInv.setColumnWidth(3, 200);
  allInv.setColumnWidth(4, 220);
  allInv.setColumnWidth(5, 180);

  const parts = getOrCreateSheet(ss, PARTS_SHEET);
  ensureHeaders(parts, PARTS_HEADERS);
  parts.setColumnWidths(1, PARTS_HEADERS.length, 140);
  parts.setColumnWidth(3, 220);
  parts.setColumnWidth(7, 200);

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