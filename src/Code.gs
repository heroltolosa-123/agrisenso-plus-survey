/**
 * AGRISENSO Plus Baseline Survey — Apps Script backend.
 *
 * This script is bound to the Google Sheet that acts as the survey's
 * database. It serves an HTML web app (Index.html) and exposes two
 * functions to the client via google.script.run:
 *   - getSchema(instrumentKey)      -> the questionnaire structure
 *   - submitResponse(key, values)   -> appends one row to the right tab
 *
 * QUESTIONS_A / QUESTIONS_B come from Schema_A.gs / Schema_B.gs
 * (auto-generated — see parse_questionnaire.py in the project source).
 */

var TAB_NAMES = {
  A: 'Instrument_A_Borrowers',
  B: 'Instrument_B_NonBorrowers'
};

// ---------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('AGRISENSO Plus Baseline Survey')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------------------------------------------------------------------
// Schema helpers (mirrors schema_engine.py so column IDs always match)
// ---------------------------------------------------------------------
function getSchema(instrumentKey) {
  return instrumentKey === 'A' ? QUESTIONS_A : QUESTIONS_B;
}

function slug_(s, n) {
  n = n || 30;
  var out = String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return out.substring(0, n) || 'x';
}

function isNumericMatrix_(columns) {
  var combined = columns.slice(1).join(' ').toLowerCase();
  var keys = ['%', 'number', 'area', 'amount', 'unit', 'classification'];
  return keys.some(function (k) { return combined.indexOf(k) !== -1; });
}

function matrixCells_(field) {
  var cols = field.columns, rows = field.rows;
  var numeric = isNumericMatrix_(cols);
  var cells = [];
  rows.forEach(function (r) {
    var rslug = slug_(r);
    if (numeric) {
      cols.slice(1).forEach(function (c) {
        cells.push({
          cellId: field.field_id + '__' + rslug + '__' + slug_(c),
          rowLabel: r,
          colLabel: c,
          kind: 'text'
        });
      });
    } else {
      cells.push({
        cellId: field.field_id + '__' + rslug,
        rowLabel: r,
        colLabel: null,
        kind: 'choice',
        choices: cols.slice(1)
      });
    }
  });
  return { cells: cells, numeric: numeric };
}

/** Ordered [ [column_id, human_label], ... ] covering every data point,
 * including one column per matrix cell. Must match the client's rendering
 * order exactly, since it defines the sheet's header row. */
function flatColumns_(schema) {
  var cols = [];
  schema.sections.forEach(function (section) {
    section.questions.forEach(function (question) {
      question.fields.forEach(function (field) {
        var base = section.title + ' > ' + question.heading + ' > ' + field.label;
        if (field.type === 'matrix') {
          var res = matrixCells_(field);
          res.cells.forEach(function (c) {
            var label = base + ' > ' + c.rowLabel + (c.colLabel ? ' > ' + c.colLabel : '');
            cols.push([c.cellId, label]);
          });
        } else {
          cols.push([field.field_id, base]);
        }
      });
    });
  });
  return cols;
}

// ---------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------
function submitResponse(instrumentKey, values) {
  var schema = getSchema(instrumentKey);
  var columns = flatColumns_(schema);
  var tabName = TAB_NAMES[instrumentKey];
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    ensureHeaders_(sheet, columns);
    ensureDictionary_(ss, tabName, columns);

    var submissionId = Utilities.getUuid();
    var submittedAt = new Date();
    var row = [submissionId, submittedAt].concat(columns.map(function (c) {
      var v = values[c[0]];
      return (v === undefined || v === null) ? '' : v;
    }));
    sheet.appendRow(row);
    return { ok: true, submissionId: submissionId };
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders_(sheet, columns) {
  var ids = ['submission_id', 'submitted_at'].concat(columns.map(function (c) { return c[0]; }));
  var existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), ids.length)).getValues()[0]
    : [];
  var matches = existing.length === ids.length && ids.every(function (id, i) { return existing[i] === id; });
  if (!matches) {
    var labels = ['submission_id', 'submitted_at (server time)'].concat(columns.map(function (c) { return c[1]; }));
    sheet.getRange(1, 1, 1, ids.length).setValues([ids]);
    sheet.getRange(2, 1, 1, labels.length).setValues([labels]);
    sheet.setFrozenRows(2);
  }
}

function ensureDictionary_(ss, tabName, columns) {
  var dictName = tabName + '_Dictionary';
  var dsheet = ss.getSheetByName(dictName);
  if (!dsheet) dsheet = ss.insertSheet(dictName);
  var rows = [['field_id', 'question_text']].concat(columns.map(function (c) { return [c[0], c[1]]; }));
  dsheet.getRange(1, 1, rows.length, 2).setValues(rows);
}

// ---------------------------------------------------------------------
// One-time helper you can run manually from the Apps Script editor to
// pre-create both tabs + dictionaries before the first live interview.
// ---------------------------------------------------------------------
function setupSheetsManually() {
  ['A', 'B'].forEach(function (key) {
    var schema = getSchema(key);
    var columns = flatColumns_(schema);
    var tabName = TAB_NAMES[key];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) sheet = ss.insertSheet(tabName);
    ensureHeaders_(sheet, columns);
    ensureDictionary_(ss, tabName, columns);
  });
  Logger.log('Sheets ready.');
}
