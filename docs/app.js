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
  var jumpBtn = document.getElementById('jumpBtn');
  var jumpSheet = document.getElementById('jumpSheet');
  var jumpList = document.getElementById('jumpList');
  var jumpClose = document.getElementById('jumpClose');
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

  /** A field's label, with a required-asterisk only for the small curated
   * set of hard-gate fields — not a blanket marker on everything. */
  function buildFieldLabel(field, extraClass) {
    var lbl = el('label', 'field-label' + (extraClass ? ' ' + extraClass : ''));
    lbl.appendChild(document.createTextNode(field.label));
    if (field.required) {
      var star = el('span', 'required-star', ' *');
      lbl.appendChild(star);
    }
    return lbl;
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

  /** Required-field IDs a section expects — only fields explicitly marked
   * required in the schema (a short, curated hard-gate list: consent,
   * eligibility screening, region, borrower type, age, language,
   * interview mode), not a blanket rule. A field currently grayed out by
   * an unmet condition is never required — it doesn't apply right now. */
  function sectionRequiredIds(section) {
    var ids = [];
    section.questions.forEach(function (q) {
      q.fields.forEach(function (field) {
        if (!field.required) return;
        if (field.conditions && !allConditionsMet(field.conditions)) return;
        if (field.type === 'matrix') {
          matrixCellIdList(field).forEach(function (id) { ids.push(id); });
        } else {
          ids.push(field.field_id);
        }
      });
    });
    return ids;
  }

  /** IDs among a section's required fields with no non-blank answer yet. */
  function validateSection(idx) {
    var section = state.schema.sections[idx];
    return sectionRequiredIds(section).filter(function (id) {
      return !state.answers[id] || !String(state.answers[id]).trim();
    });
  }

  /** Scans every section in document order; returns the first one with
   * unanswered required fields, or null if the whole response is complete. */
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

  var AUTO_NA = 'N/A (not applicable based on a prior answer)';

  /** A field's `conditions` is a list of AND-combined clauses, each either
   * {field, in: [...]} (referenced field's answer must be one of these) or
   * {field, notEmpty:true} / {field, empty:true} (presence-based — used
   * for "exact amount given, so the fallback range question doesn't
   * apply" style mutual exclusivity). */
  function answerValues(id) {
    var val = state.answers[id];
    if (val === undefined || val === null) return [];
    var s = String(val).trim();
    if (!s || s === AUTO_NA) return [];
    // Multi-selects are stored as "A; B; C" — a condition asking whether
    // one particular option was ticked has to look inside that list, not
    // compare against the whole joined string.
    return s.split('; ').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function oneConditionMet(cond) {
    var vals = answerValues(cond.field);
    var has = vals.length > 0;
    if (cond.notEmpty) return has;
    if (cond.empty) return !has;
    if (cond.containsAny) {
      return vals.some(function (v) { return cond.containsAny.indexOf(v) !== -1; });
    }
    if (cond.in) {
      // Single-select: the stored answer must be one of the listed
      // options. "Other: ___" is stored as its display text ("Other"),
      // and the schema pipeline normalises condition values the same way.
      return vals.length === 1 && cond.in.indexOf(vals[0]) !== -1;
    }
    return true;
  }
  function allConditionsMet(conditions) {
    return (conditions || []).every(oneConditionMet);
  }

  /** Plain-language reason a field is currently skipped, naming the
   * question and answer responsible. Reviewers and field testers both
   * reported fields that "won't accept answers" — the field was correctly
   * skipped, but nothing on screen said why or what to change. */
  function skipReason(conditions) {
    var parts = [];
    (conditions || []).forEach(function (cond) {
      if (oneConditionMet(cond)) return;
      var label = questionLabelFor(cond.field);
      var vals = answerValues(cond.field);
      if (cond.notEmpty || cond.containsAny || cond.in) {
        if (!vals.length) {
          parts.push('answer ' + label + ' first');
        } else {
          parts.push('your answer to ' + label + ' (' + vals.join(', ') + ') means this does not apply');
        }
      } else if (cond.empty) {
        parts.push('you already answered ' + label + ' (' + vals.join(', ') + ')');
      }
    });
    if (!parts.length) return 'Not applicable based on an earlier answer.';
    return 'Skipped \u2014 ' + parts.join('; ') + '.';
  }

  /** "C21. Major Shocks" for a field id, for use in skip explanations.
   * Backed by a map built once per instrument — this is called for every
   * unmet condition on every keystroke, and re-scanning all 14 sections
   * each time made Section C visibly laggy on a low-end tablet. */
  function questionLabelFor(fieldId) {
    if (!state.schema) return fieldId;
    if (!state.labelMap) {
      var map = {};
      state.schema.sections.forEach(function (s) {
        s.questions.forEach(function (q) {
          var label = ITEM_CODE_RE.test(q.qid) ? (q.qid + '. ' + q.heading) : q.heading;
          q.fields.forEach(function (f) { map[f.field_id] = label; });
        });
      });
      state.labelMap = map;
    }
    return state.labelMap[fieldId] || fieldId;
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

  /** Wires up every conditional field in the currently rendered section:
   * when its condition(s) aren't met, it's automatically grayed out,
   * disabled, and filled with N/A — no manual click needed. If the
   * dependency's answer later changes so the condition becomes met, the
   * field re-enables and clears back to blank so it can be genuinely
   * answered. Runs once immediately (covers drafts/back-navigation) and
   * again on every change/input inside the section. */
  /** When every field in a question is skipped, the whole group collapses
   * to a single line. Routing that leaves 33 greyed-out questions on
   * screen, each with its own explanation, does not actually shorten the
   * interview — a trader was still scrolling through the entire farm
   * block to reach the questions that applied to them. */
  /** Same caching rationale as wrapFor: this runs on every keystroke. */
  function qboxFor(qid) {
    var cache = state.qboxCache || (state.qboxCache = {});
    if (qid in cache) {
      var cached = cache[qid];
      if (cached === null || cached.isConnected) return cached;
    }
    cache[qid] = document.querySelector('.question[data-qid="' + cssEscape(qid) + '"]');
    return cache[qid];
  }

  function collapseSkippedQuestions(section) {
    section.questions.forEach(function (q) {
      if (!q.fields.length) return;
      var qbox = qboxFor(q.qid);
      if (!qbox) return;
      var wraps = q.fields.map(function (f) {
        return wrapFor(f.field_id, f.type === 'matrix');
      }).filter(Boolean);
      if (!wraps.length) return;
      var allSkipped = wraps.every(function (w) { return w.classList.contains('field-grayed'); });
      qbox.classList.toggle('question-skipped', allSkipped);
      var summary = qbox.querySelector('.question-skip-summary');
      if (allSkipped) {
        var reason = '';
        for (var i = 0; i < q.fields.length && !reason; i++) {
          if (q.fields[i].conditions) reason = skipReason(q.fields[i].conditions);
        }
        if (!summary) {
          summary = el('div', 'question-skip-summary');
          qbox.appendChild(summary);
        }
        summary.textContent = reason || 'Not applicable to this respondent.';
      } else if (summary) {
        summary.remove();
      }
    });
  }

  function setSkipNote(wrap, text) {
    var note = wrap.querySelector('.skip-note');
    if (!text) { if (note) note.remove(); return; }
    if (!note) {
      note = el('div', 'skip-note');
      wrap.insertBefore(note, wrap.firstChild.nextSibling || null);
    }
    note.textContent = text;
  }

  function wireConditions(section) {
    // Built once per section rather than re-walked on every keystroke:
    // the reconcile pass runs constantly and only ever cares about these
    // four small subsets, not all ~60 fields on the page.
    var conditionalFields = [];
    var exclusiveFields = [];
    var dynamicFields = [];
    var derivedFields = [];
    var numericFields = [];
    section.questions.forEach(function (q) {
      q.fields.forEach(function (f) {
        if (f.conditions && f.conditions.length) conditionalFields.push(f);
        if (f.exclusiveWith && f.exclusiveWith.length) exclusiveFields.push(f);
        if (f.optionsFrom) dynamicFields.push(f);
        if (f.derived) derivedFields.push(f);
        if (f.type === 'number') numericFields.push(f);
      });
    });

    function reconcile() {
      conditionalFields.forEach(function (f) {
        var isMatrix = f.type === 'matrix';
        var wrap = wrapFor(f.field_id, isMatrix);
        if (!wrap) return;
        var met = allConditionsMet(f.conditions);
        var currentlyGrayed = wrap.classList.contains('field-grayed');
        var cellIds = isMatrix ? matrixCellIdList(f) : [f.field_id];

        if (met) {
          // Also runs on the FIRST pass, not only when un-graying: a
          // resumed draft can carry an auto-N/A from a branch the
          // enumerator has since changed, and leaving it in place
          // silently recorded "not applicable" for a question the form
          // was now happily showing as blank and answerable.
          var hadAutoNa = false;
          cellIds.forEach(function (id) {
            if (state.answers[id] === AUTO_NA) { state.answers[id] = ''; hadAutoNa = true; }
          });
          if (currentlyGrayed || hadAutoNa) {
            wrap.classList.remove('field-grayed');
            setFieldEnabled(wrap, true);
            setSkipNote(wrap, '');
            if (currentlyGrayed) clearFieldUI(wrap);
            saveDraft();
          }
        } else {
          if (!currentlyGrayed) {
            wrap.classList.add('field-grayed');
            clearFieldUI(wrap);
            setFieldEnabled(wrap, false);
          }
          setSkipNote(wrap, skipReason(f.conditions));
          cellIds.forEach(function (id) {
            if (state.answers[id] !== AUTO_NA) setAnswer(id, AUTO_NA);
          });
        }
      });
      collapseSkippedQuestions(section);
      applyExclusivity(exclusiveFields);
      applyDynamicOptions(dynamicFields);
      applyDerivedFields(derivedFields);
      applyCrossFieldValidation(numericFields);
      updateTerminationState();
      updateProgressText();
    }

    // Only the section on screen reconciles. The listeners are installed
    // once (see installReconcileListeners) and dispatch to whichever
    // reconcile belongs to the current section — adding a fresh listener
    // per render instead left every previously-visited section's pass
    // running on every click, so by Section 9 a single radio press was
    // doing nine full passes over fields that were no longer on screen.
    state.reconcile = reconcile;
    installReconcileListeners();
    reconcile();
  }

  var reconcileListenersInstalled = false;
  function installReconcileListeners() {
    if (reconcileListenersInstalled) return;
    reconcileListenersInstalled = true;

    // `change` drives routing — picking a radio must reveal or skip the
    // dependent questions immediately, so it runs synchronously.
    app.addEventListener('change', function () {
      if (state.reconcile) state.reconcile();
    });

    // `input` fires on every keystroke of a long text answer, where a
    // full pass over every conditional field is wasted work; coalesce
    // bursts into a single pass. Deliberately a timer rather than
    // requestAnimationFrame: rAF is paused while the tab is hidden, so a
    // pass scheduled just before the enumerator switches apps would not
    // run until they came back, leaving the skip logic stale against
    // what was typed. A timer always fires.
    var scheduled = false;
    app.addEventListener('input', function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        if (state.reconcile) state.reconcile();
      }, 0);
    });
  }

  // ---------------------------------------------------------------
  // Soft mutual exclusivity ("exclusiveWith")
  //
  // An exact amount and "unable to provide an exact amount" are two
  // routes to the same answer, so answering one retires the other. The
  // first version enforced that by DISABLING the losing side — but a
  // radio button cannot be un-clicked, so an enumerator who mis-clicked
  // the fallback was permanently locked out of the amount box ("I
  // mistakenly clicked the options, and cannot write the amount").
  // Nothing is disabled here: answering one side simply clears the other,
  // and either side stays available for the whole interview.
  // ---------------------------------------------------------------
  function clearAnswerAndUI(fieldId) {
    var wrap = document.querySelector('[data-field-id="' + cssEscape(fieldId) + '"]');
    if (state.answers[fieldId]) state.answers[fieldId] = '';
    if (wrap) clearFieldUI(wrap);
  }

  function applyExclusivity(fields) {
    fields.forEach(function (f) {
      if (state.lastTouched !== f.field_id) return;
      if (!answerValues(f.field_id).length) return;
      f.exclusiveWith.forEach(function (peer) {
        if (answerValues(peer).length) clearAnswerAndUI(peer);
      });
      saveDraft();
    });
  }

  /** Every single-answer control gets one of these. Radios cannot be
   * un-clicked, and a mis-click on a routing question used to be
   * unrecoverable without abandoning the whole response. */
  function makeClearButton(fieldId, scopeEl) {
    var btn = el('button', 'clear-answer', 'Clear answer');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var scope = scopeEl || document.querySelector('[data-field-id="' + cssEscape(fieldId) + '"]');
      if (scope) {
        scope.querySelectorAll('input[type=radio], input[type=checkbox]').forEach(function (i) { i.checked = false; });
        scope.querySelectorAll('select').forEach(function (s) { s.value = ''; });
        scope.querySelectorAll('input[type=text].specify-input').forEach(function (s) { s.value = ''; });
      }
      setAnswer(fieldId, '');
      if (state.reconcile) state.reconcile();
    });
    return btn;
  }

  // ---------------------------------------------------------------
  // Hard routing gates ("terminationRules")
  //
  // Reviewers were explicit: "the enumerator should not be able to click
  // Next and continue into Sections B-H after No/Unable to verify."
  // A matched rule blocks forward navigation, explains what to do, and
  // offers the one legitimate way onward — end the interview and submit
  // the record so the disposition is still counted.
  // ---------------------------------------------------------------
  function matchedTerminationRule() {
    var rules = (state.schema && state.schema.terminationRules) || [];
    for (var i = 0; i < rules.length; i++) {
      if ((rules[i].when || []).every(oneConditionMet)) return rules[i];
    }
    return null;
  }

  function updateTerminationState() {
    var rule = matchedTerminationRule();
    state.termination = rule;
    var banner = document.getElementById('terminationBanner');
    if (!rule) {
      if (banner) banner.remove();
      nextBtn.disabled = false;
      return;
    }
    if (!banner) {
      banner = el('div', 'termination-banner');
      banner.id = 'terminationBanner';
      app.insertBefore(banner, app.firstChild);
    }
    banner.innerHTML = '';
    banner.appendChild(el('h3', null, rule.title));
    banner.appendChild(el('p', null, rule.message));
    var endBtn = el('button', 'primary', 'End interview and submit this record');
    endBtn.type = 'button';
    endBtn.addEventListener('click', function () { endInterview(rule); });
    banner.appendChild(endBtn);
    nextBtn.disabled = true;
  }

  function endInterview(rule) {
    if (!confirm(rule.title + '\n\n' + rule.message +
        '\n\nSubmit this record now and end the interview?')) return;
    var outcomeField = (state.schema && state.schema.outcomeField) || null;
    if (outcomeField && rule.outcome) setAnswer(outcomeField, rule.outcome, { silent: true });
    setAnswer('INTERVIEW_TERMINATION_REASON', rule.title, { silent: true });
    submitResponse({ partial: true });
  }

  // ---------------------------------------------------------------
  // Dynamic options ("optionsFrom")
  //
  // "Most significant difficulty" should offer exactly the difficulties
  // ticked a question earlier, not a fixed list (and not, as shipped, a
  // dropdown holding a single option). Same pattern for the principal
  // activity, which comes from the activities ticked in C1, and for the
  // shock with the greatest effect.
  // ---------------------------------------------------------------
  function dynamicOptionsFor(spec) {
    var picked = answerValues(spec.field);
    var exclude = (spec.exclude || []).map(function (x) { return String(x).toLowerCase(); });
    var opts = picked.filter(function (v) {
      return exclude.indexOf(v.toLowerCase()) === -1;
    });
    (spec.extra || []).forEach(function (x) { if (opts.indexOf(x) === -1) opts.push(x); });
    return opts;
  }

  function applyDynamicOptions(fields) {
    fields.forEach(function (f) {
      {
        var wrap = wrapFor(f.field_id);
        if (!wrap) return;
        var opts = dynamicOptionsFor(f.optionsFrom);
        var signature = opts.join('\u0001');
        if (wrap.getAttribute('data-options-signature') === signature) return;
        wrap.setAttribute('data-options-signature', signature);

        var host = wrap.querySelector('.dynamic-options');
        if (!host) {
          host = el('div', 'dynamic-options');
          wrap.appendChild(host);
        }
        host.innerHTML = '';
        if (!opts.length) {
          host.appendChild(el('div', 'empty-note',
            f.optionsFrom.emptyText || 'Answer the previous question first.'));
          return;
        }
        var current = state.answers[f.field_id];
        if (current && current !== AUTO_NA && opts.indexOf(current) === -1) {
          setAnswer(f.field_id, '', { silent: true });
          current = '';
        }
        var isMulti = f.type === 'multi_choice';
        var currentSet = answerValues(f.field_id);
        var group = el('div', 'choice-group');
        opts.forEach(function (opt, i) {
          var row = el('div', 'choice-row');
          var input = document.createElement('input');
          input.type = isMulti ? 'checkbox' : 'radio';
          input.name = f.field_id;
          input.id = f.field_id + '_dyn' + i;
          input.value = opt;
          input.checked = currentSet.indexOf(opt) !== -1;
          input.addEventListener('change', function () {
            if (isMulti) {
              var chosen = [];
              group.querySelectorAll('input:checked').forEach(function (c) { chosen.push(c.value); });
              setAnswer(f.field_id, chosen.join('; '));
            } else {
              setAnswer(f.field_id, input.checked ? opt : '');
            }
          });
          var lbl = document.createElement('label');
          lbl.setAttribute('for', input.id);
          lbl.textContent = opt;
          row.appendChild(input);
          row.appendChild(lbl);
          group.appendChild(row);
        });
        host.appendChild(group);
        if (!isMulti) host.appendChild(makeClearButton(f.field_id, group));
      }
    });
  }

  // ---------------------------------------------------------------
  // Derived fields ("deriveRules")
  //
  // Final Eligibility Determination is computed from the screening
  // answers rather than chosen by the enumerator, so the record can
  // never say loan verification failed AND the borrower is eligible.
  // The rules live in the schema (tools/enhance_schema.py) so both
  // client copies evaluate exactly the same list.
  // ---------------------------------------------------------------
  function evaluateDeriveRules(field) {
    var rules = field.deriveRules || [];
    for (var i = 0; i < rules.length; i++) {
      if ((rules[i].when || []).every(oneConditionMet)) return rules[i].value;
    }
    return '';
  }

  function applyDerivedFields(fields) {
    fields.forEach(function (f) {
      {
        var wrap = wrapFor(f.field_id);
        if (!wrap) return;
        var value = evaluateDeriveRules(f);
        if (state.answers[f.field_id] !== value) setAnswer(f.field_id, value, { silent: true });
        var out = wrap.querySelector('.derived-value');
        if (!out) {
          out = el('div', 'derived-value');
          wrap.appendChild(out);
        }
        out.textContent = value || (f.derivePending || 'Not yet determined.');
        out.classList.toggle('derived-pending', !value);
        out.classList.toggle('derived-blocked',
          !!value && value.toLowerCase().indexOf('eligible') === 0 ? false : !!value);
      }
    });
  }

  // ---------------------------------------------------------------
  // Cross-field numeric checks ("maxOf")
  //
  // Reviewers asked for these explicitly: economically-active members and
  // dependants cannot exceed household size, cultivated area cannot
  // exceed total area, amount released cannot exceed amount approved.
  // These warn rather than block — a genuine data point should never be
  // impossible to record — but they surface the contradiction at the
  // moment it is typed instead of at cleaning time.
  // ---------------------------------------------------------------
  function setFieldWarning(wrap, message) {
    var note = wrap.querySelector('.field-warning');
    if (!message) { if (note) note.remove(); return; }
    if (!note) {
      note = el('div', 'field-warning');
      wrap.appendChild(note);
    }
    note.textContent = message;
  }

  function applyCrossFieldValidation(fields) {
    fields.forEach(function (f) {
      {
        var wrap = wrapFor(f.field_id);
        if (!wrap || wrap.classList.contains('field-grayed')) return;
        var msgs = [];
        var raw = state.answers[f.field_id];
        var val = parseFloat(raw);

        if (f.type === 'number' && raw && raw !== AUTO_NA && !isNaN(val)) {
          if (f.min !== undefined && val < f.min) {
            msgs.push('Must be ' + f.min + ' or more.');
          }
          if (f.max !== undefined && val > f.max) {
            msgs.push('Must be ' + f.max + ' or less.');
          }
          if (f.integer && String(raw).indexOf('.') !== -1) {
            msgs.push('Enter a whole number.');
          }
          if (f.maxOf) {
            var cap = parseFloat(state.answers[f.maxOf]);
            if (!isNaN(cap) && val > cap) {
              msgs.push('Cannot be more than ' + questionLabelFor(f.maxOf) + ' (' + cap + ').');
            }
          }
        }
        setFieldWarning(wrap, msgs.join(' '));
      }
    });
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

    /** Reverting a swapped-in <select> back to a plain text input, so a
     * changed Region does not leave the previous region's province list
     * (and its stored answer) sitting underneath. Reported in the
     * verification sheet: the enumerator had to leave the section and
     * come back before the dependent fields would reset. */
    function resetLocationField(wrap, hint) {
      if (!wrap) return;
      var fieldId = wrap.getAttribute('data-field-id');
      setAnswer(fieldId, '', { silent: true });
      var existing = wrap.querySelector('.select-wrap');
      if (existing) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'input-text';
        input.placeholder = hint || 'Type your answer';
        input.addEventListener('input', function () { setAnswer(fieldId, input.value); });
        existing.replaceWith(input);
      } else {
        var plain = wrap.querySelector('input.input-text');
        if (plain) plain.value = '';
      }
    }

    regionSelect.addEventListener('change', function () {
      var regionName = regionSelect.value;
      resetLocationField(provinceWrap, 'e.g. Nueva Ecija');
      resetLocationField(cityWrap, 'e.g. Mu\u00f1oz City, or the specific municipality');
      resetLocationField(brgyWrap, 'e.g. Malasin (as recorded on the sampling frame)');
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

  // ---------------------------------------------------------------
  // Auto-derived fields: Age Group from Age, Island Group from Region.
  // The enumerator answers the source field once; the derived field is
  // computed and locked, so the two can never contradict each other.
  // ---------------------------------------------------------------
  var REGION_TO_ISLAND = {
    'National Capital Region (NCR)': 'Luzon',
    'Cordillera Administrative Region (CAR)': 'Luzon',
    'Region I \u2013 Ilocos Region': 'Luzon',
    'Region II \u2013 Cagayan Valley': 'Luzon',
    'Region III \u2013 Central Luzon': 'Luzon',
    'Region IV-A \u2013 CALABARZON': 'Luzon',
    'MIMAROPA Region': 'Luzon',
    'Region V \u2013 Bicol Region': 'Luzon',
    'Region VI \u2013 Western Visayas': 'Visayas',
    'Region VII \u2013 Central Visayas': 'Visayas',
    'Region VIII \u2013 Eastern Visayas': 'Visayas',
    'Negros Island Region (NIR)': 'Visayas',
    'Region IX \u2013 Zamboanga Peninsula': 'Mindanao',
    'Region X \u2013 Northern Mindanao': 'Mindanao',
    'Region XI \u2013 Davao Region': 'Mindanao',
    'Region XII \u2013 SOCCSKSARGEN': 'Mindanao',
    'Region XIII \u2013 Caraga': 'Mindanao',
    'Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)': 'Mindanao'
  };

  function ageToGroup(age) {
    var n = parseInt(age, 10);
    if (isNaN(n)) return '';
    if (n < 18) return '';
    if (n <= 35) return '18\u201335';
    if (n <= 50) return '36\u201350';
    if (n <= 65) return '51\u201365';
    return '66 and above';
  }

  function lockDerivedChoice(wrap, value) {
    if (!wrap || !value) return;
    var fieldId = wrap.getAttribute('data-field-id');
    var radios = wrap.querySelectorAll('input[type=radio]');
    var matched = false;
    radios.forEach(function (r) {
      var lbl = document.querySelector('label[for="' + r.id + '"]');
      var isMatch = lbl && lbl.textContent.trim() === value;
      r.checked = !!isMatch;
      r.disabled = true;
      if (isMatch) matched = true;
    });
    if (matched) {
      state.answers[fieldId] = value;
      saveDraft();
    }
    if (!wrap.querySelector('.auto-derived-note')) {
      var note = el('div', 'auto-derived-note', 'Auto-filled from your answer above.');
      wrap.appendChild(note);
    }
  }

  function applyAutoDerivations() {
    var ageWrap = document.querySelector('[data-field-id="B2_1"]');
    var ageGroupWrap = document.querySelector('[data-field-id="B2_2"]');
    if (ageWrap && ageGroupWrap) {
      var ageInput = ageWrap.querySelector('input');
      function syncAgeGroup() {
        var group = ageToGroup(state.answers['B2_1']);
        if (group) lockDerivedChoice(ageGroupWrap, group);
      }
      if (ageInput) ageInput.addEventListener('input', syncAgeGroup);
      syncAgeGroup();
    }

    var regionWrap2 = document.querySelector('[data-field-id="A1_1"]');
    var islandWrap = document.querySelector('[data-field-id="A1_5"]');
    if (regionWrap2 && islandWrap) {
      var regionSelectEl = regionWrap2.querySelector('select.input-select');
      function syncIsland() {
        var island = REGION_TO_ISLAND[state.answers['A1_1']];
        if (island) lockDerivedChoice(islandWrap, island);
      }
      if (regionSelectEl) regionSelectEl.addEventListener('change', syncIsland);
      syncIsland();
    }
  }

  // ---------------------------------------------------------------
  // Auto-captured interview timestamps: recorded by the app itself the
  // moment they happen, rather than typed by the enumerator, so they
  // can't be mistyped or left blank. Interview date + start time are
  // captured the first time Section QUESTIONNAIR is reached; end time is
  // captured on reaching the final (Closing Statement) section.
  // ---------------------------------------------------------------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function nowDateStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function nowTimeStr() {
    var d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function captureAutoTimestamp(idx) {
    var section = state.schema.sections[idx];
    var isLast = idx === state.schema.sections.length - 1;
    var hasDate = section.questions.some(function (q) { return q.fields.some(function (f) { return f.field_id === 'QUESTIONNAIR_intro_7'; }); });
    if (hasDate) {
      if (!state.answers['QUESTIONNAIR_intro_7']) setAnswer('QUESTIONNAIR_intro_7', nowDateStr());
      if (!state.answers['QUESTIONNAIR_intro_8']) setAnswer('QUESTIONNAIR_intro_8', nowTimeStr());
    }
    if (isLast) {
      if (!state.answers['CLOSING_STAT_intro_1']) setAnswer('CLOSING_STAT_intro_1', nowTimeStr());
      if (!state.answers['QUESTIONNAIR_intro_9']) setAnswer('QUESTIONNAIR_intro_9', state.answers['CLOSING_STAT_intro_1'] || nowTimeStr());
    }
    // Reflect captured values in any visible (read-only) display for these
    // fields once rendered.
    ['QUESTIONNAIR_intro_7', 'QUESTIONNAIR_intro_8', 'QUESTIONNAIR_intro_9', 'CLOSING_STAT_intro_1'].forEach(function (fid) {
      var wrap = document.querySelector('[data-field-id="' + fid + '"]');
      if (!wrap) return;
      var input = wrap.querySelector('input, textarea');
      if (input && state.answers[fid]) {
        input.value = state.answers[fid];
        input.disabled = true;
      }
      if (!wrap.querySelector('.auto-derived-note')) {
        wrap.appendChild(el('div', 'auto-derived-note', 'Recorded automatically by the app.'));
      }
    });
  }

  function setStatus(msg, ok) {
    statusBar.textContent = msg;
    statusBar.className = 'show' + (ok === true ? ' ok' : ok === 'error' ? ' err' : '');
    if (!msg) statusBar.classList.remove('show');
  }

  function showSpinner(on) { spinner.classList.toggle('show', !!on); }

  function setAnswer(id, value, opts) {
    state.answers[id] = value;
    if (!(opts && opts.silent)) state.lastTouched = id;
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

  /** Wrapper element for a field in the section currently on screen.
   * Cached per render: the reconcile pass runs on every keystroke and
   * touches every conditional field, so repeated attribute-selector
   * queries dominated the cost of typing in a long section. */
  function wrapFor(fieldId, isMatrix) {
    var cache = state.wrapCache || (state.wrapCache = {});
    var key = (isMatrix ? 'm:' : 'f:') + fieldId;
    if (key in cache) {
      var cached = cache[key];
      // A cached miss counts: re-querying the whole document for a field
      // that is not on this page, on every keystroke, is exactly the
      // cost this cache exists to avoid.
      if (cached === null || cached.isConnected) return cached;
    }
    var sel = isMatrix
      ? '[data-matrix-field="' + cssEscape(fieldId) + '"]'
      : '[data-field-id="' + cssEscape(fieldId) + '"]';
    var found = document.querySelector(sel);
    cache[key] = found;
    return found;
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

  var ITEM_CODE_RE = /^[A-Za-z]{1,3}\d+[a-z]?$/;

  /** Kept live rather than computed once per render — the count is only
   * useful if it moves as the enumerator answers. */
  function updateProgressText() {
    if (!state.schema) return;
    var idx = state.sectionIndex;
    var section = state.schema.sections[idx];
    var prog = sectionProgress(idx);
    progressEl.textContent = 'Instrument ' + state.instrument + ' \u2014 Section ' + (idx + 1) +
      ' of ' + state.schema.sections.length + ': ' + section.title +
      ' (' + prog.answered + '/' + prog.total + ' answered)';
  }

  function renderSection(idx) {
    state.sectionIndex = idx;
    state.wrapCache = {};
    state.qboxCache = {};
    state.reconcile = null;
    var section = state.schema.sections[idx];
    app.innerHTML = '';
    app.appendChild(el('div', 'section-title', section.title));
    app.appendChild(el('div', 'required-banner',
      'Only fields marked * must be completed. Everything else may be left blank \u2014 ' +
      'where the respondent declines or does not know, choose "Prefer not to answer" or ' +
      '"Don\u2019t know" if the question offers it. Greyed-out questions do not apply to ' +
      'this respondent and are skipped automatically.'));

    section.questions.forEach(function (q, qi) {
      var qbox = el('div', 'question');
      qbox.setAttribute('data-qid', q.qid);
      qbox.style.animationDelay = Math.min(qi * 40, 280) + 'ms';
      var headingText = ITEM_CODE_RE.test(q.qid) ? (q.qid + '. ' + q.heading) : q.heading;
      qbox.appendChild(el('h3', null, headingText));
      if (q.instructions) qbox.appendChild(el('div', 'instructions', q.instructions));
      q.fields.forEach(function (field) { qbox.appendChild(buildField(field)); });
      app.appendChild(qbox);
    });

    applyFieldDefaults(section);
    wireConditions(section);
    enhanceLocationCascade();
    applyAutoDerivations();
    captureAutoTimestamp(idx);

    updateProgressText();
    renderRowsProgress(idx, state.schema.sections.length);
    prevBtn.disabled = idx === 0;
    var isLast = idx === state.schema.sections.length - 1;
    nextBtn.style.display = isLast ? 'none' : 'inline-block';
    submitBtn.style.display = isLast ? 'inline-block' : 'none';
    window.scrollTo(0, 0);
  }

  /** Schema-declared starting values (the post-interview QC fields open
   * at "Pending" / "Not yet selected" rather than blank, so an untouched
   * record still reads correctly). Only fills a genuinely empty answer. */
  function applyFieldDefaults(section) {
    section.questions.forEach(function (q) {
      q.fields.forEach(function (f) {
        if (!f['default']) return;
        if (state.answers[f.field_id]) return;
        setAnswer(f.field_id, f['default'], { silent: true });
        var wrap = document.querySelector('[data-field-id="' + cssEscape(f.field_id) + '"]');
        if (!wrap) return;
        wrap.querySelectorAll('input[type=radio]').forEach(function (r) {
          var lbl = wrap.querySelector('label[for="' + r.id + '"]');
          if (lbl && lbl.textContent.trim() === f['default']) r.checked = true;
        });
        var sel = wrap.querySelector('select.input-select');
        if (sel) sel.value = f['default'];
      });
    });
  }

  var DROPDOWN_THRESHOLD = 6;

  function buildField(field) {
    // A derived field is shown, never chosen. Rendering its options as
    // radios would let the enumerator overrule the screening answers and
    // record, say, "loan verification = No" alongside "eligible
    // borrower" — the exact contradiction reviewers asked us to make
    // impossible.
    if (field.derived) return buildDerivedField(field);
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

  function buildDerivedField(field) {
    var wrap = el('div', 'field field-derived');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(buildFieldLabel(field));
    wrap.appendChild(el('div', 'derived-value derived-pending',
      field.derivePending || 'Not yet determined.'));
    if (field.note) wrap.appendChild(el('div', 'auto-derived-note', field.note));
    return wrap;
  }

  function buildTextField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(buildFieldLabel(field));
    var long = field.label.length > 70 || /^(why|reason|brief)/i.test(field.label);
    var input = document.createElement(long ? 'textarea' : 'input');
    if (!long) input.type = 'text';
    input.className = 'input-text';
    // No "or N/A if not applicable" prompt. Reviewers were emphatic that
    // inviting N/A everywhere encourages it as filler where "Don't know",
    // "Prefer not to answer" or a genuine routing skip is the correct and
    // analytically different answer. Blank is allowed for everything that
    // is not a hard gate.
    input.placeholder = field.hint ? field.hint : 'Type your answer';

    var value = state.answers[field.field_id] || '';
    if (!value && field.autoValue && field.autoValue !== 'generated') value = field.autoValue;
    if (!value && field.generator === 'controlNumber') value = nextControlNumber();
    if (!value && field.copyFrom) {
      var carried = state.answers[field.copyFrom];
      if (carried && carried !== AUTO_NA) value = carried;
    }
    input.value = value;
    if (value && value !== state.answers[field.field_id]) {
      setAnswer(field.field_id, value, { silent: true });
    }
    if (field.readOnly) {
      input.disabled = true;
      input.classList.add('input-readonly');
    }

    // Free-text names produce "Hero Tolosa" / "H. Tolosa" / "HT" in the
    // same column. Until LANDBANK/DRVN supply the real roster (see
    // STAFF_LISTS in docs/config.js) a datalist at least makes
    // previously-used spellings one tap away.
    if (field.suggestFrom) {
      var listId = field.field_id + '_list';
      var datalist = document.createElement('datalist');
      datalist.id = listId;
      suggestionsFor(field.suggestFrom).forEach(function (name) {
        var o = document.createElement('option');
        o.value = name;
        datalist.appendChild(o);
      });
      input.setAttribute('list', listId);
      wrap.appendChild(datalist);
    }

    input.addEventListener('input', function () {
      setAnswer(field.field_id, input.value);
      if (field.suggestFrom) rememberSuggestion(field.suggestFrom, input.value);
    });
    wrap.appendChild(input);
    if (field.note) wrap.appendChild(el('div', 'auto-derived-note', field.note));
    if (field.patternMessage) wrap.appendChild(el('div', 'field-hint', field.patternMessage));
    return wrap;
  }

  function suggestionsFor(listName) {
    var configured = (typeof STAFF_LISTS === 'object' && STAFF_LISTS && STAFF_LISTS[listName]) || [];
    var remembered = [];
    try { remembered = JSON.parse(localStorage.getItem('agrisenso_names_' + listName) || '[]'); }
    catch (e) {}
    var seen = {}, out = [];
    configured.concat(remembered).forEach(function (nm) {
      var t = String(nm).trim();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    });
    return out;
  }

  function rememberSuggestion(listName, value) {
    var t = String(value || '').trim();
    if (t.length < 3) return;
    var key = 'agrisenso_names_' + listName;
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    if (arr.indexOf(t) === -1) {
      arr.push(t);
      try { localStorage.setItem(key, JSON.stringify(arr.slice(-25))); } catch (e) {}
    }
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
    wrap.appendChild(buildFieldLabel(field));

    var row = el('div', 'datetime-row');
    var input = document.createElement('input');
    input.type = kind;
    input.className = 'input-text input-datetime';
    if (kind === 'number') {
      // Bounds come from the schema (tools/enhance_schema.py) so the
      // reviewer-specified rules — age >= 18, household size >= 1,
      // percentages 0-100, non-negative amounts, whole-number counts —
      // live in one place rather than being re-derived here.
      input.step = field.integer ? '1' : 'any';
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.inputMode = field.integer ? 'numeric' : 'decimal';
      // No "0" placeholder — a grey "0" reads as if a real zero were
      // already entered, which invited the exact confusion reviewers
      // flagged (leaving the field untouched looked answered). A neutral
      // instruction avoids that; the hint (if any) still shows the unit.
      input.placeholder = field.hint ? field.hint : 'Enter a number';
    }
    var saved = state.answers[field.field_id] || '';
    if (!saved && field.autoValue && field.autoValue !== 'generated') saved = field.autoValue;
    if (!saved && field.generator === 'controlNumber') saved = nextControlNumber();
    if (saved) input.value = saved;
    if (saved && saved !== state.answers[field.field_id]) {
      setAnswer(field.field_id, saved, { silent: true });
    }
    if (field.readOnly) {
      input.disabled = true;
      input.classList.add('input-readonly');
    }
    input.addEventListener('input', function () { setAnswer(field.field_id, input.value); });
    row.appendChild(input);
    if (kind === 'number' && field.unit) row.appendChild(el('span', 'field-unit', field.unit));

    wrap.appendChild(row);
    if (field.note) wrap.appendChild(el('div', 'auto-derived-note', field.note));
    return wrap;
  }

  /** Control numbers are generated, not typed, so the export cannot fill
   * up with duplicates and typos. Shape:
   * <instrument>-<YYYYMMDD>-<device>-<seq>, where the device part is a
   * stable random id for this browser so two enumerators working offline
   * cannot collide on the same sequence. */
  function deviceTag() {
    var key = 'agrisenso_device_tag';
    var tag = null;
    try { tag = localStorage.getItem(key); } catch (e) {}
    if (!tag) {
      tag = Math.random().toString(36).slice(2, 7).toUpperCase();
      try { localStorage.setItem(key, tag); } catch (e) {}
    }
    return tag;
  }

  function nextControlNumber() {
    var key = 'agrisenso_control_seq_' + state.instrument;
    var seq = 0;
    try { seq = parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) {}
    seq += 1;
    try { localStorage.setItem(key, String(seq)); } catch (e) {}
    return state.instrument + '-' + nowDateStr().replace(/-/g, '') + '-' + deviceTag() +
      '-' + ('000' + seq).slice(-4);
  }

  function buildChoiceField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(buildFieldLabel(field));
    var isMulti = field.type === 'multi_choice';
    var options = field.options;
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
    if (!isMulti) wrap.appendChild(makeClearButton(field.field_id, wrap));
    return wrap;
  }

  function buildSelectField(field) {
    var wrap = el('div', 'field');
    wrap.setAttribute('data-field-id', field.field_id);
    wrap.appendChild(buildFieldLabel(field));

    var options = field.options;
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
    wrap.appendChild(makeClearButton(field.field_id, wrap));
    return wrap;
  }

  function updateChoiceAnswer(field, isMulti) {
    var refs = state.fieldRefs[field.field_id].refs;
    if (isMulti) {
      // "None" / "Not applicable" contradicts every substantive answer,
      // so it cannot be stored alongside one ("Flood; None"). Whichever
      // side was just ticked wins.
      var exclusive = field.exclusiveOptions || [];
      if (exclusive.length) {
        var justChecked = refs.filter(function (r) { return r.input.checked; });
        var lastExclusive = null;
        justChecked.forEach(function (r) {
          if (exclusive.indexOf(r.disp.text) !== -1) lastExclusive = r;
        });
        if (lastExclusive && state.lastExclusiveTick !== field.field_id + lastExclusive.disp.text) {
          state.lastExclusiveTick = field.field_id + lastExclusive.disp.text;
          refs.forEach(function (r) { if (r !== lastExclusive) r.input.checked = false; });
        } else if (justChecked.some(function (r) { return exclusive.indexOf(r.disp.text) === -1; })) {
          state.lastExclusiveTick = null;
          refs.forEach(function (r) {
            if (exclusive.indexOf(r.disp.text) !== -1) r.input.checked = false;
          });
        }
      }
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
    wrap.appendChild(buildFieldLabel(field));
    var row = el('div', 'scale-row');
    var saved = state.answers[field.field_id] || '';
    // No N/A on a confidence scale. Reviewers asked for it to go: a
    // respondent always has some level of confidence, and the generic
    // N/A was being used as a filler that is analytically different from
    // a genuine decline. If the respondent will not answer, leave it
    // blank — nothing here is required.
    var values = ['1', '2', '3', '4', '5'];
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
    wrap.appendChild(el('div', 'scale-legend',
      '1 = not at all confident \u00b7 5 = very confident'));
    wrap.appendChild(row);
    wrap.appendChild(makeClearButton(field.field_id, wrap));
    return wrap;
  }

  function buildMatrixField(field) {
    var wrap = el('div', 'field');
    var cellIds = matrixCellIdList(field);
    wrap.setAttribute('data-matrix-field', field.field_id);
    wrap.setAttribute('data-cell-ids', JSON.stringify(cellIds));
    wrap.appendChild(buildFieldLabel(field, 'bold'));

    var numeric = isNumericMatrix(field.columns);
    var table = document.createElement('table');
    table.className = 'matrix';

    if (numeric) {
      var valueCols = field.columns.slice(1);
      var isPercent = valueCols.some(function (c) { return c.indexOf('%') !== -1; })
        && field.rows.length && field.rows[field.rows.length - 1].toLowerCase() === 'total';
      var thead = document.createElement('tr');
      thead.appendChild(document.createElement('th'));
      valueCols.forEach(function (c) {
        var th = document.createElement('th'); th.textContent = c; thead.appendChild(th);
      });
      table.appendChild(thead);

      // For a percent-of-total matrix, the "Total" row is computed live
      // from the other rows (and capped/flagged at 100%) instead of being
      // yet another manual entry that can silently disagree with the sum
      // of what was actually typed above it.
      var dataRows = isPercent ? field.rows.slice(0, -1) : field.rows;
      var totalRowSlug = isPercent ? slug(field.rows[field.rows.length - 1]) : null;
      var totalInputsByCol = {};

      function recomputeTotals() {
        valueCols.forEach(function (c) {
          var sum = 0;
          dataRows.forEach(function (rowLabel) {
            var cellId = field.field_id + '__' + slug(rowLabel) + '__' + slug(c);
            var v = parseFloat(state.answers[cellId]);
            if (!isNaN(v)) sum += v;
          });
          var totalCellId = field.field_id + '__' + totalRowSlug + '__' + slug(c);
          var display = String(sum);
          setAnswer(totalCellId, display);
          var totalInput = totalInputsByCol[c];
          if (totalInput) {
            totalInput.value = display;
            totalInput.parentElement.classList.toggle('matrix-total-over', sum > 100);
          }
        });
      }

      dataRows.forEach(function (rowLabel) {
        var tr = document.createElement('tr');
        var td0 = document.createElement('td'); td0.textContent = rowLabel; tr.appendChild(td0);
        var rslug = slug(rowLabel);
        valueCols.forEach(function (c) {
          var cellId = field.field_id + '__' + rslug + '__' + slug(c);
          var td = document.createElement('td');
          var input = document.createElement('input');
          input.className = 'input-text';
          if (field.cellNumeric || isPercent) {
            // "N/A if none" in every cell is not a database: zero is the
            // right value for a real category with no output, and the
            // percentage cells are bounded 0-100.
            input.type = 'number';
            input.step = 'any';
            input.inputMode = 'decimal';
            if (field.cellMin !== undefined) input.min = String(field.cellMin);
            if (field.cellMax !== undefined) input.max = String(field.cellMax);
            input.placeholder = isPercent ? '%' : '';
          } else {
            input.type = 'text';
            input.placeholder = '';
          }
          input.value = state.answers[cellId] || '';
          input.addEventListener('input', function () {
            setAnswer(cellId, input.value);
            if (isPercent) recomputeTotals();
          });
          td.appendChild(input);
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });

      if (isPercent) {
        var totalRow = document.createElement('tr');
        totalRow.className = 'matrix-total-row';
        var totalLabelTd = document.createElement('td'); totalLabelTd.textContent = 'Total'; totalRow.appendChild(totalLabelTd);
        valueCols.forEach(function (c) {
          var td = document.createElement('td');
          var input = document.createElement('input');
          input.type = 'text';
          input.className = 'input-text';
          input.disabled = true;
          totalInputsByCol[c] = input;
          td.appendChild(input);
          totalRow.appendChild(td);
        });
        table.appendChild(totalRow);
        recomputeTotals();
      }
    } else {
      var choices = field.columns.slice(1);
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
      setStatus(missing.length + ' question(s) on this page still need an answer \u2014 highlighted in red below.', 'error');
      return;
    }
    setStatus('');
    if (state.sectionIndex < state.schema.sections.length - 1) renderSection(state.sectionIndex + 1);
  });
  function sectionProgress(idx) {
    var section = state.schema.sections[idx];
    var total = 0, answered = 0;
    section.questions.forEach(function (q) {
      q.fields.forEach(function (f) {
        if (f.conditions && !allConditionsMet(f.conditions)) return;
        var ids = f.type === 'matrix' ? matrixCellIdList(f) : [f.field_id];
        ids.forEach(function (id) {
          total++;
          var v = state.answers[id];
          if (v && String(v).trim() && v !== AUTO_NA) answered++;
        });
      });
    });
    return { total: total, answered: answered,
             missing: validateSection(idx).length };
  }

  function openJumpSheet() {
    jumpList.innerHTML = '';
    state.schema.sections.forEach(function (section, i) {
      var p = sectionProgress(i);
      var row = el('button', 'jump-row' + (i === state.sectionIndex ? ' current' : ''));
      row.type = 'button';
      row.appendChild(el('span', 'jump-name', (i + 1) + '. ' + section.title));
      var meta = el('span', 'jump-meta',
        p.answered + ' of ' + p.total + ' answered' +
        (p.missing ? ' \u00b7 ' + p.missing + ' required outstanding' : ''));
      if (p.missing) meta.classList.add('has-missing');
      row.appendChild(meta);
      row.addEventListener('click', function () {
        jumpSheet.hidden = true;
        clearHighlights();
        renderSection(i);
      });
      jumpList.appendChild(row);
    });
    jumpSheet.hidden = false;
  }

  jumpBtn.addEventListener('click', openJumpSheet);
  jumpClose.addEventListener('click', function () { jumpSheet.hidden = true; });
  jumpSheet.addEventListener('click', function (e) {
    if (e.target === jumpSheet) jumpSheet.hidden = true;
  });

  menuBtn.addEventListener('click', function () {
    if (confirm('Leave this response and return to the menu? Your progress is auto-saved on this device and you can resume later.')) {
      renderChooser();
    }
  });

  // ---------------------------------------------------------------
  // Submit + offline sync
  // ---------------------------------------------------------------
  submitBtn.addEventListener('click', function () { submitResponse({}); });

  function submitResponse(opts) {
    opts = opts || {};
    // A terminated interview is submitted as-is: the whole point of the
    // routing gate is that the remaining questions must NOT be asked, so
    // requiring them would make the disposition impossible to record.
    if (!opts.partial) {
      var problem = validateAll();
      if (problem) {
        if (problem.sectionIndex !== state.sectionIndex) renderSection(problem.sectionIndex);
        highlightMissing(problem.missing);
        var sectionTitle = state.schema.sections[problem.sectionIndex].title;
        setStatus(problem.missing.length + ' question(s) in "' + sectionTitle + '" still need an answer before this response can be submitted \u2014 highlighted in red below.', 'error');
        return;
      }
    } else {
      state.answers['INTERVIEW_COMPLETION'] = 'Ended early by routing rule';
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
  }

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
