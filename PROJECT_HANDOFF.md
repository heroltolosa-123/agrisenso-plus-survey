# AGRISENSO Plus Baseline Survey — Project Handoff

**Purpose of this file**: paste/upload this into a new chat with Claude so
development can continue without re-explaining the whole project. Also
upload the current project zip (from your GitHub repo, or ask Claude to
work from what you paste here plus your repo).

**Owner**: Hero (academician/researcher). **Client**: DRVN Business
Consulting Co., commissioned by ACPC (Agricultural Credit Policy Council,
Philippines) for the **AGRISENSO Plus Baseline Study** (LANDBANK lending
program). **Repo**: `agrisenso-plus-survey` on GitHub, user
`heroltolosa-123`. Latest commit as of this handoff: `206607d` (round 6).

---

## 1. What this project is

A digital data-collection tool for two quantitative questionnaires used
by field enumerators to interview AGRISENSO Plus loan borrowers
(Instrument A) and a non-borrower comparison group (Instrument B).
122/103 questions respectively, originally a Word document, now a
schema-driven web survey writing to Google Sheets.

## 2. Architecture

```
docs/       Standalone static website (HTML/CSS/JS, no build step).
            Published via GitHub Pages. This is what enumerators open.
src/        Google Apps Script project, bound to the Google Sheet that
            acts as the database. Deployed as a Web App; docs/ calls it
            as a JSON API over fetch().
tools/      Python pipeline that turns the source Word doc into the
            JSON schema both docs/app.js and src/Schema_*.gs render from.
guide/      Enumerator training guide (docx) — NOTE: written for an
            earlier "everything required" design, needs updating to
            match the current curated-required-fields policy.
```

**Why this split exists**: the user wanted a real shareable URL (not a
`script.google.com` link) but Google Sheets as the database with no
separate backend infrastructure to run. Apps Script serves as a free,
zero-maintenance JSON API; the site itself is plain static files that
work on GitHub Pages, Render, or any static host.

**Key files**:
- `tools/parse_questionnaire.py` — parses a GFM-Markdown export of the
  source Word doc into structured JSON (`questions_A.json`/`questions_B.json`).
- `tools/enhance_schema.py` — the real logic layer. Applies: Region
  dropdown, date/time/month/number field typing, conditional-logic
  detection, required-field flagging, multi-choice reclassification,
  mutual-exclusivity wiring, and several one-off targeted fixes. **This
  file is the single source of truth for "what does the schema look
  like" — read it before touching field behavior.**
- `tools/generate_gs_schema.py` — dumps the JSON schema into
  `src/Schema_A.gs`/`Schema_B.gs` as `var QUESTIONS_A = {...};`.
- `docs/app.js` — the entire client (rendering, validation, conditional
  logic, PSGC cascade, submission). ~1000 lines, single IIFE.
- `src/JavaScript.html` — **mechanically regenerated from `docs/app.js`**
  by swapping the `fetch()`-based transport for `google.script.run` calls
  (see the regeneration script pattern used throughout this project's
  history — search chat/git log for `"function backendConfigured"` split
  logic). Do not hand-edit; regenerate after every `docs/app.js` change.
- `docs/style.css` / `src/Stylesheet.html` — same relationship (the
  Apps Script copy swaps `url("assets/...")` for `var(--banner-image)`/
  `var(--bg-image)` CSS custom properties defined in `src/Assets.html`,
  which base64-embeds the two brand images for that context).
- `src/Code.gs` — Apps Script backend: `doGet`/`doPost` JSON API,
  `submitResponse`, sequential response-number generation, sheet/header
  management. Independent of the schema content itself.

## 3. The full pipeline (run in this order after any questionnaire change)

```bash
cd tools
python3 parse_questionnaire.py <path-to-md> "<label>" questions_A_raw.json
python3 parse_questionnaire.py <path-to-md> "<label>" questions_B_raw.json
cp questions_A_raw.json questions_A.json
cp questions_B_raw.json questions_B.json
python3 enhance_schema.py
python3 generate_gs_schema.py
python3 generate_apps_script_client.py
```
`generate_apps_script_client.py` (added in round 6) rebuilds
`src/JavaScript.html` and `src/Stylesheet.html` from the `docs/`
originals — that transform used to be done by hand, which is how the two
copies drift. Both files are generated; never hand-edit them. Then paste the updated
`src/*.gs`/`src/*.html` files into the live Apps Script project, and
redeploy with **New version** (not a new deployment — keeps the URL
`docs/config.js` points at).

## 4. Current design policies (important — don't regress these)

