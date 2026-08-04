# AGRISENSO Plus Baseline Survey — Standalone Web Site + Google Sheets Backend

A real, shareable website (not a `script.google.com` link) for the
DRVN/ACPC AGRISENSO Plus Baseline Study questionnaires, backed by Google
Sheets as the database.

- **Instrument A** — AGRISENSO Plus Borrowers (122 questions / 274 data columns)
- **Instrument B** — Non-Borrower Comparison Group (103 questions / 203 data columns)

**Architecture:**
- `docs/` — a plain static website (HTML/CSS/JS, no build step) that renders
  the whole survey. You publish this with GitHub Pages (or Render, Netlify,
  any static host) and get a normal URL to share with enumerators.
  `docs/config.js` already points at your live backend — see Section 1.
- `src/` — a small Google Apps Script project, bound to your Google Sheet,
  that exposes the questionnaire and accepts submissions as a JSON API.
  This is the *only* part that touches Google's infrastructure — the site
  your users see is entirely yours.

The site talks to the Apps Script backend over `fetch()`, the same way any
website talks to any API. Everything else (offline queueing, section
navigation, all field types) works exactly as before.

**Design:** bigger type scale and wider layout for readability in the
field, a "planted rows" segmented progress bar, smooth section transitions
and button feedback (motion is disabled automatically if the visitor's
device has "reduce motion" turned on), and dropdown selectors for any
question with more than 6 choices (borrower segment, livelihood type,
educational attainment, etc.) instead of a long wall of radio buttons.

---

## 1. Deploy the backend (Apps Script + Google Sheet)

1. Create a new Google Sheet (this is your survey database).
2. **Extensions → Apps Script**. This opens a script project bound to your
   Sheet (no API keys needed).
3. Create these files in the Apps Script editor and paste in the matching
   contents from `src/` in this project:
   - `Code.gs`, `Schema_A.gs`, `Schema_B.gs` (Script files)
   - `Index.html`, `JavaScript.html`, `Stylesheet.html`, `Assets.html` (HTML files)
   - Replace the manifest (gear icon → Project Settings → show
     `appsscript.json`) with `src/appsscript.json`.

   *(`Index.html`/`JavaScript.html`/`Stylesheet.html`/`Assets.html` are only
   needed if you also want the survey reachable directly at the Apps Script
   URL as a fallback — the standalone site in `docs/` doesn't need them to
   function, but `Code.gs` does need `Index.html` to exist or `doGet()`'s
   HTML fallback will error. Simplest: include all seven files as above.)*

4. Run `setupSheetsManually` once from the function dropdown to pre-create
   both data tabs (approve the authorization prompt — this is your script
   acting on your own Sheet).
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy**, authorize, and copy the **Web app URL**
   (`https://script.google.com/macros/s/AKfycb.../exec`). This is your
   backend URL — you'll paste it into the site next.

**Test it's alive:** open `<that URL>?action=ping` in a browser — you
should see `{"ok":true,"message":"AGRISENSO Plus survey backend is reachable."}`.

---

## 2. Point the site at your backend

`docs/config.js` is already pointed at your deployed backend, so there's
nothing to do here for normal use — this is only relevant if you ever
create a **brand-new** Apps Script deployment (rather than "New version"
on the existing one), which gets a different `/exec` URL:

1. Open `docs/config.js`.
2. Replace the URL:
   ```js
   var APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
3. Save, commit, push.

---

## 3. Publish the site

### Option A — GitHub Pages (recommended, free, works with the git repo you already have)
1. Push this project to GitHub (see Section 5 below if you haven't).
2. On GitHub: **Settings → Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**,
   **Branch: main**, **Folder: /docs**. Save.
4. GitHub gives you a URL like `https://heroltolosa-123.github.io/agrisenso-plus-survey/`
   within a minute or two. That's your shareable survey link.
5. Whenever you push changes to `docs/`, the site updates automatically
   (usually within a minute).

