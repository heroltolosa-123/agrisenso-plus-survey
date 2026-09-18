/**
 * AGRISENSO Plus Baseline Survey — Apps Script backend.
 *
 * This script is bound to the Google Sheet that acts as the survey's
 * database. It can serve the survey two ways:
 *   1. As a self-contained HTML page at its own /exec URL (google.script.run).
 *   2. As a JSON API for a separately-hosted front end (see docs/), via
 *      GET ?action=schema&instrument=A and POST {action:"submit",...}.
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
//
// Two ways to reach this backend:
//   1. Open the deployed /exec URL directly in a browser -> serves the
//      full HTML survey (same as before).
//   2. Call it as a JSON API from a site hosted elsewhere (GitHub Pages,
//      Render, etc. — see docs/ in the project) via:
//        GET  <url>?action=schema&instrument=A
//        POST <url>   body: {"action":"submit","instrument":"A","values":{...}}
//      POST requests must use Content-Type: text/plain to avoid a CORS
//      preflight that Apps Script web apps can't answer; the body is
//      still parsed as JSON on this end regardless of that header.
// ---------------------------------------------------------------------
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'schema') {
    var key = e.parameter.instrument;
    if (key !== 'A' && key !== 'B') return jsonOutput_({ ok: false, error: 'invalid instrument' });
    return jsonOutput_(getSchema(key));
  }
  if (action === 'ping') {
    return jsonOutput_({ ok: true, message: 'AGRISENSO Plus survey backend is reachable.' });
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('AGRISENSO Plus Baseline Survey')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action === 'submit') {
      if (body.instrument !== 'A' && body.instrument !== 'B') {
        return jsonOutput_({ ok: false, error: 'invalid instrument' });
      }
      var result = submitResponse(body.instrument, body.values || {});
      return jsonOutput_(result);
    }
    return jsonOutput_({ ok: false, error: 'unknown action: ' + body.action });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
/** Columns the client writes that are not questions in the instrument:
 * the routing-gate disposition. Appended AFTER every question column so
 * adding them never shifts existing data in a sheet that already has
 * rows. */
var EXTRA_COLUMNS = [
  ['INTERVIEW_COMPLETION', 'Interview completion (auto: set when a routing rule ended the interview)'],
  ['INTERVIEW_TERMINATION_REASON', 'Reason the interview was ended early (auto)'],
  ['CLIENT_SUBMISSION_ID', 'Idempotency key generated on the device (auto: prevents duplicate rows on retry)']
];

/** Row number of an already-stored submission carrying this client id, or
 * 0 if there is none.
 *
 * Every failed submit is queued on the device and retried, including one
 * that actually reached the Sheet but whose reply was lost on the way
 * back — a common outcome on a weak rural connection, and more likely
 * still when several encoders submit at the same instant and contend for
 * the script lock. Without this check the retry appends the same
 * interview a second time under a second response number. */
function findClientSubmission_(sheet, columns, clientId) {
  if (!clientId) return 0;
  var offset = 0;
  for (var i = 0; i < columns.length; i++) {
    if (columns[i][0] === 'CLIENT_SUBMISSION_ID') { offset = i + 4; break; }  // 3 leading cols, 1-based
  }
  if (!offset) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 3) return 0;                                   // 2 header rows
  var existing = sheet.getRange(3, offset, lastRow - 2, 1).getValues();
  for (var r = 0; r < existing.length; r++) {
    if (existing[r][0] && String(existing[r][0]) === String(clientId)) return 3 + r;
  }
  return 0;
}

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
  EXTRA_COLUMNS.forEach(function (c) { cols.push([c[0], c[1]]); });
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

    // Same interview submitted twice? Return what was stored the first
    // time instead of appending it again.
    var dupRow = findClientSubmission_(sheet, columns, values['CLIENT_SUBMISSION_ID']);
    if (dupRow) {
      var prior = sheet.getRange(dupRow, 1, 1, 2).getValues()[0];
      return { ok: true, submissionId: prior[0], responseNo: prior[1], duplicate: true };
    }

    var responseNo = nextResponseNumber_(sheet, instrumentKey);
    var submissionId = Utilities.getUuid();
    var submittedAt = new Date();
    var row = [submissionId, responseNo, submittedAt].concat(columns.map(function (c) {
      var v = values[c[0]];
      return (v === undefined || v === null) ? '' : v;
    }));
    sheet.appendRow(row);
    return { ok: true, submissionId: submissionId, responseNo: responseNo };
  } finally {
    lock.releaseLock();
  }
}

/** Sequential, human-readable primary key per instrument, e.g.
 * "AGRISENSO-A-00001". Computed under the same script lock that guards
 * the append, so numbering stays gap-free and collision-free even with
 * concurrent submissions. Row count excludes the 2 frozen header rows. */
function nextResponseNumber_(sheet, instrumentKey) {
  var lastRow = sheet.getLastRow();
  var n = Math.max(0, lastRow - 2) + 1;
  var prefix = instrumentKey === 'A' ? 'AGRISENSO-A' : 'AGRISENSO-B';
  return prefix + '-' + ('00000' + n).slice(-5);
}

function ensureHeaders_(sheet, columns) {
  var ids = ['submission_id', 'response_no', 'submitted_at'].concat(columns.map(function (c) { return c[0]; }));
  var existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), ids.length)).getValues()[0]
    : [];
  var matches = existing.length === ids.length && ids.every(function (id, i) { return existing[i] === id; });
  if (!matches) {
    var labels = ['submission_id', 'response_no (auto-generated primary no.)', 'submitted_at (server time)']
      .concat(columns.map(function (c) { return c[1]; }));
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
