// =====================================================================
// AGRISENSO Plus Baseline Survey — static site client
// Talks to the Apps Script backend (APPS_SCRIPT_URL, set in config.js)
// as a JSON API instead of google.script.run.
// =====================================================================
(function () {
  var TAB_NAMES = { A: 'Instrument_A_Borrowers', B: 'Instrument_B_NonBorrowers' };
  var INSTRUMENT_TITLES = {
    A: 'Instrument A \u2014 AGRISENSO Plus Borrowers',
    B: 'Instrument B \u2014 Non-Borrower Comparison Group'
  };

  var state = {
    instrument: null,
    schema: null,
    sectionIndex: 0,
    answers: {},
    fieldRefs: {}
  };

  var app = document.getElementById('app');
  var progressEl = document.getElementById('progressText');
  var rowsProgressEl = document.getElementById('rowsProgress');
  var navbar = document.getElementById('navbar');
  var prevBtn = document.getElementById('prevBtn');
  var nextBtn = document.getElementById('nextBtn');
  var submitBtn = document.getElementById('submitBtn');
  var syncBtn = document.getElementById('syncBtn');
  var menuBtn = document.getElementById('menuBtn');
  var statusBar = document.getElementById('statusBar');
  var spinner = document.getElementById('spinner');

  function backendConfigured() {
    return typeof APPS_SCRIPT_URL === 'string' &&
      APPS_SCRIPT_URL.indexOf('PASTE_YOUR') === -1 &&
      APPS_SCRIPT_URL.indexOf('http') === 0;
  }

  // ---------------------------------------------------------------
  // API calls
  // ---------------------------------------------------------------
  function apiGetSchema(key) {
    var url = APPS_SCRIPT_URL + '?action=schema&instrument=' + encodeURIComponent(key)
      + '&_=' + Date.now(); // cache-bust
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiSubmit(instrumentKey, values) {
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight that Apps Script can't answer;
      // the body is still parsed as JSON on the server.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'submit', instrument: instrumentKey, values: values })
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (res) {
      if (!res.ok) throw new Error(res.error || 'Unknown server error');
      return res;
    });
  }

  // ---------------------------------------------------------------
  // DOM / small helpers
  // ---------------------------------------------------------------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function slug(s, n) {
    n = n || 30;
    var out = String(s).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return out.substring(0, n) || 'x';
  }

  function optionDisplay(opt) {
    var needsSpecify = /_{3,}/.test(opt) || /\bother\b|\bspecify\b/i.test(opt);
    var text = opt.replace(/_{3,}/g, '').trim().replace(/:$/, '').trim();
    if (!text) text = 'Other';
    return { text: text, needsSpecify: needsSpecify };
  }

  function isNumericMatrix(columns) {
    var combined = columns.slice(1).join(' ').toLowerCase();
    return ['%', 'number', 'area', 'amount', 'unit', 'classification'].some(function (k) {
      return combined.indexOf(k) !== -1;
    });
  }

  var NA_LABEL = 'N/A \u2014 Not applicable (per skip instructions)';

  /** Every choice-type field automatically gets an N/A option (unless it
   * already has an equivalent one) so a question that legitimately doesn't
   * apply to this respondent can still be answered \u2014 "required" never
   * means "force an answer that doesn't make sense". */
  function withNA(options) {
    var hasNA = options.some(function (o) { return /not applicable|\bn\.?\/?a\.?\b/i.test(o); });
    return hasNA ? options : options.concat([NA_LABEL]);
  }

  function matrixCellIdList(field) {
    var numeric = isNumericMatrix(field.columns);
    var ids = [];
    field.rows.forEach(function (rowLabel) {
      var rslug = slug(rowLabel);
      if (numeric) {
        field.columns.slice(1).forEach(function (c) { ids.push(field.field_id + '__' + rslug + '__' + slug(c)); });
      } else {
        ids.push(field.field_id + '__' + rslug);
      }
    });
    return ids;
  }

  /** All answer-key IDs a section expects \u2014 one per field, or one per
   * matrix cell/row. Pure function of the schema (no DOM), so it can be
   * used to validate any section regardless of what's currently rendered. */
  function sectionFieldIds(section) {
    var ids = [];
    section.questions.forEach(function (q) {
      q.fields.forEach(function (field) {
        if (field.type === 'matrix') {
          matrixCellIdList(field).forEach(function (id) { ids.push(id); });
        } else {
          ids.push(field.field_id);
        }
      });
    });
    return ids;
  }

  /** IDs in this section with no non-blank answer yet. */
  function validateSection(idx) {
    var section = state.schema.sections[idx];
    return sectionFieldIds(section).filter(function (id) {
      return !state.answers[id] || !String(state.answers[id]).trim();
    });
  }

  /** Scans every section in document order; returns the first one with
   * unanswered fields, or null if the whole response is complete. */
  function validateAll() {
    for (var i = 0; i < state.schema.sections.length; i++) {
      var missing = validateSection(i);
      if (missing.length) return { sectionIndex: i, missing: missing };
    }
    return null;
  }

  function clearHighlights() {
    document.querySelectorAll('.field-missing').forEach(function (el) { el.classList.remove('field-missing'); });
  }

  function highlightMissing(missingIds) {
    clearHighlights();
    var missingSet = {};
    missingIds.forEach(function (id) { missingSet[id] = true; });
    document.querySelectorAll('[data-field-id]').forEach(function (w) {
      if (missingSet[w.getAttribute('data-field-id')]) w.classList.add('field-missing');
    });
    document.querySelectorAll('[data-matrix-field]').forEach(function (w) {
      var cellIds = JSON.parse(w.getAttribute('data-cell-ids') || '[]');
      if (cellIds.some(function (id) { return missingSet[id]; })) w.classList.add('field-missing');
    });
    var first = document.querySelector('.field-missing');
    if (first && typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setStatus(msg, ok) {
    statusBar.textContent = msg;
    statusBar.className = 'show' + (ok === true ? ' ok' : ok === 'error' ? ' err' : '');
    if (!msg) statusBar.classList.remove('show');
  }

  function showSpinner(on) { spinner.classList.toggle('show', !!on); }

  function setAnswer(id, value) {
    state.answers[id] = value;
    saveDraft();
    if (String(value).trim()) {
      var w = document.querySelector('[data-field-id="' + cssEscape(id) + '"]');
      if (w) w.classList.remove('field-missing');
      document.querySelectorAll('[data-matrix-field]').forEach(function (mw) {
        var cellIds = JSON.parse(mw.getAttribute('data-cell-ids') || '[]');
        if (cellIds.indexOf(id) !== -1) {
          var stillMissing = cellIds.some(function (cid) { return !state.answers[cid] || !String(state.answers[cid]).trim(); });
          if (!stillMissing) mw.classList.remove('field-missing');
        }
      });
    }
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // ---------------------------------------------------------------
  // localStorage: drafts, permanent backup, offline queue
  // ---------------------------------------------------------------
  function draftKey() { return 'agrisenso_draft_' + state.instrument; }
  function backupKey() { return 'agrisenso_backup_' + state.instrument; }
  function pendingKey() { return 'agrisenso_pending_' + state.instrument; }

  function saveDraft() {
    try { localStorage.setItem(draftKey(), JSON.stringify(state.answers)); } catch (e) {}
  }
  function loadDraft() {
    try { var raw = localStorage.getItem(draftKey()); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }
  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (e) {}
  }
  function appendToArray(key, item) {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    arr.push(item);
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    return arr;
  }
  function readArray(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }
  function writeArray(key, arr) {
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
  }
  function pendingCount(instrumentKey) {
    return readArray('agrisenso_pending_' + instrumentKey).length;
  }

  // ---------------------------------------------------------------
  // Chooser screen
  // ---------------------------------------------------------------
  function renderChooser() {
    navbar.style.display = 'none';
    progressEl.textContent = '';
    rowsProgressEl.innerHTML = '';
    setStatus('');
    app.innerHTML = '';

    var wrap = el('div', 'chooser');
    wrap.appendChild(el('div', 'hero-banner'));

    if (!backendConfigured()) {
      var note = el('div', 'setup-note');
      note.innerHTML = 'This site is not yet connected to your Google Sheets backend. ' +
        'Open <code>docs/config.js</code>, paste in your deployed Apps Script Web app URL, ' +
        'and republish. See README.md &ldquo;Deploy the backend&rdquo;.';
      wrap.appendChild(note);
    }

    var card = el('div', 'card');
    card.appendChild(el('h2', null, 'Select the questionnaire to administer'));
    ['A', 'B'].forEach(function (key) {
      var btn = el('button', 'big', INSTRUMENT_TITLES[key]);
      btn.disabled = !backendConfigured();
      btn.addEventListener('click', function () { startInstrument(key); });
      card.appendChild(btn);
      var n = pendingCount(key);
      if (n) {
        card.appendChild(el('div', 'pending-note', 'Instrument ' + key + ': ' + n + ' response(s) waiting to sync on this device.'));
      }
    });
    wrap.appendChild(card);
    app.appendChild(wrap);
  }

  function startInstrument(key) {
    state.instrument = key;
    state.sectionIndex = 0;
    state.fieldRefs = {};
    showSpinner(true);
    apiGetSchema(key).then(function (schema) {
      showSpinner(false);
      state.schema = schema;
      state.answers = loadDraft();
      var hasDraft = Object.keys(state.answers).some(function (k) { return String(state.answers[k]).trim(); });
      if (hasDraft && !confirm('A saved-in-progress response was found for this instrument on this device. Resume it? (Cancel starts a blank form.)')) {
        state.answers = {};
        clearDraft();
      }
      navbar.style.display = 'flex';
      renderSection(0);
    }).catch(function (err) {
      showSpinner(false);
      alert('Could not load the questionnaire. Check your internet connection and the backend URL in config.js, then try again.\n\n' + err);
    });
  }

  // ---------------------------------------------------------------
  // Section rendering
  // ---------------------------------------------------------------
  function renderRowsProgress(idx, total) {
    rowsProgressEl.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var seg = document.createElement('div');
      seg.className = 'seg' + (i < idx ? ' done' : i === idx ? ' current' : '');
      var fill = document.createElement('span');
      seg.appendChild(fill);
      rowsProgressEl.appendChild(seg);
    }
  }

  function renderSection(idx) {
    state.sectionIndex = idx;
    var section = state.schema.sections[idx];
    app.innerHTML = '';
    app.appendChild(el('div', 'section-title', 'Section ' + section.section_id + ' \u2014 ' + section.title));
    app.appendChild(el('div', 'required-banner',
      'All questions in this survey are required. If a question genuinely doesn\u2019t apply to this respondent, choose the "N/A \u2014 Not applicable" option (or type N/A) rather than leaving it blank.'));

    section.questions.forEach(function (q, qi) {
      var qbox = el('div', 'question');
      qbox.style.animationDelay = Math.min(qi * 40, 280) + 'ms';
      qbox.appendChild(el('h3', null, q.heading));
      if (q.instructions) qbox.appendChild(el('div', 'instructions', q.instructions));
      q.fields.forEach(function (field) { qbox.appendChild(buildField(field)); });
      app.appendChild(qbox);
    });

    progressEl.textContent = 'Instrument ' + state.instrument + ' \u2014 Section ' + (idx + 1) + ' of ' +
      state.schema.sections.length + ': ' + section.title;
    renderRowsProgress(idx, state.schema.sections.length);
    prevBtn.disabled = idx === 0;
    var isLast = idx === state.schema.sections.length - 1;
    nextBtn.style.display = isLast ? 'none' : 'inline-block';
    submitBtn.style.display = isLast ? 'inline-block' : 'none';
    window.scrollTo(0, 0);
  }

  var DROPDOWN_THRESHOLD = 6;

  function buildField(field) {
    switch (field.type) {
      case 'single_choice':
        return field.options.length > DROPDOWN_THRESHOLD ? buildSelectField(field) : buildChoiceField(field);
      case 'multi_choice': return buildChoiceField(field);
      case 'scale_1_5': return buildScaleField(field);
      case 'matrix': return buildMatrixField(field);
      default: return buildTextField(field);
    }
  }

  function buildTextField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(el('label', 'field-label', field.label));
    var long = field.label.length > 70 || /^(why|reason|brief)/i.test(field.label);
    var input = document.createElement(long ? 'textarea' : 'input');
    if (!long) input.type = 'text';
    input.className = 'input-text';
    input.placeholder = 'Type your answer (or N/A if not applicable)';
    input.value = state.answers[field.field_id] || '';
    input.addEventListener('input', function () { setAnswer(field.field_id, input.value); });
    wrap.appendChild(input);
    return wrap;
  }

  function buildChoiceField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(el('label', 'field-label', field.label));
    var isMulti = field.type === 'multi_choice';
    var options = withNA(field.options);
    var group = el('div', 'choice-group');
    var refs = [];
    var savedVal = state.answers[field.field_id] || '';
    var savedSet = isMulti ? savedVal.split('; ').filter(Boolean) : null;

    options.forEach(function (opt, i) {
      var disp = optionDisplay(opt);
      var row = el('div', 'choice-row');
      var input = document.createElement('input');
      input.type = isMulti ? 'checkbox' : 'radio';
      input.name = field.field_id;
      var domId = field.field_id + '_' + i;
      input.id = domId;
      var lbl = document.createElement('label');
      lbl.setAttribute('for', domId);
      lbl.textContent = disp.text;
      row.appendChild(input);
      row.appendChild(lbl);

      var specify = null;
      if (disp.needsSpecify) {
        specify = document.createElement('input');
        specify.type = 'text';
        specify.className = 'specify-input';
        specify.placeholder = 'specify';
        row.appendChild(specify);
      }

      if (isMulti) {
        var match = savedSet.filter(function (s) { return s.indexOf(disp.text) === 0; })[0];
        if (match) {
          input.checked = true;
          if (specify && match.indexOf(': ') > -1) specify.value = match.substring(match.indexOf(': ') + 2);
        }
      } else if (savedVal && savedVal.indexOf(disp.text) === 0) {
        input.checked = true;
        if (specify && savedVal.indexOf(': ') > -1) specify.value = savedVal.substring(savedVal.indexOf(': ') + 2);
      }

      input.addEventListener('change', function () { updateChoiceAnswer(field, isMulti); });
      if (specify) specify.addEventListener('input', function () { updateChoiceAnswer(field, isMulti); });

      refs.push({ input: input, specify: specify, disp: disp });
      group.appendChild(row);
    });

    state.fieldRefs[field.field_id] = { refs: refs, isMulti: isMulti };
    wrap.appendChild(group);
    return wrap;
  }

  function buildSelectField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(el('label', 'field-label', field.label));

    var options = withNA(field.options);
    var savedVal = state.answers[field.field_id] || '';
    var savedDisp = null;

    var selectWrap = el('div', 'select-wrap');
    var select = document.createElement('select');
    select.className = 'input-select';

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select an answer\u2026';
    placeholder.disabled = true;
    select.appendChild(placeholder);

    var dispByValue = {};
    options.forEach(function (opt, i) {
      var disp = optionDisplay(opt);
      dispByValue[disp.text] = disp;
      var o = document.createElement('option');
      o.value = disp.text;
      o.textContent = disp.text;
      select.appendChild(o);
      if (savedVal && savedVal.indexOf(disp.text) === 0) savedDisp = disp;
    });
    placeholder.selected = !savedVal;

    var specify = null;
    if (savedDisp) {
      select.value = savedDisp.text;
      if (savedDisp.needsSpecify) {
        specify = makeSpecifyInput();
        if (savedVal.indexOf(': ') > -1) specify.value = savedVal.substring(savedVal.indexOf(': ') + 2);
      }
    }

    function makeSpecifyInput() {
      var s = document.createElement('input');
      s.type = 'text';
      s.className = 'specify-input';
      s.placeholder = 'specify';
      s.style.marginTop = '8px';
      s.addEventListener('input', updateVal);
      selectWrap.parentNode === wrap && wrap.appendChild(s);
      return s;
    }

    function updateVal() {
      var disp = dispByValue[select.value];
      if (!disp) { setAnswer(field.field_id, ''); return; }
      if (disp.needsSpecify && specify && specify.value.trim()) {
        setAnswer(field.field_id, disp.text + ': ' + specify.value.trim());
      } else {
        setAnswer(field.field_id, disp.text);
      }
    }

    select.addEventListener('change', function () {
      if (specify) { specify.remove(); specify = null; }
      var disp = dispByValue[select.value];
      if (disp && disp.needsSpecify) specify = makeSpecifyInput();
      updateVal();
    });

    selectWrap.appendChild(select);
    wrap.appendChild(selectWrap);
    if (specify) wrap.appendChild(specify);
    return wrap;
  }

  function updateChoiceAnswer(field, isMulti) {
    var refs = state.fieldRefs[field.field_id].refs;
    if (isMulti) {
      var chosen = [];
      refs.forEach(function (r) {
        if (r.input.checked) {
          if (r.disp.needsSpecify && r.specify && r.specify.value.trim()) {
            chosen.push(r.disp.text + ': ' + r.specify.value.trim());
          } else {
            chosen.push(r.disp.text);
          }
        }
      });
      setAnswer(field.field_id, chosen.join('; '));
    } else {
      var picked = null;
      refs.forEach(function (r) { if (r.input.checked) picked = r; });
      if (!picked) { setAnswer(field.field_id, ''); return; }
      if (picked.disp.needsSpecify && picked.specify && picked.specify.value.trim()) {
        setAnswer(field.field_id, picked.disp.text + ': ' + picked.specify.value.trim());
      } else {
        setAnswer(field.field_id, picked.disp.text);
      }
    }
  }

  function buildScaleField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(el('label', 'field-label', field.label));
    var row = el('div', 'scale-row');
    var saved = state.answers[field.field_id] || '';
    var values = ['1', '2', '3', '4', '5', 'N/A'];
    values.forEach(function (v) {
      var domId = field.field_id + '_s' + v;
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = field.field_id;
      input.id = domId;
      input.value = v;
      if (saved === v) input.checked = true;
      input.addEventListener('change', function () {
        var picked = row.querySelector('input[name="' + field.field_id + '"]:checked');
        setAnswer(field.field_id, picked ? picked.value : '');
      });
      var lbl = document.createElement('label');
      lbl.setAttribute('for', domId);
      lbl.textContent = v;
      row.appendChild(input);
      row.appendChild(lbl);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function buildMatrixField(field) {
    var wrap = el('div', 'field');
    var cellIds = matrixCellIdList(field);
    wrap.setAttribute('data-matrix-field', field.field_id);
    wrap.setAttribute('data-cell-ids', JSON.stringify(cellIds));
    wrap.appendChild(el('label', 'field-label bold', field.label));

    var numeric = isNumericMatrix(field.columns);
    var table = document.createElement('table');
    table.className = 'matrix';

    if (numeric) {
      var valueCols = field.columns.slice(1);
      var thead = document.createElement('tr');
      thead.appendChild(document.createElement('th'));
      valueCols.forEach(function (c) {
        var th = document.createElement('th'); th.textContent = c; thead.appendChild(th);
      });
      table.appendChild(thead);

      field.rows.forEach(function (rowLabel) {
        var tr = document.createElement('tr');
        var td0 = document.createElement('td'); td0.textContent = rowLabel; tr.appendChild(td0);
        var rslug = slug(rowLabel);
        valueCols.forEach(function (c) {
          var cellId = field.field_id + '__' + rslug + '__' + slug(c);
          var td = document.createElement('td');
          var input = document.createElement('input');
          input.type = 'text';
          input.className = 'input-text';
          input.placeholder = 'N/A if none';
          input.value = state.answers[cellId] || '';
          input.addEventListener('input', function () { setAnswer(cellId, input.value); });
          td.appendChild(input);
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
    } else {
      var choices = withNA(field.columns.slice(1));
      field.rows.forEach(function (rowLabel) {
        var tr = document.createElement('tr');
        var td0 = document.createElement('td'); td0.textContent = rowLabel; tr.appendChild(td0);
        var tdChoices = document.createElement('td');
        var rowWrap = el('div', 'choice-row');
        var rslug = slug(rowLabel);
        var cellId = field.field_id + '__' + rslug;
        var saved = state.answers[cellId] || '';
        choices.forEach(function (c, i) {
          var domId = cellId + '_' + i;
          var input = document.createElement('input');
          input.type = 'radio';
          input.name = cellId;
          input.id = domId;
          input.value = c;
          if (saved === c) input.checked = true;
          input.addEventListener('change', function () { setAnswer(cellId, c); });
          var l = document.createElement('label');
          l.setAttribute('for', domId);
          l.textContent = c;
          rowWrap.appendChild(input);
          rowWrap.appendChild(l);
        });
        tdChoices.appendChild(rowWrap);
        tr.appendChild(tdChoices);
        table.appendChild(tr);
      });
    }

    wrap.appendChild(table);
    return wrap;
  }

  // ---------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------
  prevBtn.addEventListener('click', function () {
    if (state.sectionIndex > 0) { clearHighlights(); renderSection(state.sectionIndex - 1); }
  });
  nextBtn.addEventListener('click', function () {
    var missing = validateSection(state.sectionIndex);
    if (missing.length) {
      highlightMissing(missing);
      setStatus(missing.length + ' question(s) on this page still need an answer \u2014 highlighted in red below. Use N/A where a question doesn\u2019t apply.', 'error');
      return;
    }
    setStatus('');
    if (state.sectionIndex < state.schema.sections.length - 1) renderSection(state.sectionIndex + 1);
  });
  menuBtn.addEventListener('click', function () {
    if (confirm('Leave this response and return to the menu? Your progress is auto-saved on this device and you can resume later.')) {
      renderChooser();
    }
  });

  // ---------------------------------------------------------------
  // Submit + offline sync
  // ---------------------------------------------------------------
  submitBtn.addEventListener('click', function () {
    var problem = validateAll();
    if (problem) {
      if (problem.sectionIndex !== state.sectionIndex) renderSection(problem.sectionIndex);
      highlightMissing(problem.missing);
      var sectionTitle = state.schema.sections[problem.sectionIndex].title;
      setStatus(problem.missing.length + ' question(s) in "' + sectionTitle + '" still need an answer before this response can be submitted \u2014 highlighted in red below.', 'error');
      return;
    }

    var payload = { instrument: state.instrument, values: JSON.parse(JSON.stringify(state.answers)) };
    submitBtn.disabled = true;
    showSpinner(true);

    apiSubmit(state.instrument, payload.values).then(function (res) {
      showSpinner(false);
      submitBtn.disabled = false;
      appendToArray(backupKey(), payload);
      clearDraft();
      setStatus('Response ' + (res && res.responseNo ? res.responseNo + ' ' : '') + 'submitted to Google Sheets.', true);
      afterSubmit();
    }).catch(function (err) {
      showSpinner(false);
      submitBtn.disabled = false;
      appendToArray(backupKey(), payload);
      appendToArray(pendingKey(), payload);
      clearDraft();
      setStatus('No connection \u2014 response saved on this device and queued to sync later.', false);
      afterSubmit();
    });
  });

  function afterSubmit() {
    if (confirm('Start a new response for this instrument?')) {
      state.answers = {};
      state.fieldRefs = {};
      renderSection(0);
    } else {
      renderChooser();
    }
  }

  syncBtn.addEventListener('click', syncPending);

  function syncPending() {
    var queue = readArray(pendingKey());
    if (!queue.length) { setStatus('Nothing pending for this instrument.', true); return; }
    showSpinner(true);
    var remaining = [];
    var synced = 0;

    function next(i) {
      if (i >= queue.length) {
        writeArray(pendingKey(), remaining);
        showSpinner(false);
        setStatus('Synced ' + synced + ' response(s). ' + remaining.length + ' still pending.', remaining.length === 0);
        return;
      }
      var item = queue[i];
      apiSubmit(item.instrument, item.values)
        .then(function () { synced++; next(i + 1); })
        .catch(function () { remaining.push(item); next(i + 1); });
    }
    next(0);
  }

  // ---------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------
  renderChooser();
})();
