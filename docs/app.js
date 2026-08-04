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

  var AUTO_NA = 'N/A (auto \u2014 not applicable based on your answer above)';

  function conditionMet(cond) {
    return (state.answers[cond.field] || '') === cond.equals;
  }

  function setFieldEnabled(wrap, enabled) {
    wrap.querySelectorAll('input, select, textarea').forEach(function (el) { el.disabled = !enabled; });
  }

  function clearFieldUI(wrap) {
    wrap.querySelectorAll('input[type=radio], input[type=checkbox]').forEach(function (el) { el.checked = false; });
    wrap.querySelectorAll('input[type=text], input[type=date], input[type=time], input[type=month], input[type=number], textarea')
      .forEach(function (el) { el.value = ''; });
    wrap.querySelectorAll('select').forEach(function (el) { el.value = ''; });
  }

  /** Wires up "Ask only if..." conditional fields for the currently
   * rendered section: when the referenced field's answer doesn't match
   * the condition, the dependent field is automatically grayed out,
   * disabled, and filled with N/A — no manual click needed. If the
   * dependency's answer later changes so the condition is met, the field
   * re-enables and clears back to blank so it can be genuinely answered.
   * Runs once immediately (covers drafts/back-navigation) and again on
   * every change/input inside the section. */
  function wireConditions(section) {
    var conditionalFields = [];
    section.questions.forEach(function (q) {
      q.fields.forEach(function (f) { if (f.condition) conditionalFields.push(f); });
    });
    if (!conditionalFields.length) return;

    function reconcile() {
      conditionalFields.forEach(function (f) {
        var isMatrix = f.type === 'matrix';
        var selector = isMatrix
          ? '[data-matrix-field="' + cssEscape(f.field_id) + '"]'
          : '[data-field-id="' + cssEscape(f.field_id) + '"]';
        var wrap = document.querySelector(selector);
        if (!wrap) return;
        var met = conditionMet(f.condition);
        var currentlyGrayed = wrap.classList.contains('field-grayed');
        var cellIds = isMatrix ? matrixCellIdList(f) : [f.field_id];

        if (met) {
          if (currentlyGrayed) {
            wrap.classList.remove('field-grayed');
            setFieldEnabled(wrap, true);
            cellIds.forEach(function (id) {
              if (state.answers[id] === AUTO_NA) state.answers[id] = '';
            });
            clearFieldUI(wrap);
            saveDraft();
          }
        } else {
          if (!currentlyGrayed) {
            wrap.classList.add('field-grayed');
            clearFieldUI(wrap);
            setFieldEnabled(wrap, false);
          }
          cellIds.forEach(function (id) {
            if (state.answers[id] !== AUTO_NA) setAnswer(id, AUTO_NA);
          });
        }
      });
    }

    app.addEventListener('change', reconcile);
    app.addEventListener('input', reconcile);
    reconcile();
  }

  // ---------------------------------------------------------------
  // Location cascade: Region -> Province -> City/Municipality ->
  // Barangay, backed by the free PSGC API (psgc.gitlab.io). This is a
  // pure enhancement: Province/Municipality/Barangay already work as
  // plain text fields with example hints (see buildTextField), so if the
  // API is unreachable, slow, or returns something unexpected at any
  // step, that step's field simply stays as-is — the form is never
  // blocked on this. Only Region itself (a small, fixed, offline list)
  // is authoritative and always available.
  // ---------------------------------------------------------------
  var PSGC_BASE = 'https://psgc.gitlab.io/api';
  var psgcRegionCodeCache = null;

  function psgcName(item) {
    return item.name || item.regionName || item.provinceName || item.cityName
      || item.municipalityName || item.brgyName || item.districtName || '';
  }
  function psgcCode(item) {
    return item.code || item.regionCode || item.provinceCode || item.cityCode
      || item.municipalityCode || item.brgyCode || item.psgc10DigitCode || '';
  }
  function psgcFetch(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      if (!Array.isArray(data) || !data.length) throw new Error('empty or unexpected response');
      return data;
    });
  }

  /** Swaps a plain text field's input for a populated <select>, keeping
   * the same wrap element (and its data-field-id) so validation and
   * highlighting keep working unchanged. Returns the new <select>, or
   * null if the wrap isn't in its plain-text state (already swapped, or
   * missing). */
  function swapToLocationSelect(wrap, items, placeholderText, onPick) {
    if (!wrap) return null;
    var existingInput = wrap.querySelector('input.input-text');
    if (!existingInput) return null;

    var selWrap = el('div', 'select-wrap');
    var select = document.createElement('select');
    select.className = 'input-select';
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholderText;
    ph.disabled = true;
    ph.selected = true;
    select.appendChild(ph);
    items.forEach(function (it) {
      var name = psgcName(it);
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      opt.setAttribute('data-psgc-code', psgcCode(it));
      select.appendChild(opt);
    });

    var fieldId = wrap.getAttribute('data-field-id');
    select.addEventListener('change', function () {
      setAnswer(fieldId, select.value);
      var opt = select.options[select.selectedIndex];
      if (onPick) onPick(opt.getAttribute('data-psgc-code'), select.value);
    });

    existingInput.replaceWith(selWrap);
    selWrap.appendChild(select);
    return select;
  }

  function ensureRegionCodeMap() {
    if (psgcRegionCodeCache) return Promise.resolve(psgcRegionCodeCache);
    return psgcFetch(PSGC_BASE + '/regions/').then(function (list) {
      var map = {};
      list.forEach(function (r) { map[psgcName(r).toLowerCase()] = psgcCode(r); });
      psgcRegionCodeCache = map;
      return map;
    });
  }

  // Distinctive tokens per region that should appear in the live API's
  // name however it happens to punctuate/format it (e.g. "Region III
  // (Central Luzon)" vs "Region III - Central Luzon" vs "Central Luzon").
  // Keyed by the exact display strings used in the Region dropdown.
  var REGION_MATCH_TOKENS = {
    'National Capital Region (NCR)': ['ncr', 'national capital'],
    'Cordillera Administrative Region (CAR)': ['car', 'cordillera'],
    'Region I \u2013 Ilocos Region': ['region i', 'ilocos'],
    'Region II \u2013 Cagayan Valley': ['region ii', 'cagayan valley'],
    'Region III \u2013 Central Luzon': ['region iii', 'central luzon'],
    'Region IV-A \u2013 CALABARZON': ['iv-a', 'iva', 'calabarzon'],
    'MIMAROPA Region': ['mimaropa'],
    'Region V \u2013 Bicol Region': ['region v', 'bicol'],
    'Region VI \u2013 Western Visayas': ['region vi', 'western visayas'],
    'Region VII \u2013 Central Visayas': ['region vii', 'central visayas'],
    'Region VIII \u2013 Eastern Visayas': ['region viii', 'eastern visayas'],
    'Region IX \u2013 Zamboanga Peninsula': ['region ix', 'zamboanga'],
    'Region X \u2013 Northern Mindanao': ['region x', 'northern mindanao'],
    'Region XI \u2013 Davao Region': ['region xi', 'davao'],
    'Region XII \u2013 SOCCSKSARGEN': ['region xii', 'soccsksargen', 'soccsksargen'],
    'Region XIII \u2013 Caraga': ['region xiii', 'caraga'],
    'Negros Island Region (NIR)': ['nir', 'negros island'],
    'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)': ['barmm', 'bangsamoro'],
  };

  function findRegionCode(displayName, map) {
    var target = displayName.toLowerCase();
    if (map[target]) return map[target];
    var tokens = REGION_MATCH_TOKENS[displayName] || [target];
    for (var k in map) {
      if (!map.hasOwnProperty(k)) continue;
      for (var i = 0; i < tokens.length; i++) {
        if (k.indexOf(tokens[i]) !== -1) return map[k];
      }
    }
    return null;
  }

  function enhanceLocationCascade() {
    var regionWrap = document.querySelector('[data-field-id="A1_1"]');
    var provinceWrap = document.querySelector('[data-field-id="A1_2"]');
    var cityWrap = document.querySelector('[data-field-id="A1_3"]');
    var brgyWrap = document.querySelector('[data-field-id="A1_4"]');
    if (!regionWrap || !provinceWrap || !cityWrap || !brgyWrap) return; // not this section

    var regionSelect = regionWrap.querySelector('select.input-select');
    if (!regionSelect) return;

    function onCitySelected(cityCode) {
      if (!cityCode) return;
      psgcFetch(PSGC_BASE + '/cities-municipalities/' + cityCode + '/barangays/')
        .then(function (brgys) {
          swapToLocationSelect(brgyWrap, brgys, 'Select a barangay\u2026');
        })
        .catch(function () { /* leave barangay as free text */ });
    }

    function onProvinceSelected(provinceCode) {
      if (!provinceCode) return;
      psgcFetch(PSGC_BASE + '/provinces/' + provinceCode + '/cities-municipalities/')
        .then(function (cities) {
          swapToLocationSelect(cityWrap, cities, 'Select a municipality/city\u2026', function (cityCode) {
            onCitySelected(cityCode);
          });
        })
        .catch(function () { /* leave city/municipality as free text */ });
    }

    regionSelect.addEventListener('change', function () {
      var regionName = regionSelect.value;
      if (!regionName) return;
      ensureRegionCodeMap()
        .then(function (map) {
          var code = findRegionCode(regionName, map);
          if (!code) throw new Error('no matching region code');
          return psgcFetch(PSGC_BASE + '/regions/' + code + '/provinces/');
        })
        .then(function (provinces) {
          swapToLocationSelect(provinceWrap, provinces, 'Select a province\u2026', function (provinceCode) {
            onProvinceSelected(provinceCode);
          });
        })
        .catch(function () {
          // Region has no provinces (e.g. NCR) or the API is unreachable —
          // Province/Municipality/Barangay simply stay as free text with
          // their example hints. Nothing more to do.
        });
    });
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

    wireConditions(section);
    enhanceLocationCascade();

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
      case 'date': return buildPickerField(field, 'date');
      case 'time': return buildPickerField(field, 'time');
      case 'month': return buildPickerField(field, 'month');
      case 'number': return buildPickerField(field, 'number');
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
    input.placeholder = field.hint ? field.hint + ' \u2014 or N/A if not applicable' : 'Type your answer (or N/A if not applicable)';
    input.value = state.answers[field.field_id] || '';
    input.addEventListener('input', function () { setAnswer(field.field_id, input.value); });
    wrap.appendChild(input);
    return wrap;
  }

  /** Native date/time/month/number pickers — these give a fixed,
   * unambiguous format (the browser handles locale display, and numeric
   * fields reject non-numeric keystrokes / show a numeric keypad on
   * mobile) instead of free-typed answers that are easy to mistype or
   * misread. An explicit "Not applicable" checkbox stands in for the
   * usual N/A text, since none of these input types can literally hold
   * the string "N/A". */
  function buildPickerField(field, kind) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(el('label', 'field-label', field.label));

    var row = el('div', 'datetime-row');
    var input = document.createElement('input');
    input.type = kind;
    input.className = 'input-text input-datetime';
    if (kind === 'number') {
      input.step = 'any';
      input.min = '0';
      input.inputMode = 'decimal';
      input.placeholder = field.hint || '0';
    }
    var saved = state.answers[field.field_id] || '';
    var isNA = saved === 'N/A';
    if (saved && !isNA) input.value = saved;
    input.disabled = isNA;
    input.addEventListener('input', function () { setAnswer(field.field_id, input.value); });
    row.appendChild(input);

    var naLabelWrap = el('label', 'na-checkbox');
    var naCheck = document.createElement('input');
    naCheck.type = 'checkbox';
    naCheck.checked = isNA;
    naCheck.addEventListener('change', function () {
      input.disabled = naCheck.checked;
      if (naCheck.checked) {
        input.value = '';
        setAnswer(field.field_id, 'N/A');
      } else {
        setAnswer(field.field_id, input.value);
      }
    });
    naLabelWrap.appendChild(naCheck);
    naLabelWrap.appendChild(document.createTextNode(' N/A'));
    row.appendChild(naLabelWrap);

    wrap.appendChild(row);
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