### Required fields: curated, not blanket
Only ~26 fields are `required: true` (see `REQUIRED_FIELD_IDS` in
`enhance_schema.py`): consent (2) + attestation (1), Region, Borrower
Type, Loan Agreement Verification, Status of Loan Release, the
Individual/Organizational eligibility chains, Age, Language, Interview
Mode. **Everything else may be left blank.** This was a deliberate
reversal (commit `b900be4`) after ACPC/DRVN reviewers found the earlier
"everything required + auto-N/A" design actively wrong (violates
informed consent) and broken (already-answered fields still blocked
submission because a sibling field was independently required).

### No auto-added N/A
Choice fields render exactly their own source options. Where the
original questionnaire already has "Prefer not to answer"/"Don't
know"/"Unable to estimate" as a real option, that's the decline
mechanism — never a generic bolted-on N/A.

### Conditional logic (gray-out + auto-fill)
`field.conditions` is a list of AND-combined clauses:
`{"field": id, "in": [...]}` (referenced field's answer must match one
of these) or `{"field": id, "empty": true}` / `{"field": id, "notEmpty": true}`
(presence-based, used for exact-amount-vs-fallback mutual exclusivity).
When unmet, the field is grayed, disabled, and its answer(s) set to the
literal string `'N/A (not applicable based on a prior answer)'`
(constant `AUTO_NA` in `docs/app.js`). Reconciles live on every
change/input event inside the currently rendered section
(`wireConditions()` in `docs/app.js`). Matrix fields store answers
per-cell (`matrixCellIdList()`), not per-field, and conditions apply to
all cells at once.

Detection sources in `enhance_schema.py`:
- `detect_branch()` / `CONDITION_RE` — explicit "Ask only if A2 =
  Individual/Organizational" wording, propagated to the whole question
  group once found on any one field in it.
- `apply_if_followup_detection()` — general "If Yes/If No/If <value>,
  ..." detector, ties to the nearest preceding choice-type field in the
  same question, fuzzy-matches the referenced option text.
- `EXTRA_CONDITIONS` — hand-curated one-offs where the source wording
  doesn't match either pattern (currently just `B12_2` phone-type,
  needing both the Individual branch AND Mobile Access = Yes).
- `apply_amount_fallback_conditions()` — the exact-amount/fallback
  mutual-exclusivity groups (`AMOUNT_FALLBACK_GROUPS`,
  `DUAL_AMOUNT_FALLBACK_GROUPS`).

### Multi-choice reclassification
`MULTI_CHOICE_FIELD_IDS` — 12 fields per instrument converted from
single-select to checkboxes where more than one answer legitimately
applies (Major Shocks, Difficulties During Application, insurance/
extension providers, etc.).

### Auto-derived fields (client-side only, not in schema)
`applyAutoDerivations()` in `docs/app.js`: Age (`B2_1`) → Age Group
(`B2_2`) via `ageToGroup()`; Region (`A1_1`) → Island Group (`A1_5`) via
`REGION_TO_ISLAND` map. Locks the derived radio and disables it, shows
"Auto-filled from your answer above."

### Auto-captured timestamps
`captureAutoTimestamp()`: Interview Date + Start Time captured the
moment Section 2 (`QUESTIONNAIR_intro_7`/`_8`) is reached; End Time
(`CLOSING_STAT_intro_1` + `QUESTIONNAIR_intro_9`) captured on reaching
the last section. Rendered as disabled text inputs with "Recorded
automatically by the app."