### Option B — Render (static site)
1. In Render: **New → Static Site**, connect your GitHub repo.
2. **Root directory:** leave blank (repo root). **Publish directory:** `docs`.
3. No build command needed (it's plain HTML/CSS/JS).
4. Deploy — Render gives you a `.onrender.com` URL (or attach your own domain).

### Option C — Netlify / any static host
Point it at the `docs/` folder the same way; no build step required.

---

## 4. Using the app in the field

Same as before — open the site URL, pick an instrument, work through
sections with Previous/Next, Submit at the end. Responses are saved to a
local backup in the browser and posted to your Google Sheet; if there's no
signal, the response queues locally and **Sync Pending Now** retries later.
See Section 6 for where the data lands in the Sheet.

**Caveats specific to this hosting split:**
- The site and the backend are two different addresses now. If you ever
  redeploy the Apps Script backend and get a *new* `/exec` URL (this can
  happen if you create a brand-new deployment instead of updating an
  existing one), update `docs/config.js` and republish the site, or every
  submission will fail.
- Prefer **Deploy → Manage deployments → pencil icon → New version** over
  creating a brand-new deployment when you update `Code.gs`/`Schema_*.gs` —
  that keeps the same `/exec` URL so you never have to touch `config.js`
  again after the first setup.

---

## 5. Push to GitHub (if not already)

```bash
cd webapp
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

If `git push` asks for a password, GitHub requires a Personal Access
Token instead (Settings → Developer settings → Personal access tokens →
generate one with the `repo` scope, paste it in as the password).

---

## 6. Where the data ends up

In your Google Sheet:
- `Instrument_A_Borrowers` / `Instrument_B_NonBorrowers` — one row per
  response. Row 1 = stable field IDs, row 2 = full question text (frozen).
- `Instrument_A_Borrowers_Dictionary` / `..._Dictionary` — a two-column
  `field_id → question text` lookup for analysis later.
- Column B on every response is **`response_no`** — an auto-generated,
  human-readable primary key like `AGRISENSO-A-00017`, sequential per
  instrument. `submission_id` (column A, a UUID) also stays as a
  guaranteed-unique internal key; use `response_no` for anything you'd
  reference by hand (tracking sheets, field logs, data cleaning notes).

### One-time cleanup before going live
If you already ran pilot tests (as recommended), your sheet likely has a
few stray tabs from that testing — safe to delete:
- **`Sheet1`** — Google's empty default tab, unused.
- **`Sheet2`** / **`undefined_Dictionary`** (or any tab literally named
  `undefined`) — created by an early test submission where the instrument
  wasn't correctly identified. Harmless, just clutter — delete both.
- Any **test data rows** already in `Instrument_A_Borrowers` /
  `Instrument_B_NonBorrowers` — delete the row(s), keeping the 2 header rows.

Do this cleanup *before* your first real interview, since `response_no`
numbering counts existing rows — leftover test rows would make your first
real response start at `-00002` instead of `-00001`.

---

## 7. Required fields — no more blank submissions

Every question in the form is now mandatory. **Next** and **Submit** both
check that every question on the relevant page(s) has an answer, and will
not proceed otherwise — the unanswered question(s) get a red outline and a
message tells you how many are still missing. **Submit** re-checks the
*entire* questionnaire (not just the last page) and jumps back to the
first incomplete section if anything was missed earlier.

For questions that genuinely don't apply to a given respondent (skip
logic, e.g. "Ask only if Individual Borrower"), every choice-type question
automatically gets an **"N/A — Not applicable"** option, and text
questions accept a typed `N/A` — so "required" never forces an enumerator
to invent an answer, it only prevents *accidental* blanks. This is what
was happening in your pilot test for Instrument B: the submission went
through with everything empty except the timestamp, precisely because
nothing enforced completion before.

See `guide/AGRISENSO_Plus_Survey_Enumerator_Guide.docx` for the
enumerator-facing explanation of how this works — share that file (or a
printed copy) with your field team before their first interview.

---

## 7a. Fixed: front-matter text no longer shows as a fillable question

An earlier version had a parsing bug where purely instructional text (the
"Target Respondents / Operational Definition / Instructions to Enumerator"
block at the very start of each instrument, some "Enumerator Note:" asides,
and a stray HTML artifact) was being turned into a giant *required* text
box with nothing meaningful to type into it. That's fixed: `tools/parse_questionnaire.py`
now recognizes purely instructional paragraphs (by known prefixes like
"Enumerator Note:", or by length) and renders them as read-only guidance
text instead of a field — so nothing forces an enumerator to fill in a
paragraph that was never meant to be answered. Two related fields (the
enumerator-name line under Consent Confirmation, and the borrowing
organization's name under A4) were also split so the real fillable part
has a short, sensible label instead of being buried in a paragraph.

If you regenerate the schema from a revised questionnaire later (Section 8),
this fix carries forward automatically — no per-question manual work needed.

---

## 7b. Dates, times, and numeric fields

Several fields were converted from free text to structured inputs, so
enumerators never have to guess a format or type an answer that already
has a fixed set of valid values:

- **Dates** (Date of Version, Date of Interview, Consent Confirmation
  date) use the browser's native date picker (`mm/dd/yyyy`) instead of a
  free-text box — no more "8/4/26" vs "04-08-2026" ambiguity.
- **Times** (Interview Start/End Time, Closing Statement End Time) use a
  native time picker the same way, and **loan application/agreement/
  release dates** use a month picker (`mm/yyyy`).
- **Numeric fields** — ages, PHP amounts, percentages, hectares, counts of
  people/documents/visits (35 fields across both instruments) — use a
  native numeric input with a numeric mobile keypad, rejecting
  non-numeric keystrokes.
- All of the above have their own **N/A checkbox** right next to the
  picker (since none of these input types can literally hold the text
  "N/A") — checking it disables the picker and records N/A, satisfying
  the required-field rule for genuinely inapplicable cases.
- **Questionnaire Version** shows an example placeholder ("e.g. v1.0").

Any single-choice question with more than 6 options (Borrower Segment,
livelihood type, educational attainment, etc. — about 35 questions per
instrument) already renders as a dropdown rather than a long list of
radio buttons, per the earlier UI update.

---

## 7c. Region, Province, City/Municipality, Barangay — cascading dropdowns

**Region** is a dropdown of the Philippines' 18 official regions —
including Negros Island Region, re-established in 2024 (confirmed against
the PSA's Philippine Standard Geographic Code) — instead of free text.

**Province, City/Municipality, and Barangay cascade automatically** from
the selected Region, using the free [PSGC API](https://psgc.gitlab.io/api/):
picking a Region fetches its provinces and turns the Province field into a
dropdown; picking a Province fetches its cities/municipalities; picking a
city/municipality fetches its barangays. Nothing to configure — this runs
automatically the moment the enumerator opens Section A.

**Why not just bundle the full list?** The Philippines has 1,600+
municipalities and 42,000+ barangays. Bundling a static copy risks
shipping stale or wrong data with no way for me to verify it; a live,
actively-maintained government-linked source is more trustworthy — for
Region specifically, though, I verified the current 18-region list against
official sources directly, since it's small and stable enough to be
confident in.

**Built to fail safely.** If the PSGC API is slow, down, blocked, or
returns something unexpected at any step, that field simply **stays a
plain text box with its example hint** (e.g. "e.g. Nueva Ecija") — exactly
as it worked before this feature existed. The enumerator is never blocked;
they just type it in instead of picking from a list. This fallback is
tested and confirmed working, including in a real browser with the PSGC
requests deliberately blocked.

**What I could not verify from this environment:** whether
`psgc.gitlab.io` actually permits cross-origin requests from your
published site's domain in practice — I can't make live network calls to
that specific host from this sandbox. The matching logic, the cascade, and
—most importantly— the fallback are all tested and solid; what's untested
is simply "does the live API respond as expected when your real site
calls it." **Please check this specifically during your pilot test**: open
Section A on the live site and confirm Province/City/Barangay turn into
dropdowns after picking a Region. If they don't, the form still works
perfectly fine as plain text — you've just lost the convenience, not any
functionality.

---

## 7d. Automatic skip logic — no more remembering to click N/A

Several questions in the source questionnaire are explicitly marked
"Ask only if A2 = Individual Borrower" (or Organizational/Enterprise) —
this routing is now enforced automatically instead of being something the
enumerator has to notice and act on:

- Fields that don't apply to the respondent's Borrower Type are
  **automatically grayed out, disabled, and filled with N/A** — no manual
  click needed.
- Fields that do apply are enabled normally.
- This updates **live** as soon as the Borrower Type answer changes — for
  example, before the respondent's type is even chosen, both the
  Individual and Organizational name fields show grayed until an answer
  is given; picking one immediately enables the matching field and grays
  the other.
- If the enumerator corrects an earlier answer (e.g. Borrower Type gets
  changed after some fields were already filled), any field that's no
  longer applicable is cleared back and auto-filled with N/A; a field that
  newly becomes applicable is cleared to blank so it can be genuinely
  answered rather than silently keeping a stale value.
- This also applies to the two "who decides" matrix tables in Sections G/F,
  which have separate versions for individual vs. organizational
  respondents.

20 fields (Instrument A) / 18 fields (Instrument B) are covered by this —
every place in the source questionnaire that had this exact, explicit
"Ask only if.../For individual.../Individual...only" routing language.
Less explicit or more ambiguous routing instructions (there's a small
number) are left as on-screen text for the enumerator to follow manually,
same as before, rather than risk auto-hiding a question based on a guess.

---

## 8. Updating the questionnaire later

1. Re-export the revised Word doc to Markdown and isolate each instrument's
   section (see `tools/parse_questionnaire.py`'s docstring for the pandoc
   command).
2. Run `tools/parse_questionnaire.py` to produce updated
   `tools/questions_A.json` / `questions_B.json`.
3. Run `tools/enhance_schema.py` to reapply the Region dropdown, date/
   time/month/numeric field types, hints, and conditional-logic detection
   on top of the freshly parsed schema.
4. Run `tools/generate_gs_schema.py` to regenerate `src/Schema_A.gs` /
   `src/Schema_B.gs`.
5. Paste the updated `Schema_*.gs` into the Apps Script editor and
   redeploy (Deploy → Manage deployments → New version).
6. `docs/` needs no changes — it renders whatever schema the backend
   serves.

---

## 9. How this was verified

Everything below was tested with Node.js (including a real DOM via jsdom
simulating an actual browser) before being handed to you, since this
environment can't reach Google's or GitHub's live servers directly:

- All `.gs` files and `docs/app.js` pass JavaScript syntax checks.
- **Every one of the 274 (Instrument A) / 203 (Instrument B) field IDs the
  static site generates matches exactly, in the same order,** the columns
  the Apps Script backend expects — so no answer lands in the wrong column
  or gets silently dropped.
- A mocked `Code.gs` backend (fake `SpreadsheetApp`) confirmed
  `doGet(?action=schema)`, `doGet(?action=ping)`, and
  `doPost({action:'submit'})` all behave correctly, including invalid-input
  and malformed-JSON error handling.
- A full jsdom run: loaded `docs/index.html` and `docs/app.js` in a real
  DOM, clicked through the instrument picker, filled in fields, submitted,
  and confirmed the posted data reaches a mock backend correctly shaped —
  then separately confirmed that when the network fails mid-submission,
  the response is correctly queued to `localStorage` for later sync.
- **Sequential `response_no` generation** confirmed correct and gap-free
  across multiple submissions against a mock sheet.
- **Required-field validation**: confirmed `Next` blocks and highlights a
  blank field; confirmed `Submit` re-validates every section and jumps to
  the first incomplete one; confirmed every choice/scale/matrix field
  automatically gains a working N/A option that satisfies the requirement;
  confirmed the identical behavior for the `google.script.run` variant used
  on the direct Apps Script page.
- **The strongest check**: a jsdom run that completed and submitted the
  entire real Instrument A questionnaire — all 14 sections, 274 columns —
  end to end, then confirmed zero blank values among the submitted answers.
- **New dropdown fields**: confirmed the >6-option threshold correctly
  renders a `<select>` instead of radio buttons, that it still gets an
  auto-added N/A option, that choosing an "Other: specify" entry shows a
  companion text box and submits the combined value correctly, and that it
  participates in required-field validation like any other field.
- **The front-matter parsing fix**: confirmed the previously-buggy intro
  section now has zero required fields and renders as plain instructional
  text, both in the parsed schema and in an actual rendered screenshot.
- **Date/time pickers and the Region dropdown**: confirmed native
  `<input type="date">`/`<input type="time">` render correctly with a
  working N/A checkbox that disables the picker and satisfies the
  required-field check; confirmed the 18-option Region dropdown renders,
  submits the exact selected value, and — since it's a single_choice field
  with more than 6 options — automatically gets the same dropdown/N/A/
  validation treatment as any other long list. Verified visually with a
  rendered screenshot showing all 18 regions.
- **Real rendered screenshots** (Chromium via Playwright, not just jsdom):
  desktop and mobile views of the chooser screen, a mid-survey section
  with a live dropdown, the date/time picker fields, and the open Region
  dropdown showing all 18 options — plus a full 14-section click-through
  with zero browser console errors.
- **Two more parser bugs found and fixed during review**: confidence-scale
  questions with a lead-in phrase other than the literal word "Response"
  were silently becoming free-text fields instead of 1–5 scales (fixed —
  confirmed all 8 scale questions per instrument now correctly typed);
  and a real question immediately followed by a short filler line like
  "Number: ____ persons" was losing its actual question text and keeping
  only "Number" as the label (fixed — confirmed against the specific
  fields this affected).
- **Numeric fields**: confirmed native numeric input renders for all 35
  identified fields, rejects non-numeric characters, and has a working
  N/A checkbox alongside it (numeric inputs can't hold literal "N/A").
- **Conditional / skip logic**: confirmed fields on both sides of an
  Individual/Organizational branch start grayed with auto-N/A before the
  branching question is answered; confirmed the correct side un-grays and
  the other stays grayed the moment an answer is picked; confirmed
  flipping the answer back clears the newly-inapplicable field to N/A and
  resets the newly-applicable one to blank (not a stale leftover value);
  confirmed this extends correctly to matrix-table fields, which store
  answers per-cell rather than per-field; confirmed a fully-completed,
  correctly-branched response submits with the right real answers and the
  right auto-N/A values in the right places. Verified visually with
  before/after screenshots showing the gray-out in a real browser.
- **PSGC cascading location dropdowns**: confirmed the full Region→
  Province→City/Municipality→Barangay cascade against a mocked API,
  including the region-name matching logic (which has to tolerate the
  live API formatting region names differently than my own dropdown
  text). Just as important, confirmed the failure path: with the PSGC API
  entirely unreachable, Province/City/Barangay silently remain the
  original plain-text fields with their example hints and the form stays
  fully completable — verified both in jsdom and in a real Chromium
  browser with the PSGC requests deliberately blocked.

**What's still untested** (can't be done from this environment): an actual
live deployment on `script.google.com`, real GitHub Pages/Render hosting,
Apps Script's real CORS behavior in a live browser, and — the one piece
that matters most to flag — **whether `psgc.gitlab.io` actually responds
to cross-origin requests from your published site's real domain**. I
can't make live calls to that specific host from this sandbox, so while
the cascade logic and its fallback are both thoroughly tested, the "does
the live API actually answer" part is not. If it doesn't, the location
fields simply stay as plain text — no functionality is lost, only the
dropdown convenience. The `text/plain` Content-Type trick used in
`docs/app.js`'s POST request to your own backend is a well-established
pattern for calling Apps Script cross-origin without triggering a CORS
preflight it can't answer — but do the pilot-run test below before real
fieldwork regardless.

**Pilot test before real fieldwork:** open your published site, submit 2–3
test responses — try leaving something blank on purpose to confirm it's
blocked, try the N/A checkboxes on a date/time/number field, try picking a
Region and confirm Province turns into a dropdown (or note if it doesn't —
see above), and test the Individual/Organizational branch in Section A to
confirm the right fields gray out. Confirm the good responses appear
correctly in the Sheet with sequential `response_no` values, then delete
those test rows and any stray tabs per Section 6.
