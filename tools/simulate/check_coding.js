// Checks the enumerator / respondent coding reaches the enumerator and
// survives a submission. The coding itself is data (hints in
// enhance_schema.py, roster in docs/config.js), but two claims made on
// the printable card are behaviour and can break silently:
//
//   1. a filled STAFF_LISTS turns the name fields into pick-lists
//   2. "CODE — Surname, First M." round-trips through a submission and
//      splits back into code and name on that em dash
//
//   node check_coding.js
const assert = require('assert');
const { loadApp } = require('./drive.js');

const ROSTER = {
  enumerators: ['EN-02-07 — Dela Cruz, Juan M.', 'EN-06-01 — Bautista, Mark L.'],
  supervisors: ['SV-02-1 — Santos, Maria L.'],
};
// Same shapes the card documents. Kept here so a change to either one
// has to be made in both places deliberately.
const ENUMERATOR_RE = /^EN-\d{2}-\d{2} — \S.*, \S/;
const SUPERVISOR_RE = /^SV-\d{2}-\d — \S.*, \S/;
const RESPONDENT_RE = /^[AB]-\d{2}-[A-Z]{3}-\d{4}(-R\d+)?$/;

ROSTER.enumerators.forEach(function (s) { assert.match(s, ENUMERATOR_RE, s); });
ROSTER.supervisors.forEach(function (s) { assert.match(s, SUPERVISOR_RE, s); });
['A-02-ISA-0147', 'B-02-ISA-0031', 'A-02-ISA-0147-R1'].forEach(function (s) {
  assert.match(s, RESPONDENT_RE, s);
});
// The near-misses the card warns about must actually fail.
['A-2-ISA-147', 'a-02-isa-0147', 'A-02-ISABELA-0147'].forEach(function (s) {
  assert.ok(!RESPONDENT_RE.test(s), 'should be rejected: ' + s);
});

(async function () {
  for (const key of ['A', 'B']) {
    const app = await loadApp(key);
    app.window.STAFF_LISTS = ROSTER;          // what docs/config.js supplies
    await app.start(key);
    await app.next();                         // admin / QC screen

    const frame = app.wrap('QUESTIONNAIR_intro_4');
    const frameInput = frame.querySelector('input');
    // The schema's own pattern must accept the documented respondent code.
    const schemaField = app.schemas[key].sections
      .reduce((a, s) => a.concat(s.questions), [])
      .reduce((a, q) => a.concat(q.fields || []), [])
      .find(f => f.field_id === 'QUESTIONNAIR_intro_4');
    const code = key + '-02-ISA-0147';
    assert.match(code, new RegExp(schemaField.pattern), 'schema pattern rejects ' + code);
    assert.ok(/e\.g\. [AB]-02-[A-Z]{3}-\d{4}/.test(frameInput.placeholder),
      'frame hint lost its example: ' + frameInput.placeholder);

    // Pick-lists, not free text, once the roster is supplied.
    const enumOpts = [...app.wrap('QUESTIONNAIR_intro_5')
      .querySelectorAll('datalist option')].map(o => o.value);
    assert.deepStrictEqual(enumOpts, ROSTER.enumerators, key + ' enumerator pick-list');
    const supOpts = [...app.wrap('QUESTIONNAIR_intro_6')
      .querySelectorAll('datalist option')].map(o => o.value);
    assert.deepStrictEqual(supOpts, ROSTER.supervisors, key + ' supervisor pick-list');

    app.type('QUESTIONNAIR_intro_4', code);
    app.type('QUESTIONNAIR_intro_5', ROSTER.enumerators[0]);
    app.type('QUESTIONNAIR_intro_6', ROSTER.supervisors[0]);
    app.flush();

    const answers = app.window.localStorage.getItem('agrisenso_draft_' + key);
    const stored = JSON.parse(answers);
    assert.strictEqual(stored.QUESTIONNAIR_intro_4, code);

    // The claim the card makes about analysis: split on " — ".
    const [enCode, enName] = stored.QUESTIONNAIR_intro_5.split(' — ');
    assert.strictEqual(enCode, 'EN-02-07');
    assert.strictEqual(enName, 'Dela Cruz, Juan M.');
    const [svCode] = stored.QUESTIONNAIR_intro_6.split(' — ');
    assert.strictEqual(svCode, 'SV-02-1');

    // The control number is the app's, and is not the respondent code.
    const ctrl = stored.QUESTIONNAIR_intro_3;
    assert.ok(ctrl && ctrl.indexOf(key + '-') === 0, 'control number missing: ' + ctrl);
    assert.notStrictEqual(ctrl, code);
    assert.ok(app.wrap('QUESTIONNAIR_intro_3').querySelector('input').disabled,
      'control number must stay read-only');

    console.log(key, 'ok  frame=' + code + '  enum=' + enCode + '  ctrl=' + ctrl);
  }
  console.log('coding checks passed');
})().catch(e => { console.error(e); process.exit(1); });