### Percentage-matrix auto-sum
Any numeric matrix whose columns mention "%" and whose last row is
literally "Total" (case-insensitive) gets its Total row computed live
from the rows above, disabled from manual entry, flagged red past 100%.
See `buildMatrixField()` in `docs/app.js` — **the total row's cell ID
must use `slug()` of the actual row label, not a hardcoded string** (a
real bug was caught and fixed here once already — don't reintroduce it).

### Item numbers / clean titles
Section titles show clean text only (no "Section SURVEY_INSTR" prefix).
Question headings show the source item number (e.g. "A5.") when
`q.qid` matches `ITEM_CODE_RE = /^[A-Za-z]{1,3}\d+[a-z]?$/` in
`docs/app.js`.

### PSGC cascading location dropdowns
Region is a hardcoded, verified 18-item list (`PH_REGIONS` in
`enhance_schema.py` — confirmed current as of this project including
Negros Island Region, re-established 2024). Province/City/Barangay
cascade live from `https://psgc.gitlab.io/api/` (`enhanceLocationCascade()`
in `docs/app.js`) — **untested against the real live API from the dev
sandbox** (no network access to that host); the fallback-to-plain-text
behavior on any fetch failure IS tested and confirmed working. Ask the
user to confirm this works in a real pilot test if picking this back up.

## 5. Testing approach used throughout this project

No formal test framework — hand-written Node.js scripts using `jsdom` to
simulate a real browser (not just unit-testing pure functions). Pattern:
mock `window.fetch`, load `docs/app.js` via `dom.window.eval()`, drive it
with real DOM events (`dispatchEvent(new Event('change', {bubbles:true}))`
— **the `{bubbles:true}` is required**, jsdom's synthetic events don't
bubble by default unlike real browsers, and this project's delegated
event listeners (`wireConditions`) depend on bubbling). Also used
Playwright/Chromium for real rendered screenshots and console-error
checks. These test scripts live in `/tmp/gscheck/` in the dev sandbox —
**they were not committed to the repo** (they're dev-only scaffolding,
not part of the deliverable). If continuing development, recreate this
testing pattern rather than trusting changes untested — this project
found ~10 real bugs specifically because of this testing discipline
(several silent-data-loss parser bugs that would never have surfaced
from just reading the code).

Also verify field-ID consistency after any schema change: the client
(`docs/app.js`/`src/JavaScript.html`) computes column IDs independently
of the server (`src/Code.gs`'s `flatColumns_`/`matrixCells_`) — they must
produce identical ID lists in identical order, or answers land in the
wrong Sheet column silently. There's a Node harness pattern for this
(load both via `vm.createContext`, diff the ID arrays) used repeatedly
in this project's history.

## 6. Known limitations / explicitly deferred

Round 6 (commit `206607d`) closed most of the earlier list. What that
round added, and what is genuinely left:

**Closed in round 6** — see README section 8a for the full write-up:
early-termination routing gates, derived Final Eligibility (A10),
dynamic option population (D6 from D5, C2 from C1, C21a from C21, E9
from E8 in B), admin/QC fields moved to the end with the agreed
Back-check options and callback capture, system-controlled version and
control number, commodity-based Section C routing, numeric bounds and
cross-field checks, and the amount-vs-fallback lock-out.

**Still open, all blocked on inputs from the client rather than on code:**

1. **Enumerator / supervisor rosters.** `STAFF_LISTS` in
   `docs/config.js` is an empty scaffold; paste the approved names in and
   the free-text fields become pick-lists. Until then they suggest names
   already used on the same device.
2. **No validation against the real LANDBANK sampling frame.** Borrower
   type, segment, name and sampling-frame ID are still enumerator-entered
   and only shape-validated. Preloading them needs the borrower list.
3. **LANDBANK lending-centre list** — still free text.
4. **Region dropdown lists all 18 regions**, not narrowed to ACPC's study
   clusters.
5. **`guide/AGRISENSO_Plus_Survey_Enumerator_Guide.docx` is stale** — it
   still describes the pre-round-5 "everything required, click N/A"
   design and now also predates the routing gates, the collapsed skipped
   questions and the derived eligibility. Reissue before fieldwork
   briefings.
6. **The "A8 in Instrument B" field report could not be reproduced**
   against the current code. The eligibility gating was genuinely wrong
   for Instrument B (fixed), and skipped questions now explain
   themselves, so the two plausible causes are both addressed — but ask
   the user to re-test that specific path after redeploying.

## 7. Things that look like bugs but aren't (don't "fix" these)

- Matrix conditional fields use `data-matrix-field`/`data-cell-ids`
  attributes, not `data-field-id` — this is intentional (matrix answers
  are per-cell). See `wireConditions()`'s `isMatrix` branching.
- `AUTO_NA` constant text (`'N/A (not applicable based on a prior
  answer)'`) is deliberately distinguishable from any real user-entered
  text, for downstream data analysis (tell system-inferred skips apart
  from anything else).
- The two-copy client (`docs/app.js` vs `src/JavaScript.html`) is
  intentional, not drift — one instrument (Apps Script direct page) uses
  `google.script.run`, the other (standalone site) uses `fetch()`. Keep
  them mechanically regenerated from the same source, never hand-diverge.

## 8. Reviewer feedback already fully incorporated (don't re-raise these)

9 rounds of documented feedback (screenshots + written comments, 6
numbered batches + 3 summary docs) covering: N/A over-use, blanket
required fields, missing C21a, front-matter/routing-text-as-fake-fields,
consent script corruption, single-vs-multi-select misclassification,
percentage-total auto-sum, exact-amount-vs-fallback contradictions,
item numbering, internal-code display, numeric-field "0" confusion,
Age Group/Island Group redundancy, and interview-timestamp auto-capture.
All addressed as of commit `b900be4` — see README.md sections 7-7e for
the user-facing explanation of each, and section 8a for what's still
outstanding (same list as Section 6 above, kept in sync).

## 9. Where to pick up

Read `README.md` in full first (it's the user-facing source of truth for
deployment + feature list). Then read `tools/enhance_schema.py` top to
bottom (it's ~500 lines and is the actual design document for how the
schema behaves — better maintained and more precise than prose
descriptions). Then look at Section 6 above and ask the user which
deferred item to tackle next, or address any new reviewer feedback the
same way this session did: read every uploaded comment file in full
before changing anything, prioritize root-cause parser/schema fixes over
one-off patches, and test with the jsdom+Playwright pattern before
declaring anything done.
